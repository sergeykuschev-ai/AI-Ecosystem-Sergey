'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  formatDuplicateWaitingResponse,
  formatWaitingResponse,
  isDuplicateWaitingTask,
  matchesWaitingTaskIntent,
  parseWaitingRequest,
  waitingRequestHasExplicitCheckAt,
} = require('../planner/waiting_request_parser');
const { createSenderAliasRegistry } = require('../skills/mail/sender_alias_registry');

const NOW = new Date('2026-08-13T00:00:00.000Z'); // 10:00 Thursday in Asia/Vladivostok.

function parse(message, options = {}) {
  return parseWaitingRequest(message, {
    now: NOW,
    timezone: 'Asia/Vladivostok',
    ...options,
  });
}

test('matchesWaitingTaskIntent recognizes explicit waiting phrases', () => {
  const messages = [
    'Жду ответ от Premium Pet',
    'Жду ответ от Premium Pet по поставке',
    'Запомни, что жду Валту',
    'Жду от Зоограда подтверждение заказа',
    'Артур, жду ответ от Premium Pet',
    'Жду ответа от Валты',
    'Жду от Premium Pet',
  ];
  for (const message of messages) {
    assert.equal(matchesWaitingTaskIntent(message), true, message);
  }
});

test('matchesWaitingTaskIntent rejects mail arrival questions', () => {
  const messages = [
    'Пришел ответ от Валты?',
    'Есть письма от Premium Pet?',
    'Покажи письма от Зоограда',
    'Что важного в почте?',
    'Позвонить поставщику',
    'Купить корм',
  ];
  for (const message of messages) {
    assert.equal(matchesWaitingTaskIntent(message), false, message);
  }
});

test('parseWaitingRequest extracts company and topic without date', () => {
  const result = parse('Жду ответ от Premium Pet по поставке');
  assert.equal(result.ok, true);
  assert.equal(result.task.title, 'Ждать ответ от Premium Pet по поставке');
  assert.equal(result.task.status, 'waiting');
  assert.equal(result.task.waitingFor, 'Premium Pet');
  assert.equal(result.task.description, 'topic: поставке');
  assert.equal(result.task.nextCheckAt, null);
  assert.equal(result.task.dueLabel, undefined);
  assert.equal(waitingRequestHasExplicitCheckAt(result), false);
});

test('parseWaitingRequest extracts company without topic', () => {
  const result = parse('Жду ответ от Premium Pet');
  assert.equal(result.ok, true);
  assert.equal(result.task.title, 'Ждать ответ от Premium Pet');
  assert.equal(result.task.waitingFor, 'Premium Pet');
  assert.equal(Object.hasOwn(result.task, 'description'), false);
  assert.equal(result.task.nextCheckAt, null);
});

test('parseWaitingRequest handles "запомни, что жду" form', () => {
  const result = parse('Запомни, что жду Валту');
  assert.equal(result.ok, true);
  assert.equal(result.task.title, 'Ждать Валта');
  assert.equal(result.task.waitingFor, 'Валта');
  assert.equal(result.task.status, 'waiting');
});

test('parseWaitingRequest handles topic after sender without explicit "по"', () => {
  const result = parse('Жду от Зоограда подтверждение заказа');
  assert.equal(result.ok, true);
  assert.equal(result.task.waitingFor, 'Зооград');
  assert.equal(result.task.description, 'topic: подтверждение заказа');
  assert.equal(result.task.title, 'Ждать от Зооград подтверждение заказа');
});

test('parseWaitingRequest extracts explicit next check date in owner timezone', () => {
  const result = parse('Жду ответ от Premium Pet до пятницы');
  assert.equal(result.ok, true);
  assert.equal(result.task.waitingFor, 'Premium Pet');
  assert.equal(result.task.nextCheckAt, '2026-08-14T13:59:59.999Z');
  assert.equal(result.task.dueLabel, 'в пятницу');
  assert.equal(waitingRequestHasExplicitCheckAt(result), true);
});

test('parseWaitingRequest does not invent nextCheckAt when no date is given', () => {
  const result = parse('Жду ответ от Premium Pet');
  assert.equal(result.ok, true);
  assert.equal(result.task.nextCheckAt, null);
  assert.equal(result.task.dueLabel, undefined);
});

test('parseWaitingRequest canonicalizes known company aliases', () => {
  const result = parse('Жду ответ от Валты');
  assert.equal(result.ok, true);
  assert.equal(result.task.waitingFor, 'Валта');
  assert.equal(result.task.title, 'Ждать ответ от Валта');
});

test('parseWaitingRequest falls back to first word for unknown company', () => {
  const result = parse('Жду ответ от ООО Ромашка');
  assert.equal(result.ok, true);
  assert.equal(result.task.waitingFor, 'ООО');
});

test('parseWaitingRequest rejects messages without a company', () => {
  const result = parse('Жду');
  assert.equal(result.ok, false);
  assert.match(result.clarification, /от кого/);
});

test('parseWaitingRequest rejects non-waiting messages', () => {
  const result = parse('Пришел ответ от Валты?');
  assert.equal(result.ok, false);
});

test('formatWaitingResponse renders topic and explicit check date', () => {
  const response = formatWaitingResponse({
    waitingFor: 'Premium Pet',
    description: 'topic: поставке',
    dueLabel: 'пятница',
  });
  assert.equal(response, 'Запомнил. Ждём ответ от Premium Pet по поставке.\nПроверить: пятница.');
});

test('formatWaitingResponse renders company only when no topic or date', () => {
  const response = formatWaitingResponse({
    waitingFor: 'Premium Pet',
  });
  assert.equal(response, 'Запомнил. Ждём ответ от Premium Pet.');
});

test('formatDuplicateWaitingResponse renders topic', () => {
  const response = formatDuplicateWaitingResponse({
    waitingFor: 'Premium Pet',
    description: 'topic: поставке',
  });
  assert.equal(response, 'Такое ожидание уже есть:\nPremium Pet — по поставке.');
});

test('formatDuplicateWaitingResponse renders company only when no topic', () => {
  const response = formatDuplicateWaitingResponse({
    waitingFor: 'Premium Pet',
  });
  assert.equal(response, 'Такое ожидание уже есть:\nPremium Pet.');
});

test('isDuplicateWaitingTask matches same company and topic', () => {
  const existing = {
    status: 'waiting',
    waitingFor: 'Premium Pet',
    description: 'topic: поставка',
  };
  assert.equal(isDuplicateWaitingTask(existing, {
    status: 'waiting',
    waitingFor: 'Premium Pet',
    description: 'topic: поставка',
  }), true);
});

test('isDuplicateWaitingTask rejects different topic', () => {
  const existing = {
    status: 'waiting',
    waitingFor: 'Premium Pet',
    description: 'topic: поставка',
  };
  assert.equal(isDuplicateWaitingTask(existing, {
    status: 'waiting',
    waitingFor: 'Premium Pet',
    description: 'topic: заказ',
  }), false);
});

test('isDuplicateWaitingTask rejects non-waiting task', () => {
  const existing = {
    status: 'new',
    waitingFor: 'Premium Pet',
    description: 'topic: поставка',
  };
  assert.equal(isDuplicateWaitingTask(existing, {
    status: 'waiting',
    waitingFor: 'Premium Pet',
    description: 'topic: поставка',
  }), false);
});

test('isDuplicateWaitingTask normalizes case and punctuation', () => {
  const existing = {
    status: 'waiting',
    waitingFor: 'premium pet',
    description: 'topic: ПОСТАВКА',
  };
  assert.equal(isDuplicateWaitingTask(existing, {
    status: 'waiting',
    waitingFor: 'Premium Pet',
    description: 'topic: поставка',
  }), true);
});
