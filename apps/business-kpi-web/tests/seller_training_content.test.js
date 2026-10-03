'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CHECKED_AT,
  SOURCE_REVIEW_INTERVAL_DAYS,
  TRAINING_CONTENT,
  sourceReviewStatus,
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

test('Monge module uses current official sources and real MISKA test-assortment examples', () => {
  const extra = TRAINING_CONTENT['KNOW-26'];
  assert.ok(extra);
  assert.equal(extra.sources.length, 4);
  assert.ok(extra.sources.every(source => source.url.startsWith('https://monge.ru/')));
  assert.ok(extra.sources.every(source => source.checkedAt === '2026-10-02'));
  const examples = extra.productExamples.join('\n');
  assert.match(examples, /70011938/);
  assert.match(examples, /70005524/);
  assert.match(examples, /70011167/);
  assert.match(examples, /70011525/);
  assert.equal(extra.quickGuide.length, 5);
  assert.match(extra.quickGuide.join('\n'), /за 30 секунд|Кошка или собака|ветеринарному врачу/i);
  assert.equal(extra.lineComparison.length, 4);
  assert.match(extra.lineComparison.join('\n'), /Daily Line/);
  assert.match(extra.lineComparison.join('\n'), /Speciality Line/);
  assert.match(extra.lineComparison.join('\n'), /BWild/);
  assert.match(extra.lineComparison.join('\n'), /VetSolution/);
  assert.ok(extra.consultationScenarios.length >= 5);
  assert.match(extra.consultationScenarios.join('\n'), /плохо ест/);
});

test('official source freshness becomes due after the review interval', () => {
  assert.equal(SOURCE_REVIEW_INTERVAL_DAYS, 30);
  assert.deepEqual(sourceReviewStatus('2026-09-22', '2026-10-21'), {
    ageDays: 29,
    reviewDue: false,
    status: 'CURRENT',
  });
  assert.deepEqual(sourceReviewStatus('2026-09-22', '2026-10-22'), {
    ageDays: 30,
    reviewDue: true,
    status: 'REVIEW_DUE',
  });
  const task = enrichTrainingTask({ code: 'KNOW-01', taskType: 'KNOWLEDGE' }, '2026-10-22');
  assert.ok(task.sources.every(source => source.reviewDue));
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
  assert.equal(knowledge.length, 26);
  const enriched = knowledge.map(task => enrichTrainingTask({
    ...task,
    taskType: task.type,
  }));
  assert.equal(enriched.length, 26);
  assert.ok(enriched.find(item => item.code === 'KNOW-01').sources.length >= 1);
  assert.ok(
    enriched.find(item => item.code === 'KNOW-19').consultationScenarios.length >= 3
  );
});
