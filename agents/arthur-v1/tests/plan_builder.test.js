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

test('knowledge.search intent builds knowledge step', () => {
  const builder = createRuleBasedPlanBuilder();
  const plan = builder.build({ message: 'матрица', intent: INTENTS.KNOWLEDGE_SEARCH });
  assert.equal(plan.steps[0].skill, 'knowledge');
  assert.equal(plan.steps[0].operation, 'search');
  assert.equal(plan.steps[0].parameters.query, 'матрица');
});

test('unknown intent falls back to knowledge search', () => {
  const builder = createRuleBasedPlanBuilder();
  const plan = builder.build({ message: 'абракадабра' });
  assert.equal(plan.steps[0].skill, 'knowledge');
  assert.equal(plan.steps[0].operation, 'search');
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
