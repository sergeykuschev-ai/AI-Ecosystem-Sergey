'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { INTENTS, detectIntent } = require('../planner/intents');
const { createRuleBasedPlanBuilder } = require('../planner/plan_builder');
const { parseCreateTaskRequest } = require('../planner/task_request_parser');

const NOW = new Date('2026-08-13T00:00:00.000Z'); // 10:00 Thursday in Asia/Vladivostok.

function parse(message) {
  return parseCreateTaskRequest(message, {
    now: NOW,
    timezone: 'Asia/Vladivostok',
  });
}

test('createTask intent recognizes the supported deterministic Russian commands', () => {
  const messages = [
    'Артур, создай задачу позвонить поставщику',
    'Добавь задачу проверить цены',
    'Поставь мне задачу подготовить документы',
    'Запиши задачу получить договор',
    'Напомни мне проверить отчёт',
    'Надо сделать сверку',
    'Мне нужно сделать презентацию',
  ];
  for (const message of messages) {
    assert.equal(detectIntent(message), INTENTS.CORE_CREATE_TASK);
  }
});

test('implicit task intent recognizes conservative action-first phrases', () => {
  const messages = [
    'Позвонить поставщику завтра',
    'Завтра проверить цены Award',
    'В пятницу позвонить Валте',
    'Купить корм коту вечером',
    'До 18 августа подготовить документы',
    'Сегодня проверить задачи продавцов',
    'Срочно позвонить Валте',
    'Проверить отчёт до пятницы',
    'Написать бухгалтеру',
    'Записаться к врачу на следующей неделе',
  ];

  for (const message of messages) {
    assert.equal(detectIntent(message), INTENTS.CORE_CREATE_TASK, message);
  }
});

test('implicit task intent rejects questions, facts, discussion and noun-only messages', () => {
  const messages = [
    'Как позвонить поставщику завтра?',
    'Стоит ли завтра звонить поставщику?',
    'Я завтра позвоню поставщику',
    'Я уже позвонил поставщику',
    'Поставщик позвонит завтра',
    'Что делать с поставщиком?',
    'Расскажи про Award',
    'Почему надо проверить цены?',
    'Мне кажется, завтра будет дождь',
    'Позвонить поставщику завтра — хорошая идея?',
    'Проверить отчёт — хорошая идея',
    'Проверить отчёт было бы полезно',
    '«Позвонить поставщику завтра»',
    'Артур, «Позвонить поставщику завтра»',
    'Можно ли позвонить поставщику завтра?',
    'Не забудь, что поставщик работает до 17:00',
    'Что у меня по задачам?',
    'Что у меня сегодня?',
    'Кто я?',
    'Валта',
    'Отчёт',
    'Корм',
    'Япония',
    'Миска',
  ];

  for (const message of messages) {
    assert.notEqual(detectIntent(message), INTENTS.CORE_CREATE_TASK, message);
  }
});

test('implicit tasks reuse existing date and priority parsing', () => {
  const tomorrow = parse('Позвонить поставщику завтра');
  assert.deepEqual(tomorrow.task, {
    title: 'Позвонить поставщику',
    dueAt: '2026-08-14T13:59:59.999Z',
    dueLabel: 'завтра',
  });

  const dateFirst = parse('Завтра проверить цены Award');
  assert.equal(dateFirst.task.title, 'Проверить цены Award');
  assert.equal(dateFirst.task.dueAt, '2026-08-14T13:59:59.999Z');

  const exactTime = parse('Завтра в 15:00 позвонить поставщику');
  assert.equal(exactTime.task.title, 'Позвонить поставщику');
  assert.equal(exactTime.task.dueAt, '2026-08-14T05:00:00.000Z');

  const friday = parse('В пятницу позвонить Валте');
  assert.equal(friday.task.title, 'Позвонить Валте');
  assert.equal(friday.task.dueAt, '2026-08-14T13:59:59.999Z');

  const urgent = parse('Срочно проверить отчёт');
  assert.equal(urgent.task.title, 'Проверить отчёт');
  assert.equal(urgent.task.priority, 'critical');

  assert.deepEqual(parse('Написать бухгалтеру'), {
    ok: true,
    task: { title: 'Написать бухгалтеру' },
  });
});

test('createTask parser extracts a title and leaves priority absent for the Core default', () => {
  const result = parse('создай задачу позвонить поставщику');
  assert.deepEqual(result, {
    ok: true,
    task: { title: 'Позвонить поставщику' },
  });
  assert.equal(Object.hasOwn(result.task, 'priority'), false);
});

test('date-only tomorrow is the explicit end of day in Asia/Vladivostok', () => {
  const result = parse('создай задачу позвонить поставщику завтра');
  assert.equal(result.task.title, 'Позвонить поставщику');
  assert.equal(result.task.dueAt, '2026-08-14T13:59:59.999Z');
  assert.equal(result.task.dueLabel, 'завтра');
});

test('exact task time is interpreted in Asia/Vladivostok', () => {
  const result = parse('создай задачу завтра в 15:00 позвонить поставщику');
  assert.equal(result.task.title, 'Позвонить поставщику');
  assert.equal(result.task.dueAt, '2026-08-14T05:00:00.000Z');
  assert.equal(result.task.dueLabel, 'завтра в 15:00');
});

test('weekday resolves to the nearest strictly future weekday', () => {
  const result = parse('создай задачу в пятницу проверить цены');
  assert.equal(result.task.title, 'Проверить цены');
  assert.equal(result.task.dueAt, '2026-08-14T13:59:59.999Z');
  assert.equal(result.task.dueLabel, 'в пятницу');
});

test('supported concrete date forms resolve in the owner timezone', () => {
  const scenarios = [
    ['создай задачу подготовить документы до 18 августа', '2026-08-18T13:59:59.999Z'],
    ['создай задачу подготовить документы 18.08', '2026-08-18T13:59:59.999Z'],
    ['создай задачу подготовить документы 18.08.2026', '2026-08-18T13:59:59.999Z'],
  ];
  for (const [message, dueAt] of scenarios) {
    assert.equal(parse(message).task.dueAt, dueAt);
  }
});

test('explicit priority words map to the existing Core priority model', () => {
  const scenarios = [
    ['срочно', 'critical'],
    ['высокий приоритет', 'high'],
    ['обычная', 'normal'],
    ['низкий приоритет', 'low'],
  ];
  for (const [phrase, priority] of scenarios) {
    const result = parse(`создай задачу проверить цены ${phrase}`);
    assert.equal(result.task.priority, priority);
    assert.equal(result.task.title, 'Проверить цены');
  }
});

test('ambiguous or incomplete task requests ask for clarification without a task payload', () => {
  assert.equal(parse('создай задачу').ok, false);
  assert.match(parse('создай задачу завтра и в пятницу проверить цены').clarification, /несколько сроков/);
  assert.match(parse('создай задачу в 15:00 позвонить').clarification, /Укажи дату/);
});

test('createTask plan carries parsed data and Telegram source reference only when Core is registered', () => {
  const registered = createRuleBasedPlanBuilder({
    availableSkills: ['purchasing', 'arthur-core'],
    clock: () => NOW,
    ownerTimezone: 'Asia/Vladivostok',
  });
  const plan = registered.build({
    message: 'создай задачу позвонить поставщику завтра',
    transport: { metadata: { updateId: 42 } },
  });
  assert.equal(plan.steps[0].operation, 'createTask');
  assert.equal(plan.steps[0].parameters.title, 'Позвонить поставщику');
  assert.equal(plan.steps[0].parameters.sourceRef, 'telegram-update:42');

  const unavailable = createRuleBasedPlanBuilder({
    availableSkills: ['purchasing'],
    clock: () => NOW,
  });
  assert.deepEqual(unavailable.build({ message: 'создай задачу позвонить' }).steps, []);
});
