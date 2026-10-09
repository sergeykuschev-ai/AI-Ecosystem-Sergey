'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { relatedNotes } = require('../../arthur-core/services/personal-memory-search');
const { detectIntent, INTENTS } = require('../planner/intents');
const { createArthurV1 } = require('../index');
const { createPersonalMemorySkill } = require('../skills/arthur-core/personal_memory_skill');
const { ArthurCoreTimeoutError } = require('../skills/arthur-core/core_client');

test('lexical recall requires all meaningful words and never returns the whole memory for an empty question', () => {
  const records = ['Английский по четвергам', 'Английский: цель B1', 'Спортзал по средам']
    .map(text => ({ value: { text } }));
  assert.deepEqual(relatedNotes(records, 'Какая у меня цель по английскому?'), [records[1]]);
  assert.deepEqual(relatedNotes(records, 'Когда у меня английский?'), records.slice(0, 2));
  for (const query of ['', 'Что у меня?', 'Когда у меня немецкий?', 'English']) {
    assert.deepEqual(relatedNotes(records, query), []);
  }
});

test('ordinary personal questions route to recall without stealing commands or business/task questions', () => {
  for (const question of ['Когда у меня английский?', 'Какая у меня цель по английскому?', 'Какой корм у моей кошки?']) {
    assert.equal(detectIntent(question), INTENTS.PERSONAL_RECALL);
  }
  for (const question of ['Когда английский у Ивана?', 'Какой мне купить корм?', 'Когда у меня задачи на сегодня?', 'Какая у меня выручка Миски?',
    'Запомни: английский', 'Запомни, что жду Валту', 'Расскажи про английский']) {
    assert.notEqual(detectIntent(question), INTENTS.PERSONAL_RECALL);
  }
});

test('ordinary recall uses canonical owner and verified source records without model inference or writes', async () => {
  const calls = [];
  const record = { id: 'synthetic-note-id', value: { text: 'Английский по четвергам <вечером>' },
    createdAt: '2026-10-09T00:00:00Z', sourceType: 'user', sourceRef: 'telegram-update:123' };
  const arthur = createArthurV1({ coreConfig: { baseUrl: 'http://core.test', token: 'test',
    ownerProfileId: 'canonical-owner', personalMemoryEnabled: true }, coreClient: {
    async getProfile() {}, async listTasks() {}, async getTaskBrief() {}, async createTask() {},
    async transitionTask() {}, async health() {},
    async managePersonalMemory() { throw new Error('Recall must not write'); },
    async listPersonalMemory(...args) { calls.push(args); return { records: [record], total: 1 }; },
  }, aiProvider: { async generate() { throw new Error('No model for recall'); },
    async synthesize() { throw new Error('No model for recall'); }, async health() {} },
  logger: { info() {}, warn() {}, error() {} } });
  const response = await arthur.handle({ userId: 'transport-id', message: 'Когда у меня английский?' });
  assert.equal(calls[0][0], 'canonical-owner');
  assert.equal(calls[0][3], 'related');
  assert.match(response.answer.text, /четвергам &lt;вечером&gt;/);
  assert.match(response.answer.text, /synthetic-note-id/);
  assert.match(response.answer.text, /telegram-update:123/);
  assert.match(response.answer.text, /актуальность сейчас не проверена/);
  assert.deepEqual(response.answer.sources[0].metadata.records[0], {
    id: record.id, sourceType: 'user', sourceRef: record.sourceRef, createdAt: record.createdAt,
  });
});

test('missing, unavailable and disabled recall do not manufacture a personal answer', async () => {
  const client = { async health() {}, async managePersonalMemory() {},
    async listPersonalMemory() { return { records: [], total: 0 }; } };
  const skill = createPersonalMemorySkill({ client, ownerProfileId: 'owner' });
  assert.match((await skill.execute({ operation: 'recall', parameters: { query: 'Когда у меня английский?' } })).data.responseText,
    /не могу это подтвердить/);
  client.listPersonalMemory = async () => { throw new ArthurCoreTimeoutError(1000); };
  assert.match((await skill.execute({ operation: 'recall', parameters: { query: 'английский' } })).data.responseText, /недоступна/);
  const arthur = createArthurV1({ aiProvider: { async generate() { throw new Error('No chat fabrication'); }, async health() {} },
    logger: { info() {}, warn() {}, error() {} } });
  assert.match((await arthur.handle({ userId: 'owner', message: 'Когда у меня английский?' })).answer.text, /не подключена/);
});

test('recall limits visible records and escapes source metadata as well as note text', async () => {
  const records = Array.from({ length: 50 }, () => ({ id: '<'.repeat(50), sourceRef: '<'.repeat(100),
    value: { text: '<'.repeat(2000) }, createdAt: '2026-10-09T00:00:00Z' }));
  const skill = createPersonalMemorySkill({ ownerProfileId: 'owner', client: {
    async health() {}, async managePersonalMemory() {}, async listPersonalMemory() { return { records, total: 50 }; },
  } });
  const result = await skill.execute({ operation: 'recall', parameters: { query: 'test' } });
  assert.ok(result.data.responseText.length < 4096);
  assert.ok(!result.data.responseText.includes('<'));
  assert.equal(result.metadata.records.length, 5);
  assert.match(result.data.responseText, /45 совпадений/);
});
