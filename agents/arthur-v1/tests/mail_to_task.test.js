'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createArthurV1, createMemoryInterface } = require('../index');
const { parseMailTaskActionReply } = require('../planner/mail_task_action_parser');
const { createMailboxRegistry } = require('../skills/mail/mailbox_registry');
const { createMailSkill } = require('../skills/mail/mail_skill');
const {
  createMailTaskProposal,
} = require('../skills/mail/mail_task_proposal');
const { createFakeYandexAdapter } = require('../skills/mail/providers/fake_yandex_adapter');
const { createSenderAliasRegistry } = require('../skills/mail/sender_alias_registry');

const START = new Date('2026-08-15T04:00:00.000Z');
const MISKA_MAILBOX = Object.freeze({
  mailboxId: 'miska-yandex',
  provider: 'yandex',
  accountType: 'work',
  businessContext: 'miska',
  displayName: 'Почта Миски',
});
const SILENT_LOGGER = Object.freeze({
  info() {},
  warn() {},
  error() {},
});

function mailMessage(overrides = {}) {
  return {
    messageId: 'INBOX:42:1001',
    threadId: null,
    from: [{ name: 'Анна Размовенко', address: null }],
    to: [{ name: 'Миска', address: null }],
    subject: 'Валта прайс 14.08.26 общ.xlsx, ПРОМО...',
    receivedAt: '2026-08-15T03:00:00.000Z',
    snippet: 'Ограниченный безопасный фрагмент.',
    body: 'full body must never leave mail',
    attachments: [{ filename: 'price.xlsx' }],
    isUnread: true,
    labels: [],
    folder: 'INBOX',
    sourceRef: 'yandex:INBOX:42:1001',
    ...overrides,
  };
}

function createHarness(options = {}) {
  let nowMs = START.getTime();
  let tasks = (options.tasks || []).map(task => ({ ...task }));
  const createCalls = [];
  const transitionCalls = [];
  const coreCalls = [];
  const clock = () => new Date(nowMs);
  const memory = createMemoryInterface({
    clock,
    pendingMailActionTtlMs: options.pendingMailActionTtlMs,
  });
  const yandex = createFakeYandexAdapter({ messages: options.messages || [mailMessage()] });
  const mailSkill = createMailSkill({
    mailboxRegistry: createMailboxRegistry([MISKA_MAILBOX]),
    adapters: { yandex },
    clock,
  });
  const coreClient = {
    async getProfile(ownerId) {
      coreCalls.push({ operation: 'getProfile', ownerId });
      return { id: ownerId, name: 'Сергей' };
    },
    async listTasks(ownerId) {
      coreCalls.push({ operation: 'listTasks', ownerId });
      return tasks.filter(task => !['done', 'cancelled'].includes(task.status));
    },
    async getTaskBrief(ownerId) {
      coreCalls.push({ operation: 'getTaskBrief', ownerId });
      return { today: [], overdue: [], upcoming: [], waiting: [] };
    },
    async createTask(ownerId, task, context) {
      const record = {
        ...task,
        id: `task-${tasks.length + 1}`,
        ownerId,
        status: 'new',
        priority: task.priority || 'normal',
      };
      tasks.push(record);
      createCalls.push({ ownerId, task: { ...task }, context: { ...context } });
      return { ...record };
    },
    async transitionTask(ownerId, taskId, status, patch, context) {
      const index = tasks.findIndex(task => task.id === taskId
        && task.ownerId === ownerId
        && !['done', 'cancelled'].includes(task.status));
      if (index < 0) throw new Error('Task not found');
      tasks[index] = { ...tasks[index], ...patch, status };
      transitionCalls.push({ ownerId, taskId, status, patch: { ...patch }, context: { ...context } });
      return { ...tasks[index] };
    },
    async health() {
      return { healthy: true };
    },
  };
  const aiProvider = {
    async generate() {
      return 'Обычный разговор работает.';
    },
    async synthesize() {
      throw new Error('AI must not synthesize mail-to-task confirmation');
    },
    async health() {
      return { healthy: true, provider: 'test' };
    },
  };
  const arthur = createArthurV1({
    coreConfig: {
      baseUrl: 'http://arthur-core.test:8787',
      token: 'test-token',
      timeoutMs: 1000,
      ownerProfileId: 'sergey',
      ownerTimezone: 'Asia/Vladivostok',
    },
    coreClient,
    mailSkill,
    memory,
    clock,
    aiProvider,
    knowledgeDirectories: [],
    logger: SILENT_LOGGER,
  });

  return {
    arthur,
    coreCalls,
    createCalls,
    mailCalls: yandex.calls,
    memory,
    transitionCalls,
    tasks: () => tasks.map(task => ({ ...task })),
    advance(ms) {
      nowMs += ms;
    },
  };
}

function request(arthur, message, conversationId = 'conversation-A') {
  return arthur.handle({
    message,
    userId: 'sergey',
    conversationId,
    channel: 'telegram',
  });
}

test('mail task confirmations recognize only bounded explicit replies', () => {
  for (const message of ['да', 'Создай', 'создать', 'сделай', 'ок', 'хорошо', 'давай']) {
    assert.deepEqual(parseMailTaskActionReply(message), { type: 'confirm' });
  }
  for (const message of ['нет', 'не надо', 'Отмена', 'не создавать']) {
    assert.deepEqual(parseMailTaskActionReply(message), { type: 'reject' });
  }
  assert.deepEqual(parseMailTaskActionReply('Создай по Валте'), {
    type: 'target',
    query: 'валте',
    aliasId: 'valta',
  });
  assert.equal(parseMailTaskActionReply('Что у меня по задачам?'), null);
});

test('task title proposal uses company and subject signals without body data', () => {
  const registry = createSenderAliasRegistry();
  const price = createMailTaskProposal(mailMessage({ provider: 'yandex' }), registry);
  const zoograd = createMailTaskProposal(mailMessage({
    provider: 'yandex',
    sourceRef: 'yandex:INBOX:42:1002',
    from: [{ name: 'Оникиенко', address: null }],
    subject: 'Оникиенко Зооград',
  }), registry);

  assert.equal(price.title, 'Проверить прайс Валты');
  assert.equal(price.sourceRef, 'mail:yandex:INBOX:42:1001');
  assert.equal(zoograd.title, 'Проверить письмо Зоограда');
  assert.equal(JSON.stringify([price, zoograd]).includes('full body'), false);
  assert.equal(Object.hasOwn(price, 'snippet'), false);
});

test('found sender mail proposes a task without creating it', async () => {
  const harness = createHarness();
  const response = await request(harness.arthur, 'Пришёл ответ от Валты?');
  const pending = await harness.memory.loadPendingMailAction('sergey', 'conversation-A');

  assert.equal(harness.createCalls.length, 0);
  assert.match(response.answer.text, /Создать задачу «Проверить прайс Валты»/);
  assert.equal(pending.action, 'createTaskFromMail');
  assert.equal(pending.candidates.length, 1);
  assert.equal(pending.candidates[0].sourceRef, 'mail:yandex:INBOX:42:1001');
  assert.equal(pending.createdAt, '2026-08-15T04:00:00.000Z');
  assert.equal(pending.expiresAt, '2026-08-15T04:10:00.000Z');
  assert.doesNotMatch(JSON.stringify(pending), /full body|Ограниченный безопасный фрагмент|price\.xlsx/);
});

test('positive confirmation creates exactly one canonical-owner task with mail sourceRef', async () => {
  const harness = createHarness();
  await request(harness.arthur, 'Пришёл ответ от Валты?');
  const response = await request(harness.arthur, 'Да');
  await request(harness.arthur, 'Да');

  assert.equal(harness.createCalls.length, 1);
  assert.equal(harness.createCalls[0].ownerId, 'sergey');
  assert.deepEqual(harness.createCalls[0].task, {
    title: 'Проверить прайс Валты',
    domain: 'personal',
    sourceType: 'telegram',
    sourceRef: 'mail:yandex:INBOX:42:1001',
  });
  assert.match(response.answer.text, /Готово\. Задача создана:\nПроверить прайс Валты/);
  assert.doesNotMatch(JSON.stringify(harness.createCalls[0]), /full body|snippet|attachment/);
  assert.equal(await harness.memory.loadPendingMailAction('sergey', 'conversation-A'), null);
});

test('negative confirmation clears pending action without a task write', async () => {
  const harness = createHarness();
  await request(harness.arthur, 'Пришёл ответ от Валты?');
  const response = await request(harness.arthur, 'Нет');

  assert.equal(response.answer.text, 'Хорошо, задачу не создаю.');
  assert.equal(harness.createCalls.length, 0);
  assert.equal(await harness.memory.loadPendingMailAction('sergey', 'conversation-A'), null);
});

test('expired mail proposal never creates a task from a late confirmation', async () => {
  const harness = createHarness();
  await request(harness.arthur, 'Пришёл ответ от Валты?');
  harness.advance(10 * 60 * 1000 + 1);
  const response = await request(harness.arthur, 'Да');

  assert.equal(response.answer.text, 'Это предложение уже устарело. Скажи, какую задачу создать.');
  assert.equal(harness.createCalls.length, 0);
  assert.equal(await harness.memory.loadPendingMailAction('sergey', 'conversation-A'), null);
});

test('unrelated task question clears mail pending and follows normal routing', async () => {
  const harness = createHarness();
  await request(harness.arthur, 'Пришёл ответ от Валты?');
  const response = await request(harness.arthur, 'Что у меня по задачам?');

  assert.equal(response.answer.text, 'Активных задач сейчас нет.');
  assert.equal(harness.createCalls.length, 0);
  assert.equal(harness.coreCalls.filter(call => call.operation === 'listTasks').length, 1);
  assert.equal(await harness.memory.loadPendingMailAction('sergey', 'conversation-A'), null);
});

test('production regression: pasted active-task response resolves cancel before mail routing', async () => {
  const harness = createHarness({
    tasks: [{
      id: 'task-valta',
      ownerId: 'sergey',
      title: 'Проверить письмо Валты',
      status: 'new',
      dueAt: null,
    }],
  });
  const clarification = await request(harness.arthur, 'Отмени');
  const response = await request(
    harness.arthur,
    'У тебя 1 активная задача:\n\n1. Проверить письмо Валты'
  );

  assert.match(clarification.answer.text, /Что именно отменить/);
  assert.equal(response.answer.text, 'Готово. Задача отменена:\nПроверить письмо Валты');
  assert.deepEqual(harness.transitionCalls.map(call => call.taskId), ['task-valta']);
  assert.equal(harness.tasks()[0].status, 'cancelled');
  assert.equal(harness.mailCalls.length, 0);
  assert.equal(await harness.memory.loadPendingTaskClarification('sergey', 'conversation-A'), null);
});

test('exact task title continues pending cancel without running mail search', async () => {
  const harness = createHarness({
    tasks: [{
      id: 'task-valta', ownerId: 'sergey', title: 'Проверить письмо Валты',
      status: 'new', dueAt: null,
    }],
  });
  await request(harness.arthur, 'Отмени');
  await request(harness.arthur, 'Проверить письмо Валты');

  assert.deepEqual(harness.transitionCalls.map(call => call.taskId), ['task-valta']);
  assert.equal(harness.mailCalls.length, 0);
});

test('known company alias continues pending cancel and keeps ambiguity safe', async () => {
  const unique = createHarness({
    tasks: [{
      id: 'task-valta', ownerId: 'sergey', title: 'Проверить письмо Валты',
      status: 'new', dueAt: null,
    }],
  });
  await request(unique.arthur, 'Отмени');
  await request(unique.arthur, 'Валта');
  assert.deepEqual(unique.transitionCalls.map(call => call.taskId), ['task-valta']);
  assert.equal(unique.mailCalls.length, 0);

  const ambiguous = createHarness({
    tasks: [
      { id: 'task-price', ownerId: 'sergey', title: 'Проверить прайс Валты', status: 'new' },
      { id: 'task-order', ownerId: 'sergey', title: 'Проверить заказ Валты', status: 'new' },
    ],
  });
  await request(ambiguous.arthur, 'Отмени');
  const response = await request(ambiguous.arthur, 'Валта');
  assert.match(response.answer.text, /Нашёл 2 подходящие задачи/);
  assert.equal(ambiguous.transitionCalls.length, 0);
  assert.equal(ambiguous.mailCalls.length, 0);
  assert.ok(await ambiguous.memory.loadPendingTaskClarification('sergey', 'conversation-A'));
});

test('explicit independent mail command interrupts task clarification and follows mail routing', async () => {
  const harness = createHarness({
    tasks: [{
      id: 'task-valta', ownerId: 'sergey', title: 'Проверить письмо Валты',
      status: 'new', dueAt: null,
    }],
  });
  await request(harness.arthur, 'Отмени');
  const response = await request(harness.arthur, 'Что важного в почте Миски сегодня?');

  assert.match(response.answer.text, /Что важного в почте Миски/);
  assert.equal(harness.transitionCalls.length, 0);
  assert.ok(harness.mailCalls.length > 0);
  assert.equal(await harness.memory.loadPendingTaskClarification('sergey', 'conversation-A'), null);
});

test('unrelated conversational text cannot trigger either task or mail write while clarification is active', async () => {
  const harness = createHarness({
    tasks: [{
      id: 'task-valta', ownerId: 'sergey', title: 'Проверить письмо Валты',
      status: 'new', dueAt: null,
    }],
  });
  await request(harness.arthur, 'Отмени');
  const response = await request(harness.arthur, 'Расскажи про Валту');

  assert.match(response.answer.text, /Не нашёл такую задачу среди предложенных/);
  assert.equal(harness.transitionCalls.length, 0);
  assert.equal(harness.createCalls.length, 0);
  assert.equal(harness.mailCalls.length, 0);
  assert.ok(await harness.memory.loadPendingTaskClarification('sergey', 'conversation-A'));
});

test('mail proposal confirmation is isolated by conversation and canonical owner', async () => {
  const harness = createHarness();
  await request(harness.arthur, 'Пришёл ответ от Валты?', 'conversation-A');
  await request(harness.arthur, 'Да', 'conversation-B');

  assert.equal(harness.createCalls.length, 0);
  assert.ok(await harness.memory.loadPendingMailAction('sergey', 'conversation-A'));
  assert.equal(await harness.memory.loadPendingMailAction('telegram-user', 'conversation-A'), null);

  await request(harness.arthur, 'Да', 'conversation-A');
  assert.equal(harness.createCalls.length, 1);
  assert.equal(harness.createCalls[0].ownerId, 'sergey');
});

test('existing duplicate guard blocks confirmed mail task duplicate', async () => {
  const harness = createHarness({
    tasks: [{
      id: 'task-existing',
      ownerId: 'sergey',
      title: 'Проверить прайс Валты',
      status: 'new',
      dueAt: null,
    }],
  });
  await request(harness.arthur, 'Пришёл ответ от Валты?');
  const response = await request(harness.arthur, 'Создай');

  assert.equal(harness.createCalls.length, 0);
  assert.match(response.answer.text, /Такая задача уже есть:\nПроверить прайс Валты/);
});

test('multiple matching mails require a specific selection before task creation', async () => {
  const harness = createHarness({
    messages: [
      mailMessage({ messageId: 'price', sourceRef: 'yandex:price' }),
      mailMessage({
        messageId: 'order',
        sourceRef: 'yandex:order',
        subject: 'Валта заказ на поставку',
        receivedAt: '2026-08-15T02:00:00.000Z',
      }),
    ],
  });
  const found = await request(harness.arthur, 'Покажи письма от Валты');
  const ambiguous = await request(harness.arthur, 'Да');

  assert.match(found.answer.text, /Уточни номер или компанию/);
  assert.match(ambiguous.answer.text, /Есть несколько вариантов/);
  assert.equal(harness.createCalls.length, 0);

  const selected = await request(harness.arthur, '2');
  assert.equal(harness.createCalls.length, 1);
  assert.equal(harness.createCalls[0].task.sourceRef, 'mail:yandex:order');
  assert.match(selected.answer.text, /Задача создана/);
});

test('company selection after important summary creates only the matching proposal', async () => {
  const harness = createHarness({
    messages: [
      mailMessage({ messageId: 'valta', sourceRef: 'yandex:valta' }),
      mailMessage({
        messageId: 'zoograd',
        sourceRef: 'yandex:zoograd',
        from: [{ name: 'Оникиенко', address: null }],
        subject: 'Зооград поставка и наличие',
        receivedAt: '2026-08-15T02:00:00.000Z',
      }),
    ],
  });
  const summary = await request(harness.arthur, 'Что важного в почте Миски сегодня?');
  const created = await request(harness.arthur, 'Создай по Валте');

  assert.match(summary.answer.text, /Уточни номер или компанию/);
  assert.equal(harness.createCalls.length, 1);
  assert.equal(harness.createCalls[0].task.title, 'Проверить прайс Валты');
  assert.equal(harness.createCalls[0].task.sourceRef, 'mail:yandex:valta');
  assert.doesNotMatch(created.answer.text, /Зооград/);
});

test('no mail found creates no proposal and no pending action', async () => {
  const harness = createHarness({ messages: [] });
  const response = await request(harness.arthur, 'Пришёл ответ от Валты?');

  assert.doesNotMatch(response.answer.text, /Создать задачу/);
  assert.equal(harness.createCalls.length, 0);
  assert.equal(await harness.memory.loadPendingMailAction('sergey', 'conversation-A'), null);
});
