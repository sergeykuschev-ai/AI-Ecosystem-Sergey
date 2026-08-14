'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TASK_MANAGEMENT_ACTIONS,
  detectTaskManagementAction,
  parseTaskClarificationReply,
  parseTaskManagementRequest,
} = require('../planner/task_management_parser');
const { INTENTS, detectIntent } = require('../planner/intents');
const { createRuleBasedPlanBuilder } = require('../planner/plan_builder');

const NOW = new Date('2026-08-13T00:00:00.000Z');

function parse(message) {
  return parseTaskManagementRequest(message, {
    now: NOW,
    timezone: 'Asia/Vladivostok',
  });
}

test('complete task phrases produce canonical task references', () => {
  const scenarios = [
    ['Я позвонил поставщику', 'Позвонить поставщику'],
    ['Задача позвонить поставщику выполнена', 'Позвонить поставщику'],
    ['Выполнил задачу проверить отчёт', 'Проверить отчёт'],
    ['Закрой задачу позвонить Валте', 'Позвонить Валте'],
  ];
  for (const [message, title] of scenarios) {
    assert.equal(detectTaskManagementAction(message), TASK_MANAGEMENT_ACTIONS.COMPLETE);
    assert.deepEqual(parse(message), { ok: true, action: 'complete', title });
  }
  assert.deepEqual(parse('Отметь задачу как выполненную'), { ok: true, action: 'complete' });
});

test('cancel task phrases treat delete wording as cancellation', () => {
  for (const message of ['Отмени задачу позвонить поставщику', 'Удали задачу позвонить поставщику']) {
    assert.deepEqual(parse(message), {
      ok: true,
      action: 'cancel',
      title: 'Позвонить поставщику',
    });
  }
  assert.deepEqual(parse('Отмени задачу 2'), {
    ok: true,
    action: 'cancel',
    taskNumber: 2,
  });
});

test('reschedule phrases reuse the existing Vladivostok date parser', () => {
  const scenarios = [
    ['Перенеси звонок поставщику на пятницу', 'Позвонить поставщику', '2026-08-14T13:59:59.999Z'],
    ['Перенеси задачу позвонить поставщику на завтра', 'Позвонить поставщику', '2026-08-14T13:59:59.999Z'],
    ['Позвонить поставщику перенеси на понедельник', 'Позвонить поставщику', '2026-08-17T13:59:59.999Z'],
    ['Измени срок задачи проверить отчёт на 18 августа', 'Проверить отчёт', '2026-08-18T13:59:59.999Z'],
  ];
  for (const [message, title, dueAt] of scenarios) {
    const result = parse(message);
    assert.equal(result.action, 'reschedule');
    assert.equal(result.title, title);
    assert.equal(result.dueAt, dueAt);
  }
});

test('questions and speculative statements never become task writes', () => {
  const messages = [
    'Стоит ли отменить задачу?',
    'Как выполнить задачу?',
    'Почему перенесли задачу?',
    'Я, возможно, позвоню завтра',
  ];
  for (const message of messages) {
    assert.equal(detectTaskManagementAction(message), null, message);
  }
});

test('task clarification replies accept numeric and Russian ordinal selections', () => {
  const scenarios = [
    ['1', 1],
    ['2', 2],
    ['3', 3],
    ['первая', 1],
    ['первую', 1],
    ['вторая', 2],
    ['вторую', 2],
    ['третья', 3],
    ['третью', 3],
  ];
  for (const [message, taskNumber] of scenarios) {
    assert.deepEqual(parseTaskClarificationReply(message), { type: 'selection', taskNumber });
  }
});

test('task clarification replies recognize dialogue cancellation only as exact short answers', () => {
  for (const message of ['не надо', 'Отмена', 'отбой']) {
    assert.deepEqual(parseTaskClarificationReply(message), { type: 'cancel' });
  }
  assert.equal(parseTaskClarificationReply('Отмени задачу проверить отчёт'), null);
  assert.equal(parseTaskClarificationReply('Что у меня по задачам?'), null);
});

test('management intents build deterministic Arthur Core operations', () => {
  const builder = createRuleBasedPlanBuilder({
    availableSkills: ['purchasing', 'arthur-core'],
    clock: () => NOW,
    ownerTimezone: 'Asia/Vladivostok',
  });
  const scenarios = [
    ['Я позвонил поставщику', INTENTS.CORE_COMPLETE_TASK, 'completeTask'],
    ['Отмени задачу проверить отчёт', INTENTS.CORE_CANCEL_TASK, 'cancelTask'],
    ['Перенеси задачу позвонить поставщику на пятницу', INTENTS.CORE_RESCHEDULE_TASK, 'rescheduleTask'],
  ];
  for (const [message, intent, operation] of scenarios) {
    assert.equal(detectIntent(message), intent);
    const plan = builder.build({ message });
    assert.equal(plan.steps[0].skill, 'arthur-core');
    assert.equal(plan.steps[0].operation, operation);
  }
});
