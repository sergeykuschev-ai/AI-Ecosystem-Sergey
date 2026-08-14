'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createRuleBasedPlanBuilder, INTENTS } = require('../planner/plan_builder');
const { detectIntent } = require('../planner/intents');

test('purchasing.status intent builds single purchasing step', () => {
  const builder = createRuleBasedPlanBuilder();
  const plan = builder.build({ message: 'Что сейчас с закупщиком?', intent: INTENTS.PURCHASING_STATUS });
  assert.equal(plan.version, 1);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].skill, 'purchasing');
  assert.equal(plan.steps[0].operation, 'getStatus');
});

test('purchasing.owner_review intent builds owner review step', () => {
  const builder = createRuleBasedPlanBuilder();
  const plan = builder.build({ message: 'Покажи спорные позиции', intent: INTENTS.PURCHASING_OWNER_REVIEW });
  assert.equal(plan.steps[0].skill, 'purchasing');
  assert.equal(plan.steps[0].operation, 'getOwnerReview');
});

test('purchasing.final_order intent builds final order step', () => {
  const builder = createRuleBasedPlanBuilder();
  const plan = builder.build({ message: 'Какой последний заказ?', intent: INTENTS.PURCHASING_FINAL_ORDER });
  assert.equal(plan.steps[0].skill, 'purchasing');
  assert.equal(plan.steps[0].operation, 'getFinalOrder');
});

test('purchasing.summary intent builds summary step', () => {
  const builder = createRuleBasedPlanBuilder();
  const plan = builder.build({ message: 'Подведи итог', intent: INTENTS.PURCHASING_SUMMARY });
  assert.equal(plan.steps[0].skill, 'purchasing');
  assert.equal(plan.steps[0].operation, 'getSummary');
});

test('Arthur Core profile, tasks and brief intents build read-only Core steps', () => {
  const builder = createRuleBasedPlanBuilder();
  const scenarios = [
    ['кто я', INTENTS.CORE_PROFILE, 'getProfile'],
    ['что у меня по задачам', INTENTS.CORE_TASKS, 'listTasks'],
    ['дай сводку по задачам', INTENTS.CORE_TASK_BRIEF, 'getTaskBrief'],
  ];

  for (const [message, intent, operation] of scenarios) {
    assert.equal(detectIntent(message), intent);
    const plan = builder.build({ message });
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].skill, 'arthur-core');
    assert.equal(plan.steps[0].operation, operation);
  }
});

test('deterministic Core plan is empty when Core skill is not registered', () => {
  const builder = createRuleBasedPlanBuilder({ availableSkills: ['purchasing'] });
  const plan = builder.build({ message: 'покажи мой профиль' });
  assert.deepEqual(plan.steps, []);
});

test('knowledge.search intent returns empty plan because knowledge skill is not registered', () => {
  const builder = createRuleBasedPlanBuilder();
  const plan = builder.build({ message: 'матрица', intent: INTENTS.KNOWLEDGE_SEARCH });
  assert.equal(plan.version, 1);
  assert.deepEqual(plan.steps, []);
});

test('unknown intent returns empty plan instead of referencing missing skill', () => {
  const builder = createRuleBasedPlanBuilder();
  const plan = builder.build({ message: 'абракадабра' });
  assert.equal(plan.version, 1);
  assert.deepEqual(plan.steps, []);
});

test('detectIntent recognizes purchasing status keywords', () => {
  assert.equal(detectIntent('Что с закупками?'), INTENTS.PURCHASING_STATUS);
  assert.equal(detectIntent('статус закупок'), INTENTS.PURCHASING_STATUS);
});

test('detectIntent recognizes owner review keywords', () => {
  assert.equal(detectIntent('спорные позиции'), INTENTS.PURCHASING_OWNER_REVIEW);
  assert.equal(detectIntent('на решение владельца'), INTENTS.PURCHASING_OWNER_REVIEW);
});

test('detectIntent returns unknown for unrecognized message', () => {
  assert.equal(detectIntent('погода сегодня'), INTENTS.UNKNOWN);
});
