'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePersonalMemoryRequest, personalMemoryAction } = require('../planner/personal_memory_parser');
const { INTENTS, detectIntent } = require('../planner/intents');
const { createArthurV1 } = require('../index');
const { ArthurCoreTimeoutError } = require('../skills/arthur-core/core_client');
const { createPersonalMemorySkill } = require('../skills/arthur-core/personal_memory_skill');

test('personal memory commands require explicit intent and parse edit selectors', () => {
  const messages = ['Запомни: английский по вторникам', 'Артур, забудь про английский',
    'Исправь память: вторник → четверг', 'Что ты обо мне помнишь?',
    'Что ты помнишь обо мне?', 'Покажи мою память', 'Что ты помнишь про английский?'];
  for (const message of messages) assert.equal(detectIntent(message), INTENTS.PERSONAL_MEMORY);
  assert.deepEqual(parsePersonalMemoryRequest(messages[0]), { action: 'remember', text: 'английский по вторникам' });
  assert.deepEqual(parsePersonalMemoryRequest(messages[2]), { action: 'edit', query: 'вторник', replacement: 'четверг' });
  assert.equal(parsePersonalMemoryRequest(messages[4]).query, '');
  assert.equal(parsePersonalMemoryRequest(messages[6]).query, 'английский');
  for (const message of ['Я запомнил это', 'Как запомнить английские слова?', '«Запомни: текст»', 'Не забудь купить корм']) {
    assert.equal(personalMemoryAction(message), null);
  }
  for (const message of ['Запомни', 'Забудь', 'Исправь память: текст', `Запомни: ${'a'.repeat(2001)}`]) {
    assert.ok(parsePersonalMemoryRequest(message).clarification);
  }
});

test('memory commands use the configured owner, stable source and deterministic confirmation', async () => {
  const calls = [];
  const ai = { async generate() { throw new Error('Must not use AI'); },
    async synthesize() { throw new Error('Must not use AI'); }, async health() { return {}; } };
  const coreClient = { async getProfile() {}, async listTasks() {}, async getTaskBrief() {},
    async createTask() {}, async transitionTask() {}, async health() {},
    async listPersonalMemory() { return { records: [], total: 0 }; },
    async managePersonalMemory(owner, operation, parameters) {
      calls.push({ owner, operation, parameters });
      return { status: 'saved', record: { value: { text: parameters.text } } };
    } };
  const arthur = createArthurV1({ aiProvider: ai, coreClient,
    coreConfig: { baseUrl: 'http://core.test', token: 'test', ownerProfileId: 'sergey', personalMemoryEnabled: true },
    logger: { info() {}, warn() {}, error() {} } });
  const response = await arthur.handle({ userId: 'telegram-111', channel: 'telegram', message: 'Запомни: <English>',
    transport: { metadata: { updateId: 99 } } });
  assert.equal(response.status, 'success');
  assert.match(response.answer.text, /Запомнил/);
  assert.match(response.answer.text, /&lt;English&gt;/);
  assert.equal(calls[0].owner, 'sergey');
  assert.equal(calls[0].parameters.sourceRef, 'telegram-update:99');
});

test('disabled memory does not fabricate successful storage through chat fallback', async () => {
  let generated = false;
  const arthur = createArthurV1({ aiProvider: {
    async generate() { generated = true; return 'Запомнил'; }, async health() { return {}; },
  }, logger: { info() {}, warn() {}, error() {} } });
  const response = await arthur.handle({ userId: 'owner', message: 'Запомни: английский' });
  assert.match(response.answer.text, /не выполнено/);
  assert.equal(generated, false);
});

test('uncertain memory matches do not claim a mutation and responses remain bounded/escaped', async () => {
  const records = Array.from({ length: 50 }, () => ({ value: { text: '<'.repeat(2000) }, createdAt: '2026-10-09T00:00:00Z' }));
  const skill = createPersonalMemorySkill({ ownerProfileId: 'sergey', client: {
    async health() {}, async listPersonalMemory() { return { records, total: 50 }; },
    async managePersonalMemory() { return { status: 'ambiguous', candidates: records, total: 50 }; },
  } });
  const response = await skill.execute({ operation: 'forget', parameters: { query: 'English' } });
  assert.match(response.data.responseText, /Ничего не изменил/);
  assert.ok(response.data.responseText.length < 4096);
  assert.match(response.data.responseText, /&lt;/);
  assert.ok(!response.data.responseText.includes('<'));
});

test('Core timeout never confirms memory storage', async () => {
  const skill = createPersonalMemorySkill({ ownerProfileId: 'sergey', client: {
    async health() {}, async listPersonalMemory() {},
    async managePersonalMemory() { throw new ArthurCoreTimeoutError(1000); },
  } });
  const response = await skill.execute({ operation: 'remember', parameters: { text: 'English' } });
  assert.equal(response.data.memoryStatus, 'unavailable');
  assert.match(response.data.responseText, /не подтверждено/);
});
