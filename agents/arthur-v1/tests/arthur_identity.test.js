'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  ARTHUR_IDENTITY,
  buildCapabilityContext,
  buildSystemMessage,
  buildDirectResponseSystemMessage,
  buildPlannerSystemMessage,
} = require('../identity/arthur_identity');

function createFakeSkill(id, capabilities = ['op']) {
  return {
    id,
    name: id,
    version: '1.0.0',
    capabilities: capabilities.map(cap => ({ id: cap, readOnly: true })),
  };
}

test('Arthur identity defines name and role', () => {
  assert.equal(ARTHUR_IDENTITY.name, 'Артур');
  assert.ok(ARTHUR_IDENTITY.role.includes('Сергея'));
  assert.ok(ARTHUR_IDENTITY.businesses.some(b => b.id === 'miska'));
});

test('buildCapabilityContext returns empty message when no skills', () => {
  const context = buildCapabilityContext([]);
  assert.ok(context.includes('нет подключённых skills'));
});

test('buildCapabilityContext lists skill operations', () => {
  const context = buildCapabilityContext([
    createFakeSkill('purchasing', ['getStatus', 'getSummary']),
  ]);
  assert.ok(context.includes('purchasing'));
  assert.ok(context.includes('getStatus'));
  assert.ok(context.includes('getSummary'));
});

test('buildSystemMessage includes identity, constraints and capabilities', () => {
  const message = buildSystemMessage({
    skills: [createFakeSkill('purchasing', ['getStatus'])],
  });
  assert.ok(message.includes('Артур'));
  assert.ok(message.includes('Миска'));
  assert.ok(message.includes('purchasing'));
  assert.ok(message.includes('прямого доступа к базам данных'));
  assert.ok(message.includes('только на основе подключённых skills'));
  assert.ok(message.includes('Всегда обращайся к нему на «ты»'));
});

test('buildSystemMessage includes user name when provided', () => {
  const message = buildSystemMessage({ skills: [], userName: 'Сергей' });
  assert.ok(message.includes('Пользователь: Сергей'));
});

test('buildDirectResponseSystemMessage builds conversational response prompt', () => {
  const message = buildDirectResponseSystemMessage({
    skills: [createFakeSkill('purchasing')],
  });
  assert.ok(message.includes('Артур'));
  assert.ok(message.includes('purchasing'));
  assert.ok(message.includes('Отвечай естественно'));
  assert.ok(message.includes('не требует вызова подключённых skills'));
  assert.ok(message.includes('Не придумывай бизнес-данные'));
});

test('buildPlannerSystemMessage restricts to registered skills', () => {
  const message = buildPlannerSystemMessage({
    skills: [createFakeSkill('purchasing', ['getStatus'])],
  });
  assert.ok(message.includes('Артур'));
  assert.ok(message.includes('purchasing'));
  assert.ok(message.includes('getStatus'));
  assert.ok(message.includes('ТОЛЬКО подключённые skills'));
});
