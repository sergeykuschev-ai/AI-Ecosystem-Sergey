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

test('task brief plan selects compact today and overdue views', () => {
  const builder = createRuleBasedPlanBuilder();
  const today = builder.build({ message: 'Что у меня сегодня?' });
  const overdue = builder.build({ message: 'Какие задачи просрочены?' });

  assert.equal(today.steps[0].parameters.view, 'today');
  assert.equal(overdue.steps[0].parameters.view, 'overdue');
});

test('unread mail phrases build the only Stage 1 MailSkill operation', () => {
  const builder = createRuleBasedPlanBuilder({ availableSkills: ['purchasing', 'mail'] });
  const scenarios = [
    ['Покажи непрочитанные письма', {}],
    ['Есть непрочитанные письма?', {}],
    ['Покажи непрочитанные письма по Миске', { businessContext: 'miska' }],
    ['Есть новые непрочитанные письма по Миске?', { businessContext: 'miska' }],
  ];

  for (const [message, parameters] of scenarios) {
    assert.equal(detectIntent(message), INTENTS.MAIL_UNREAD);
    const plan = builder.build({ message });
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].skill, 'mail');
    assert.equal(plan.steps[0].operation, 'listUnreadMail');
    assert.deepEqual(plan.steps[0].parameters, parameters);
  }
});

test('unread mail plan is empty when MailSkill is not registered', () => {
  const builder = createRuleBasedPlanBuilder({ availableSkills: ['purchasing'] });
  assert.deepEqual(builder.build({ message: 'Покажи непрочитанные письма' }).steps, []);
});

test('recent mail phrases build bounded listRecentMail plans', () => {
  const now = new Date('2026-08-15T04:00:00.000Z');
  const builder = createRuleBasedPlanBuilder({
    availableSkills: ['mail'],
    clock: () => now,
  });
  const message = 'Покажи последние письма по Миске за 24 часа';
  assert.equal(detectIntent(message), INTENTS.MAIL_RECENT);
  const plan = builder.build({ message });

  assert.equal(plan.steps[0].operation, 'listRecentMail');
  assert.equal(plan.steps[0].parameters.businessContext, 'miska');
  assert.equal(plan.steps[0].parameters.since, '2026-08-14T04:00:00.000Z');
});

test('sender questions deterministically route to findMessagesFromSender', () => {
  const now = new Date('2026-08-15T04:00:00.000Z');
  const builder = createRuleBasedPlanBuilder({ availableSkills: ['mail'], clock: () => now });
  for (const [message, sender, limit] of [
    ['Пришёл ответ от Валты?', 'Валты', 1],
    ['Есть письма от Premium Pet?', 'Premium Pet', 1],
    ['Покажи письма от Premium Pet', 'Premium Pet', 10],
  ]) {
    assert.equal(detectIntent(message), INTENTS.MAIL_SENDER);
    const plan = builder.build({ message });
    assert.equal(plan.steps[0].operation, 'findMessagesFromSender');
    assert.equal(plan.steps[0].parameters.sender, sender);
    assert.equal(plan.steps[0].parameters.businessContext, 'miska');
    assert.equal(plan.steps[0].parameters.limit, limit);
    assert.equal(plan.steps[0].parameters.since, '2026-08-08T04:00:00.000Z');
    assert.equal(plan.steps[0].timeoutMs, 30000);
  }
});

test('subject search is deterministic and never accepts raw IMAP syntax', () => {
  const now = new Date('2026-08-15T04:00:00.000Z');
  const builder = createRuleBasedPlanBuilder({ availableSkills: ['mail'], clock: () => now });
  const message = 'Найди письма по Миске с темой Новый прайс';
  assert.equal(detectIntent(message), INTENTS.MAIL_SEARCH);
  const plan = builder.build({ message });

  assert.equal(plan.steps[0].operation, 'searchMail');
  assert.equal(plan.steps[0].parameters.subject, 'Новый прайс');
  assert.equal(plan.steps[0].parameters.businessContext, 'miska');
  assert.equal(plan.steps[0].parameters.raw, undefined);
  assert.equal(plan.steps[0].parameters.query, undefined);
});

test('important Miska mail intent uses a calendar day and dedicated deterministic capability', () => {
  const now = new Date('2026-08-15T04:00:00.000Z');
  const builder = createRuleBasedPlanBuilder({
    availableSkills: ['mail'],
    clock: () => now,
    ownerTimezone: 'Asia/Vladivostok',
  });
  for (const message of [
    'Что важного в почте по Миске сегодня?',
    'Что важного в почте Миски?',
    'Что важного по почте Миски сегодня?',
    'Что важного по Миске в почте?',
    'Есть важные письма по Миске?',
    'Что важного пришло сегодня?',
  ]) {
    assert.equal(detectIntent(message), INTENTS.MAIL_IMPORTANT);
    const plan = builder.build({ message });
    assert.equal(plan.steps[0].operation, 'summarizeImportantMail');
    assert.deepEqual(plan.steps[0].parameters, {
      businessContext: 'miska',
      since: '2026-08-14T14:00:00.000Z',
      limit: 20,
    });
    assert.equal(plan.steps[0].timeoutMs, 30000);
  }
});

test('important mail distinguishes rolling 24-hour and 7-day windows from today', () => {
  const now = new Date('2026-08-15T04:00:00.000Z');
  const builder = createRuleBasedPlanBuilder({
    availableSkills: ['mail'],
    clock: () => now,
    ownerTimezone: 'Asia/Vladivostok',
  });
  const last24 = builder.build({ message: 'Что важного в почте Миски за последние 24 часа?' });
  const last7Days = builder.build({ message: 'Что важного в почте Миски за последние 7 дней?' });

  assert.equal(last24.steps[0].parameters.since, '2026-08-14T04:00:00.000Z');
  assert.equal(last7Days.steps[0].parameters.since, '2026-08-08T04:00:00.000Z');
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

test('mail routing does not change task or purchasing intents', () => {
  assert.equal(detectIntent('Что у меня по задачам?'), INTENTS.CORE_TASKS);
  assert.equal(detectIntent('Что с закупками?'), INTENTS.PURCHASING_STATUS);
  assert.equal(detectIntent('Покажи спорные позиции'), INTENTS.PURCHASING_OWNER_REVIEW);
});

test('detectIntent returns unknown for unrecognized message', () => {
  assert.equal(detectIntent('погода сегодня'), INTENTS.UNKNOWN);
});
