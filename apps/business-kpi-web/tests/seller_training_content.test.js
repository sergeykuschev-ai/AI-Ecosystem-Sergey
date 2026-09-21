'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CHECKED_AT,
  TRAINING_CONTENT,
  enrichTrainingTask,
} = require('../../../agents/business-kpi/rules/seller_training_content');
const {
  SELLER_TASK_LIBRARY,
} = require('../../../agents/business-kpi/rules/seller_task_library');

test('verified product modules expose official sources and current check date', () => {
  const required = [
    'KNOW-01', 'KNOW-02', 'KNOW-03', 'KNOW-06', 'KNOW-07',
    'KNOW-08', 'KNOW-09', 'KNOW-10', 'KNOW-22', 'KNOW-23', 'KNOW-24', 'KNOW-25',
  ];
  assert.equal(CHECKED_AT, '2026-09-22');
  for (const code of required) {
    const extra = TRAINING_CONTENT[code];
    assert.ok(extra, code + ' should have training enrichment');
    assert.ok(extra.sources?.length, code + ' should have official sources');
    for (const source of extra.sources) {
      assert.match(source.url, /^https:\/\//);
      assert.equal(source.checkedAt, CHECKED_AT);
      assert.doesNotMatch(source.url, /ozon|wildberries|market\.yandex|amazon/i);
    }
  }
});

test('real MISKA product examples cover the priority assortment', () => {
  const examples = Object.values(TRAINING_CONTENT)
    .flatMap(item => item.productExamples || [])
    .join('\n');
  assert.match(examples, /AWARD Sterilized.*1,5 кг/);
  assert.match(examples, /AWARD Monoprotein.*1,5 кг/);
  assert.match(examples, /Veterinary Diet Urinary/);
  assert.match(examples, /Мнямс.*85 г/);
  assert.match(examples, /Cat’s Choice.*6 л/);
  assert.match(examples, /Craftia Harmona/);
  assert.match(examples, /Bambini Pets/);
  assert.match(examples, /Ферма кота Фёдора/);
  assert.match(examples, /Japan Premium Pet/);
  assert.match(examples, /Inspector/);
  assert.match(examples, /БАРС/);
});

test('knowledge library is enriched without changing the canonical module count', () => {
  const knowledge = SELLER_TASK_LIBRARY.filter(task => task.type === 'KNOWLEDGE');
  assert.equal(knowledge.length, 25);
  const enriched = knowledge.map(task => enrichTrainingTask({
    ...task,
    taskType: task.type,
  }));
  assert.equal(enriched.length, 25);
  assert.ok(enriched.find(item => item.code === 'KNOW-01').sources.length >= 1);
  assert.ok(
    enriched.find(item => item.code === 'KNOW-19').consultationScenarios.length >= 3
  );
});
