'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(__dirname + '/../orchestrator/orchestrator.js', 'utf8');
const segment = source.slice(source.indexOf('  async _respondDirectly('), source.indexOf('\n  async handle('));
assert.ok(segment.startsWith('  async _respondDirectly('), 'orchestrator method found');
const buildSystem = () => 'SYSTEM RULES';
const createResponse = ({ request, status, answer, diagnostics }) => ({ request, status, answer, diagnostics });
const Orchestrator = new Function(
  'buildDirectResponseSystemMessage', 'createOrchestratorResponse',
  'return class Orchestrator { ' + segment + ' }'
)(buildSystem, createResponse);
function setup(entries = []) {
  const aiCalls = [];
  const stored = [];
  const instance = new Orchestrator();
  instance.logger = { info() {}, warn() {} };
  instance.registry = { list: () => [] };
  instance._getAvailableSkills = () => [];
  instance.memory = { store: async (_userId, _conversationId, entry) => stored.push(entry) };
  instance.aiProvider = { generate: async (message, config) => {
    aiCalls.push({ message, config });
    return 'Модель ответила';
  } };
  instance._respondWithText = async (_request, text, _memory, _start, reason) => {
    stored.push({ answer: text, reason });
    return { status: 'success', answer: { text }, diagnostics: { reason } };
  };
  const invoke = message => instance._respondDirectly(
    { userId: 'owner', conversationId: 'chat', message, channel: 'telegram' },
    { entries: [] }, entries, Date.now()
  );
  return { invoke, aiCalls, stored };
}
test('No after an optional add-more question closes conversation without LLM', async () => {
  const x = setup([{ request: 'Сохрани задачу', answer: 'Сохранил задачу. Что-нибудь ещё добавить?' }]);
  const out = await x.invoke('Нет');
  assert.equal(out.answer.text, 'Хорошо, ничего не добавляю.');
  assert.equal(out.diagnostics.reason, 'declined_optional_details');
  assert.equal(x.aiCalls.length, 0);
});
test('No to another question is not falsely interpreted as refusal to add', async () => {
  const x = setup([{ request: 'Можешь напомнить?', answer: 'Ты хочешь напомнить завтра?' }]);
  await x.invoke('Нет');
  assert.equal(x.aiCalls.length, 1);
  assert.ok(x.aiCalls[0].message.includes('Ты хочешь напомнить завтра?'));
});
test('Short follow-up gets both sides of previous turn and current message', async () => {
  const x = setup([{ request: 'В чём проблема?', answer: 'Нужно проверить время напоминания.' }]);
  await x.invoke('Хорошо');
  const p = x.aiCalls[0].message;
  assert.ok(p.includes('Пользователь: В чём проблема?'));
  assert.ok(p.includes('Артур: Нужно проверить время напоминания.'));
  assert.ok(p.includes('Текущее сообщение пользователя: Хорошо'));
  assert.ok(p.includes('\nАртур: '), 'newlines are real');
});
test('Independent request has unchanged prompt', async () => {
  const x = setup();
  await x.invoke('Покажи дела');
  assert.equal(x.aiCalls[0].message, 'Покажи дела');
});
test('History is limited to last six turns', async () => {
  const x = setup(Array.from({ length: 9 }, (_, i) => ({
    request: 'Запрос №' + i, answer: 'Ответ №' + i
  })));
  await x.invoke('Дальше');
  assert.ok(!x.aiCalls[0].message.includes('Запрос №2'));
  assert.ok(x.aiCalls[0].message.includes('Запрос №3'));
  assert.ok(x.aiCalls[0].message.includes('Ответ №8'));
});
test('Refusal with no matching prior question goes to model', async () => {
  const x = setup();
  await x.invoke('Нет');
  assert.equal(x.aiCalls.length, 1);
});
test('Direct response system prompt describes Telegram reminders honestly', () => {
  const identity = fs.readFileSync(__dirname + '/../identity/arthur_identity.js', 'utf8');
  assert.match(identity, /отдельный встроенный обработчик личных дел и напоминаний/);
  assert.match(identity, /Не утверждай, что действие выполнено/);
});

[executed on device: stores-web1 (29937a8a-9d20-41c2-8148-926a7294ee5e)]