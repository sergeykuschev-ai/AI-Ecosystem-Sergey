'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createArthurV1, createMemoryInterface } = require('../index');
const { createFakeAIProvider } = require('../ai/fake_provider');
const {
  ArthurCoreAuthError,
  ArthurCoreInvalidResponseError,
  ArthurCoreNetworkError,
  ArthurCoreNotFoundError,
  ArthurCoreServerError,
  ArthurCoreTimeoutError,
  createArthurCoreClient,
} = require('../skills/arthur-core/core_client');
const {
  createArthurCoreSkill,
  formatBriefResponse,
} = require('../skills/arthur-core/arthur_core_skill');

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload);
    },
  };
}

function coreConfig(fetchImpl, overrides = {}) {
  return {
    baseUrl: 'http://arthur-core.test:8787',
    token: 'test-core-token',
    timeoutMs: 1000,
    ownerProfileId: 'sergey',
    fetchImpl,
    ...overrides,
  };
}

function capturingAIProvider() {
  return {
    generateSystem: null,
    async generate(message, options = {}) {
      this.generateSystem = options.system || null;
      return 'Обычный разговор работает.';
    },
    async synthesize(input) {
      const summary = input.skillOutputs[0]?.data?.summary || 'Данные получены.';
      return { text: summary, markdown: summary, confidence: 'high', followUps: [] };
    },
    async health() {
      return { healthy: true, provider: 'test' };
    },
  };
}

function silentLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

function createTaskContinuationHarness(options = {}) {
  let tasks = (options.tasks || [
    {
      id: 'task-1', ownerId: 'sergey', title: 'Позвонить поставщику',
      status: 'new', dueAt: '2026-08-15T13:59:59.999Z',
    },
    {
      id: 'task-2', ownerId: 'sergey', title: 'Позвонить поставщику',
      status: 'new', dueAt: '2026-08-15T13:59:59.999Z',
    },
  ]).map(task => ({ ...task }));
  const writes = [];
  const clock = options.clock || (() => new Date('2026-08-13T00:00:00.000Z'));
  const memory = createMemoryInterface({
    clock,
    pendingTaskClarificationTtlMs: options.pendingTaskClarificationTtlMs,
  });
  const activeStatuses = new Set(['new', 'planned', 'in_progress', 'waiting', 'needs_confirmation']);
  const fetchImpl = async (url, requestOptions = {}) => {
    const parsedUrl = new URL(url);
    const method = requestOptions.method || 'GET';
    if (method === 'GET' && parsedUrl.pathname === '/v1/tasks') {
      return jsonResponse(200, { data: tasks.filter(task => activeStatuses.has(task.status)) });
    }
    if (method === 'POST' && /\/v1\/tasks\/[^/]+\/transitions$/u.test(parsedUrl.pathname)) {
      const taskId = decodeURIComponent(parsedUrl.pathname.split('/')[3]);
      const body = JSON.parse(requestOptions.body);
      const index = tasks.findIndex(task => task.id === taskId && activeStatuses.has(task.status));
      if (index < 0) return jsonResponse(404, { error: { message: 'Task not found' } });
      tasks[index] = { ...tasks[index], ...body.patch, status: body.status };
      writes.push({ taskId, body });
      return jsonResponse(200, { data: { ...tasks[index] } });
    }
    throw new Error(`Unexpected Core request: ${method} ${parsedUrl.pathname}`);
  };
  const arthur = createArthurV1({
    coreConfig: coreConfig(fetchImpl, { ownerTimezone: 'Asia/Vladivostok' }),
    clock,
    memory,
    aiProvider: capturingAIProvider(),
    knowledgeDirectories: [],
    logger: silentLogger(),
  });
  return {
    arthur,
    memory,
    writes,
    tasks: () => tasks.map(task => ({ ...task })),
    updateTask(taskId, patch) {
      tasks = tasks.map(task => task.id === taskId ? { ...task, ...patch } : task);
    },
  };
}

function taskMessage(arthur, message, conversationId = 'conversation-A') {
  return arthur.handle({
    message,
    userId: 'sergey',
    channel: 'telegram',
    conversationId,
  });
}

test('getProfile reads the configured owner and never uses Telegram user ID', async () => {
  let captured;
  const client = createArthurCoreClient(coreConfig(async (url, options) => {
    captured = { url: String(url), options };
    return jsonResponse(200, {
      data: { id: 'sergey', name: 'Сергей', timezone: 'Asia/Vladivostok', locale: 'ru-RU' },
    });
  }));
  const skill = createArthurCoreSkill({ client, ownerProfileId: 'sergey' });

  const result = await skill.execute({
    operation: 'getProfile',
    correlationId: '00000000-0000-4000-8000-000000000001',
    actor: { userId: '111111', channel: 'telegram' },
  });

  assert.equal(result.data.profile.id, 'sergey');
  assert.equal(new URL(captured.url).pathname, '/v1/profiles/sergey');
  assert.equal(captured.url.includes('111111'), false);
  assert.equal(captured.options.headers.authorization, 'Bearer test-core-token');
  assert.equal(captured.options.headers['x-correlation-id'], '00000000-0000-4000-8000-000000000001');
});

test('listTasks returns Core task data and preserves supported filters', async () => {
  let capturedUrl;
  const tasks = [{ id: 'task-1', ownerId: 'sergey', title: 'Проверить отчёт', status: 'new' }];
  const client = createArthurCoreClient(coreConfig(async url => {
    capturedUrl = new URL(url);
    return jsonResponse(200, { data: tasks, meta: { count: 1 } });
  }));
  const skill = createArthurCoreSkill({ client, ownerProfileId: 'sergey' });

  const result = await skill.execute({
    operation: 'listTasks',
    parameters: { status: 'new', limit: 10, ownerId: 'telegram-user' },
  });

  assert.deepEqual(result.data.tasks, tasks);
  assert.equal(result.data.count, 1);
  assert.equal(capturedUrl.pathname, '/v1/tasks');
  assert.equal(capturedUrl.searchParams.get('ownerId'), 'sergey');
  assert.equal(capturedUrl.searchParams.get('status'), 'new');
  assert.equal(capturedUrl.searchParams.get('limit'), '10');
});

test('getTaskBrief uses the existing Core brief endpoint', async () => {
  let capturedUrl;
  const brief = {
    generatedAt: '2026-08-14T00:00:00.000Z',
    timezone: 'Asia/Vladivostok',
    horizonHours: 24,
    today: [{ id: 'today', title: 'Позвонить поставщику' }],
    overdue: [{ id: 'overdue' }],
    upcoming: [],
    waiting: [],
    total: 1,
  };
  const client = createArthurCoreClient(coreConfig(async url => {
    capturedUrl = new URL(url);
    return jsonResponse(200, { data: brief });
  }));
  const skill = createArthurCoreSkill({ client, ownerProfileId: 'sergey' });

  const result = await skill.execute({
    operation: 'getTaskBrief',
    parameters: { horizonHours: 24 },
  });

  assert.equal(capturedUrl.pathname, '/v1/tasks/brief');
  assert.equal(capturedUrl.searchParams.get('ownerId'), 'sergey');
  assert.equal(capturedUrl.searchParams.get('horizonHours'), '24');
  assert.equal(result.data.overdue[0].id, 'overdue');
  assert.match(result.data.responseText, /На сегодня: 1/);
  assert.match(result.data.summary, /просрочено 1/);
});

test('createTask posts only for canonical owner sergey and preserves Telegram audit context', async () => {
  let captured;
  const client = createArthurCoreClient(coreConfig(async (url, options) => {
    if ((options.method || 'GET') === 'GET') return jsonResponse(200, { data: [] });
    const body = JSON.parse(options.body);
    captured = { url: new URL(url), options, body };
    return jsonResponse(201, {
      data: { id: 'task-1', ...body, status: 'new', priority: body.priority || 'normal' },
    });
  }));
  const skill = createArthurCoreSkill({ client, ownerProfileId: 'sergey' });

  const result = await skill.execute({
    operation: 'createTask',
    correlationId: '00000000-0000-4000-8000-000000000002',
    actor: { userId: '111111', channel: 'telegram' },
    parameters: {
      ownerId: '111111',
      title: 'Позвонить поставщику',
      dueAt: '2026-08-14T05:00:00.000Z',
      dueLabel: 'завтра в 15:00',
      sourceRef: 'telegram-update:42',
    },
  });

  assert.equal(captured.url.pathname, '/v1/tasks');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.body.ownerId, 'sergey');
  assert.equal(captured.body.domain, 'personal');
  assert.equal(captured.body.sourceType, 'telegram');
  assert.equal(captured.body.sourceRef, 'telegram-update:42');
  assert.equal(Object.hasOwn(captured.body, 'priority'), false);
  assert.equal(JSON.stringify(captured.body).includes('111111'), false);
  assert.equal(captured.options.headers['x-arthur-actor-id'], 'sergey');
  assert.equal(captured.options.headers['x-arthur-actor-type'], 'user');
  assert.equal(result.data.responseText, [
    'Готово. Задача создана:',
    'Позвонить поставщику',
    'Срок: завтра в 15:00',
  ].join('\n'));
  assert.doesNotMatch(result.data.responseText, /task-1|sergey|status|UUID/);
});

test('Telegram createTask intent executes the Core write without AI rewriting', async () => {
  let synthesisCalls = 0;
  let createdBody;
  const aiProvider = {
    async generate() { return 'unused'; },
    async synthesize() { synthesisCalls += 1; return { text: 'rewritten' }; },
    async health() { return { healthy: true }; },
  };
  const arthur = createArthurV1({
    coreConfig: coreConfig(async (url, options) => {
      assert.equal(new URL(url).pathname, '/v1/tasks');
      if ((options.method || 'GET') === 'GET') return jsonResponse(200, { data: [] });
      const body = JSON.parse(options.body);
      createdBody = body;
      return jsonResponse(201, { data: { id: 'task-2', ...body, status: 'new', priority: 'normal' } });
    }),
    clock: () => new Date('2026-08-13T00:00:00.000Z'),
    aiProvider,
    knowledgeDirectories: [],
    logger: silentLogger(),
  });

  const response = await arthur.handle({
    message: 'Артур, создай задачу позвонить поставщику завтра срочно',
    userId: 'sergey',
    channel: 'telegram',
    transport: { type: 'telegram', metadata: { userId: '111111', updateId: 42 } },
  });

  assert.equal(response.status, 'success');
  assert.equal(response.answer.text, [
    'Готово. Задача создана:',
    'Позвонить поставщику',
    'Срок: завтра',
  ].join('\n'));
  assert.deepEqual(response.modulesUsed, ['arthur-core']);
  assert.equal(createdBody.priority, 'critical');
  assert.equal(synthesisCalls, 0);
});

test('implicit Telegram task uses canonical owner and never sends Telegram user ID', async () => {
  let createdBody;
  const arthur = createArthurV1({
    coreConfig: coreConfig(async (url, options) => {
      assert.equal(new URL(url).pathname, '/v1/tasks');
      if ((options.method || 'GET') === 'GET') return jsonResponse(200, { data: [] });
      createdBody = JSON.parse(options.body);
      return jsonResponse(201, { data: { id: 'task-implicit', ...createdBody, status: 'new' } });
    }),
    clock: () => new Date('2026-08-13T00:00:00.000Z'),
    aiProvider: capturingAIProvider(),
    knowledgeDirectories: [],
    logger: silentLogger(),
  });

  const response = await arthur.handle({
    message: 'Позвонить поставщику завтра',
    userId: 'sergey',
    channel: 'telegram',
    transport: { type: 'telegram', metadata: { userId: '111111', updateId: 43 } },
  });

  assert.equal(response.status, 'success');
  assert.equal(createdBody.ownerId, 'sergey');
  assert.equal(createdBody.sourceRef, 'telegram-update:43');
  assert.equal(JSON.stringify(createdBody).includes('111111'), false);
  assert.equal(response.answer.text, [
    'Готово. Задача создана:',
    'Позвонить поставщику',
    'Срок: завтра',
  ].join('\n'));
});

test('createTask blocks exact active duplicate with the same dueAt', async () => {
  let createCalls = 0;
  const existing = {
    id: 'task-existing',
    ownerId: 'sergey',
    title: 'Позвонить поставщику',
    status: 'new',
    dueAt: '2026-08-14T13:59:59.999Z',
  };
  const client = createArthurCoreClient(coreConfig(async (url, options) => {
    if ((options.method || 'GET') === 'GET') return jsonResponse(200, { data: [existing] });
    createCalls += 1;
    return jsonResponse(201, { data: {} });
  }));
  const skill = createArthurCoreSkill({ client, ownerProfileId: 'sergey' });

  const result = await skill.execute({
    operation: 'createTask',
    parameters: {
      title: '  позвонить   поставщику ',
      dueAt: '2026-08-14T13:59:59.999Z',
      dueLabel: 'завтра',
    },
  });

  assert.equal(createCalls, 0);
  assert.equal(result.data.status, 'duplicate');
  assert.equal(result.metadata.writePerformed, false);
  assert.equal(result.data.responseText, [
    'Такая задача уже есть:',
    'Позвонить поставщику',
    'Срок: завтра',
  ].join('\n'));
});

test('createTask allows the same title with a different dueAt', async () => {
  let createdBody;
  const client = createArthurCoreClient(coreConfig(async (url, options) => {
    if ((options.method || 'GET') === 'GET') {
      return jsonResponse(200, { data: [{
        id: 'task-existing', title: 'Позвонить поставщику', status: 'new',
        dueAt: '2026-08-14T13:59:59.999Z',
      }] });
    }
    createdBody = JSON.parse(options.body);
    return jsonResponse(201, { data: { id: 'task-new', ...createdBody, status: 'new' } });
  }));
  const skill = createArthurCoreSkill({ client, ownerProfileId: 'sergey' });

  const result = await skill.execute({
    operation: 'createTask',
    parameters: {
      title: 'Позвонить поставщику',
      dueAt: '2026-08-15T13:59:59.999Z',
      dueLabel: 'послезавтра',
    },
  });

  assert.equal(createdBody.ownerId, 'sergey');
  assert.equal(createdBody.dueAt, '2026-08-15T13:59:59.999Z');
  assert.equal(result.data.status, 'created');
});

test('completeTask selects one canonical-owner task and posts done transition', async () => {
  let transition;
  const arthur = createArthurV1({
    coreConfig: coreConfig(async (url, options) => {
      const parsedUrl = new URL(url);
      if ((options.method || 'GET') === 'GET') {
        return jsonResponse(200, { data: [{
          id: 'task-1', ownerId: 'sergey', title: 'Позвонить поставщику', status: 'new',
        }] });
      }
      transition = { url: parsedUrl, method: options.method, body: JSON.parse(options.body) };
      return jsonResponse(200, { data: {
        id: 'task-1', ownerId: 'sergey', title: 'Позвонить поставщику', status: 'done',
      } });
    }),
    aiProvider: capturingAIProvider(),
    knowledgeDirectories: [],
    logger: silentLogger(),
  });

  const response = await arthur.handle({
    message: 'Я позвонил поставщику',
    userId: 'sergey',
    channel: 'telegram',
    transport: { type: 'telegram', metadata: { userId: '111111' } },
  });

  assert.equal(transition.url.pathname, '/v1/tasks/task-1/transitions');
  assert.equal(transition.method, 'POST');
  assert.deepEqual(transition.body, { ownerId: 'sergey', status: 'done', patch: {} });
  assert.equal(JSON.stringify(transition.body).includes('111111'), false);
  assert.equal(response.answer.text, 'Готово. Задача выполнена:\nПозвонить поставщику');
});

test('cancelTask uses cancelled transition and never HTTP DELETE', async () => {
  const methods = [];
  let transitionBody;
  const arthur = createArthurV1({
    coreConfig: coreConfig(async (url, options) => {
      const method = options.method || 'GET';
      methods.push(method);
      if (method === 'GET') {
        return jsonResponse(200, { data: [{
          id: 'task-2', ownerId: 'sergey', title: 'Проверить отчёт', status: 'planned',
        }] });
      }
      transitionBody = JSON.parse(options.body);
      return jsonResponse(200, { data: {
        id: 'task-2', ownerId: 'sergey', title: 'Проверить отчёт', status: 'cancelled',
      } });
    }),
    aiProvider: capturingAIProvider(),
    knowledgeDirectories: [],
    logger: silentLogger(),
  });

  const response = await arthur.handle({
    message: 'Отмени задачу проверить отчёт',
    userId: 'sergey',
    channel: 'telegram',
  });

  assert.equal(methods.includes('DELETE'), false);
  assert.equal(transitionBody.status, 'cancelled');
  assert.equal(response.answer.text, 'Готово. Задача отменена:\nПроверить отчёт');
});

test('rescheduleTask keeps status and patches dueAt parsed in Vladivostok', async () => {
  let transitionBody;
  const arthur = createArthurV1({
    coreConfig: coreConfig(async (url, options) => {
      if ((options.method || 'GET') === 'GET') {
        return jsonResponse(200, { data: [{
          id: 'task-3', ownerId: 'sergey', title: 'Позвонить поставщику', status: 'new',
        }] });
      }
      transitionBody = JSON.parse(options.body);
      return jsonResponse(200, { data: {
        id: 'task-3', ownerId: 'sergey', title: 'Позвонить поставщику',
        status: transitionBody.status, dueAt: transitionBody.patch.dueAt,
      } });
    }, { ownerTimezone: 'Asia/Vladivostok' }),
    clock: () => new Date('2026-08-13T00:00:00.000Z'),
    aiProvider: capturingAIProvider(),
    knowledgeDirectories: [],
    logger: silentLogger(),
  });

  const response = await arthur.handle({
    message: 'Перенеси задачу позвонить поставщику на пятницу',
    userId: 'sergey',
    channel: 'telegram',
  });

  assert.deepEqual(transitionBody, {
    ownerId: 'sergey',
    status: 'new',
    patch: { dueAt: '2026-08-14T13:59:59.999Z' },
  });
  assert.equal(response.answer.text, 'Готово. Новый срок:\nПозвонить поставщику\nВ пятницу');
});

test('ambiguous exact task matches request clarification without a transition write', async () => {
  let writeCalls = 0;
  const client = createArthurCoreClient(coreConfig(async (url, options) => {
    if ((options.method || 'GET') !== 'GET') writeCalls += 1;
    return jsonResponse(200, { data: [
      { id: 'other', title: 'Купить корм', status: 'new' },
      { id: 'task-1', title: 'Позвонить поставщику', status: 'new', dueAt: '2026-08-14T13:59:59.999Z' },
      { id: 'task-2', title: 'Позвонить поставщику', status: 'new', dueAt: '2026-08-15T13:59:59.999Z' },
    ] });
  }));
  const skill = createArthurCoreSkill({
    client,
    ownerProfileId: 'sergey',
    ownerTimezone: 'Asia/Vladivostok',
  });

  const result = await skill.execute({
    operation: 'cancelTask',
    parameters: { title: 'Позвонить поставщику' },
  });

  assert.equal(writeCalls, 0);
  assert.equal(result.data.status, 'clarification_required');
  assert.match(result.data.responseText, /Нашёл 2 подходящие задачи/);
  assert.match(result.data.responseText, /1\. Позвонить поставщику — 14\.08\.2026/);
  assert.match(result.data.responseText, /2\. Позвонить поставщику — 15\.08\.2026/);
  assert.match(result.data.responseText, /Уточни номер/);
  assert.doesNotMatch(result.data.responseText, /task-1|task-2/);
  assert.deepEqual(result.data.pendingClarification.candidates.map(task => task.id), ['task-1', 'task-2']);
});

test('explicit task number selects the active-list ordinal without pending clarification', async () => {
  let transitionedPath;
  const tasks = [
    { id: 'other', title: 'Купить корм', status: 'new' },
    { id: 'task-1', title: 'Позвонить поставщику', status: 'new' },
    { id: 'task-2', title: 'Позвонить поставщику', status: 'new' },
  ];
  const client = createArthurCoreClient(coreConfig(async (url, options) => {
    if ((options.method || 'GET') === 'GET') return jsonResponse(200, { data: tasks });
    transitionedPath = new URL(url).pathname;
    return jsonResponse(200, { data: { ...tasks[2], status: 'cancelled' } });
  }));
  const skill = createArthurCoreSkill({ client, ownerProfileId: 'sergey' });

  const result = await skill.execute({
    operation: 'cancelTask',
    parameters: { taskNumber: 3 },
  });

  assert.equal(transitionedPath, '/v1/tasks/task-2/transitions');
  assert.equal(result.data.status, 'cancelled');
});

test('cancel ambiguity stores candidates and numeric continuation changes only candidate one', async () => {
  const harness = createTaskContinuationHarness();

  const ambiguous = await taskMessage(harness.arthur, 'Отмени задачу позвонить поставщику');
  const pending = await harness.memory.loadPendingTaskClarification('sergey', 'conversation-A');

  assert.equal(harness.writes.length, 0);
  assert.match(ambiguous.answer.text, /Нашёл 2 подходящие задачи/);
  assert.equal(pending.action, 'cancel');
  assert.equal(pending.operation, 'cancelTask');
  assert.deepEqual(pending.candidates.map(task => task.id), ['task-1', 'task-2']);
  assert.equal(pending.createdAt, '2026-08-13T00:00:00.000Z');
  assert.equal(pending.expiresAt, '2026-08-13T00:05:00.000Z');
  assert.equal(await harness.memory.loadPendingTaskClarification('111111', 'conversation-A'), null);

  const resolved = await taskMessage(harness.arthur, '1');

  assert.equal(resolved.answer.text, 'Готово. Задача отменена:\nПозвонить поставщику');
  assert.deepEqual(harness.writes.map(write => write.taskId), ['task-1']);
  assert.equal(harness.tasks().find(task => task.id === 'task-1').status, 'cancelled');
  assert.equal(harness.tasks().find(task => task.id === 'task-2').status, 'new');
  assert.equal(await harness.memory.loadPendingTaskClarification('sergey', 'conversation-A'), null);
});

test('Russian ordinal continuation selects candidate two', async () => {
  const harness = createTaskContinuationHarness();
  await taskMessage(harness.arthur, 'Отмени задачу позвонить поставщику');

  await taskMessage(harness.arthur, 'вторая');

  assert.deepEqual(harness.writes.map(write => write.taskId), ['task-2']);
  assert.equal(harness.tasks().find(task => task.id === 'task-1').status, 'new');
  assert.equal(harness.tasks().find(task => task.id === 'task-2').status, 'cancelled');
});

test('complete ambiguity resolves by stored candidate ID', async () => {
  const harness = createTaskContinuationHarness();
  await taskMessage(harness.arthur, 'Я позвонил поставщику');

  const response = await taskMessage(harness.arthur, '1');

  assert.equal(response.answer.text, 'Готово. Задача выполнена:\nПозвонить поставщику');
  assert.deepEqual(harness.writes.map(write => write.taskId), ['task-1']);
  assert.equal(harness.tasks().find(task => task.id === 'task-1').status, 'done');
  assert.equal(harness.tasks().find(task => task.id === 'task-2').status, 'new');
});

test('reschedule ambiguity preserves dueAt and updates only candidate two', async () => {
  const harness = createTaskContinuationHarness();
  await taskMessage(harness.arthur, 'Перенеси задачу позвонить поставщику на пятницу');

  const pending = await harness.memory.loadPendingTaskClarification('sergey', 'conversation-A');
  assert.equal(pending.parameters.dueAt, '2026-08-14T13:59:59.999Z');

  const response = await taskMessage(harness.arthur, '2');

  assert.equal(response.answer.text, 'Готово. Новый срок:\nПозвонить поставщику\nВ пятницу');
  assert.deepEqual(harness.writes.map(write => write.taskId), ['task-2']);
  assert.equal(harness.tasks().find(task => task.id === 'task-1').dueAt, '2026-08-15T13:59:59.999Z');
  assert.equal(harness.tasks().find(task => task.id === 'task-2').dueAt, '2026-08-14T13:59:59.999Z');
});

test('out-of-range clarification performs no write and keeps pending state', async () => {
  const harness = createTaskContinuationHarness();
  await taskMessage(harness.arthur, 'Отмени задачу позвонить поставщику');

  const response = await taskMessage(harness.arthur, '3');

  assert.equal(response.answer.text, 'Выбери номер от 1 до 2.');
  assert.equal(harness.writes.length, 0);
  assert.ok(await harness.memory.loadPendingTaskClarification('sergey', 'conversation-A'));
});

test('dialogue cancellation clears pending state without changing a task', async () => {
  const harness = createTaskContinuationHarness();
  await taskMessage(harness.arthur, 'Отмени задачу позвонить поставщику');

  const response = await taskMessage(harness.arthur, 'не надо');

  assert.equal(response.answer.text, 'Хорошо, отменил действие.');
  assert.equal(harness.writes.length, 0);
  assert.equal(await harness.memory.loadPendingTaskClarification('sergey', 'conversation-A'), null);
});

test('expired clarification never executes the old task action', async () => {
  let nowMs = new Date('2026-08-13T00:00:00.000Z').getTime();
  const harness = createTaskContinuationHarness({
    clock: () => new Date(nowMs),
    pendingTaskClarificationTtlMs: 5 * 60 * 1000,
  });
  await taskMessage(harness.arthur, 'Отмени задачу позвонить поставщику');
  nowMs += (5 * 60 * 1000) + 1;

  const response = await taskMessage(harness.arthur, '1');

  assert.equal(response.answer.text, 'Обычный разговор работает.');
  assert.equal(harness.writes.length, 0);
  assert.equal(await harness.memory.loadPendingTaskClarification('sergey', 'conversation-A'), null);
});

test('pending task clarification is isolated by conversation and canonical owner', async () => {
  const harness = createTaskContinuationHarness();
  await taskMessage(harness.arthur, 'Отмени задачу позвонить поставщику', 'conversation-A');

  await taskMessage(harness.arthur, '1', 'conversation-B');

  assert.equal(harness.writes.length, 0);
  assert.ok(await harness.memory.loadPendingTaskClarification('sergey', 'conversation-A'));
  assert.equal(await harness.memory.loadPendingTaskClarification('sergey', 'conversation-B'), null);

  await taskMessage(harness.arthur, '1', 'conversation-A');
  assert.deepEqual(harness.writes.map(write => write.taskId), ['task-1']);
});

test('unrelated request clears pending state and continues through normal task routing', async () => {
  const harness = createTaskContinuationHarness();
  await taskMessage(harness.arthur, 'Отмени задачу позвонить поставщику');

  const response = await taskMessage(harness.arthur, 'Что у меня по задачам?');

  assert.match(response.answer.text, /У тебя 2 активные задачи/);
  assert.equal(harness.writes.length, 0);
  assert.equal(await harness.memory.loadPendingTaskClarification('sergey', 'conversation-A'), null);
});

test('changed candidate snapshot blocks continuation write', async () => {
  const harness = createTaskContinuationHarness();
  await taskMessage(harness.arthur, 'Отмени задачу позвонить поставщику');
  harness.updateTask('task-1', { dueAt: '2026-08-16T13:59:59.999Z' });

  const response = await taskMessage(harness.arthur, '1');

  assert.match(response.answer.text, /задача уже изменилась или больше не активна/i);
  assert.equal(harness.writes.length, 0);
  assert.equal(await harness.memory.loadPendingTaskClarification('sergey', 'conversation-A'), null);
});

test('implicit task guard keeps ordinary conversation out of Core writes', async () => {
  let coreCalls = 0;
  const arthur = createArthurV1({
    coreConfig: coreConfig(async () => {
      coreCalls += 1;
      throw new Error('Core must not be called');
    }),
    aiProvider: capturingAIProvider(),
    knowledgeDirectories: [],
    logger: silentLogger(),
  });

  const response = await arthur.handle({
    message: 'Расскажи про Award',
    userId: 'sergey',
    channel: 'telegram',
  });

  assert.equal(response.status, 'success');
  assert.equal(response.answer.text, 'Обычный разговор работает.');
  assert.deepEqual(response.modulesUsed, []);
  assert.equal(response.diagnostics.directResponse, true);
  assert.equal(coreCalls, 0);
});

test('task-management questions stay in conversation fallback without Core writes', async () => {
  let coreCalls = 0;
  const arthur = createArthurV1({
    coreConfig: coreConfig(async () => {
      coreCalls += 1;
      throw new Error('Core must not be called');
    }),
    aiProvider: capturingAIProvider(),
    knowledgeDirectories: [],
    logger: silentLogger(),
  });

  for (const message of [
    'Стоит ли отменить задачу?',
    'Как выполнить задачу?',
    'Почему перенесли задачу?',
  ]) {
    const response = await arthur.handle({ message, userId: 'sergey', channel: 'telegram' });
    assert.equal(response.status, 'success');
    assert.equal(response.diagnostics.directResponse, true);
    assert.deepEqual(response.modulesUsed, []);
  }
  assert.equal(coreCalls, 0);
});

test('Telegram task list is compact, user-facing and bypasses AI rewriting', async () => {
  let synthesisCalls = 0;
  const tasks = [
    { id: 'task-1', title: 'Проверить договор', status: 'new', sourceType: 'n8n' },
    { id: 'task-2', title: 'Позвонить поставщику', status: 'waiting', waitingFor: 'ответ' },
  ];
  const aiProvider = {
    async generate() { return 'unused'; },
    async synthesize() { synthesisCalls += 1; return { text: 'rewritten' }; },
    async health() { return { healthy: true }; },
  };
  const arthur = createArthurV1({
    coreConfig: coreConfig(async url => {
      assert.equal(new URL(url).pathname, '/v1/tasks');
      return jsonResponse(200, { data: tasks });
    }),
    aiProvider,
    knowledgeDirectories: [],
    logger: silentLogger(),
  });

  const response = await arthur.handle({
    message: 'Что у меня по задачам?',
    userId: 'sergey',
    channel: 'telegram',
  });

  assert.equal(response.answer.text, [
    'У тебя 2 активные задачи:',
    '',
    '1. Проверить договор',
    '2. Позвонить поставщику',
  ].join('\n'));
  assert.doesNotMatch(response.answer.text, /sourceType|waitingFor|Arthur Core|purchasing|Вы|Ваш/);
  assert.equal(synthesisCalls, 0);
});

test('Telegram task list has a concise empty state', async () => {
  const arthur = createArthurV1({
    coreConfig: coreConfig(async () => jsonResponse(200, { data: [] })),
    aiProvider: createFakeAIProvider(),
    knowledgeDirectories: [],
    logger: silentLogger(),
  });

  const response = await arthur.handle({
    message: 'Что у меня по задачам?',
    userId: 'sergey',
    channel: 'telegram',
  });

  assert.equal(response.answer.text, 'Активных задач сейчас нет.');
});

test('Telegram today brief has a concise empty state', () => {
  const response = formatBriefResponse({ today: [], overdue: [], waiting: [] }, 'today');
  assert.equal(response, ['На сегодня задач нет.', '', 'Просрочено: 0', 'Ожидают: 0'].join('\n'));
});

test('Telegram today and overdue requests use focused brief views', async () => {
  const brief = {
    generatedAt: '2026-08-14T00:00:00.000Z',
    timezone: 'Asia/Vladivostok',
    horizonHours: 24,
    today: [{ id: 'today', title: 'Проверить отчёт' }],
    overdue: [{ id: 'overdue', title: 'Оплатить счёт' }],
    upcoming: [{ id: 'today', title: 'Проверить отчёт' }],
    waiting: [],
    total: 2,
  };
  const arthur = createArthurV1({
    coreConfig: coreConfig(async url => {
      assert.equal(new URL(url).pathname, '/v1/tasks/brief');
      assert.equal(new URL(url).searchParams.has('view'), false);
      return jsonResponse(200, { data: brief });
    }),
    aiProvider: createFakeAIProvider(),
    knowledgeDirectories: [],
    logger: silentLogger(),
  });

  const today = await arthur.handle({
    message: 'Что у меня сегодня?', userId: 'sergey', channel: 'telegram',
  });
  const overdue = await arthur.handle({
    message: 'Какие задачи просрочены?', userId: 'sergey', channel: 'telegram',
  });

  assert.equal(today.answer.text, [
    'На сегодня: 1',
    '1. Проверить отчёт',
    '',
    'Просрочено: 1',
    'Ожидают: 0',
  ].join('\n'));
  assert.equal(overdue.answer.text, [
    'Просрочено: 1',
    '1. Оплатить счёт',
    '',
    'На сегодня: 1',
    'Ожидают: 0',
  ].join('\n'));
});

test('Core profile rendering addresses Sergey informally', async () => {
  const arthur = createArthurV1({
    coreConfig: coreConfig(async () => jsonResponse(200, {
      data: { id: 'sergey', name: 'Сергей', timezone: 'Asia/Vladivostok', locale: 'ru-RU' },
    })),
    aiProvider: createFakeAIProvider(),
    knowledgeDirectories: [],
    logger: silentLogger(),
  });

  const response = await arthur.handle({ message: 'Кто я?', userId: 'sergey', channel: 'telegram' });
  assert.equal(response.answer.text, 'Ты — Сергей. Часовой пояс: Asia/Vladivostok.');
  assert.doesNotMatch(response.answer.text, /Вы|Ваш/);
});

test('401 and 403 produce typed authentication errors', async () => {
  for (const status of [401, 403]) {
    const client = createArthurCoreClient(coreConfig(async () => jsonResponse(status, {
      error: { code: 'unauthorized' },
    })));
    await assert.rejects(
      () => client.getProfile('sergey'),
      error => error instanceof ArthurCoreAuthError && error.statusCode === status
    );
  }
});

test('404 is typed in the client and controlled by the skill', async () => {
  const client = createArthurCoreClient(coreConfig(async () => jsonResponse(404, {
    error: { code: 'not_found' },
  })));
  await assert.rejects(() => client.getProfile('sergey'), ArthurCoreNotFoundError);

  const skill = createArthurCoreSkill({ client, ownerProfileId: 'sergey' });
  const result = await skill.execute({ operation: 'getProfile' });
  assert.equal(result.status, 'success');
  assert.equal(result.data.status, 'not_found');
  assert.equal(result.metadata.degraded, true);
});

test('timeout produces typed error without retries', async () => {
  let calls = 0;
  const client = createArthurCoreClient(coreConfig((url, options) => {
    calls += 1;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }, { timeoutMs: 100 }));

  await assert.rejects(() => client.listTasks('sergey'), ArthurCoreTimeoutError);
  assert.equal(calls, 1);
});

test('network and 5xx failures use typed retryable errors', async () => {
  const networkClient = createArthurCoreClient(coreConfig(async () => {
    throw new Error('connection refused');
  }));
  await assert.rejects(
    () => networkClient.getProfile('sergey'),
    error => error instanceof ArthurCoreNetworkError && error.retryable === true
  );

  const serverClient = createArthurCoreClient(coreConfig(async () => jsonResponse(503, {
    error: { code: 'internal_error' },
  })));
  await assert.rejects(
    () => serverClient.getProfile('sergey'),
    error => error instanceof ArthurCoreServerError && error.statusCode === 503
  );
});

test('malformed JSON is typed and becomes a controlled degraded result', async () => {
  const client = createArthurCoreClient(coreConfig(async () => jsonResponse(200, '{bad json')));
  await assert.rejects(() => client.getProfile('sergey'), ArthurCoreInvalidResponseError);

  const skill = createArthurCoreSkill({ client, ownerProfileId: 'sergey' });
  const result = await skill.execute({ operation: 'getProfile' });
  assert.equal(result.data.status, 'unavailable');
  assert.equal(result.metadata.errorCode, 'ARTHUR_CORE_INVALID_RESPONSE');
});

test('missing Core configuration does not register the skill or advertise capabilities', async () => {
  const aiProvider = capturingAIProvider();
  const arthur = createArthurV1({
    coreConfig: {},
    aiProvider,
    knowledgeDirectories: [],
    logger: silentLogger(),
  });

  const diagnostics = await arthur.getDiagnostics();
  assert.deepEqual(diagnostics.skills, ['purchasing']);

  await arthur.handle({ message: 'что ты умеешь?', userId: 'sergey', channel: 'test' });
  assert.equal(aiProvider.generateSystem.includes('(id: arthur-core)'), false);
  assert.equal(aiProvider.generateSystem.includes('createTask'), false);
  assert.equal(aiProvider.generateSystem.includes('completeTask'), false);
});

test('valid Core configuration advertises only supported task-management writes', async () => {
  const aiProvider = capturingAIProvider();
  const arthur = createArthurV1({
    coreConfig: coreConfig(async () => jsonResponse(200, { ok: true, service: 'arthur-core' })),
    aiProvider,
    knowledgeDirectories: [],
    logger: silentLogger(),
  });

  const diagnostics = await arthur.getDiagnostics();
  assert.deepEqual(diagnostics.skills, ['purchasing', 'arthur-core']);

  await arthur.handle({ message: 'что ты умеешь?', userId: 'sergey', channel: 'test' });
  assert.match(
    aiProvider.generateSystem,
    /\(id: arthur-core\): getProfile, listTasks, getTaskBrief, createTask, completeTask, cancelTask, rescheduleTask/
  );
});

test('Core 500 and timeout never confirm createTask as created', async () => {
  const scenarios = [
    coreConfig(async () => jsonResponse(500, { error: { code: 'internal_error' } })),
    coreConfig((url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }), { timeoutMs: 100 }),
  ];

  for (const config of scenarios) {
    const arthur = createArthurV1({
      coreConfig: config,
      clock: () => new Date('2026-08-13T00:00:00.000Z'),
      aiProvider: createFakeAIProvider(),
      knowledgeDirectories: [],
      logger: silentLogger(),
    });
    const response = await arthur.handle({
      message: 'создай задачу позвонить поставщику',
      userId: 'sergey',
      channel: 'telegram',
    });
    assert.match(response.answer.text, /Не удалось создать задачу/);
    assert.doesNotMatch(response.answer.text, /Готово|Задача создана/);
  }
});

test('Core outage returns a degraded task answer with one request', async () => {
  let coreCalls = 0;
  const arthur = createArthurV1({
    coreConfig: coreConfig(async () => {
      coreCalls += 1;
      throw new Error('Core offline');
    }),
    aiProvider: createFakeAIProvider(),
    knowledgeDirectories: [],
    logger: silentLogger(),
  });

  const response = await arthur.handle({
    message: 'что у меня по задачам',
    userId: 'sergey',
    channel: 'telegram',
  });

  assert.equal(response.status, 'success');
  assert.deepEqual(response.modulesUsed, ['arthur-core']);
  assert.match(response.answer.text, /Arthur Core временно недоступен/);
  assert.equal(coreCalls, 1);
});

test('Core outage does not call Core for Purchasing requests', async () => {
  let coreCalls = 0;
  const arthur = createArthurV1({
    coreConfig: coreConfig(async () => {
      coreCalls += 1;
      throw new Error('Core offline');
    }),
    aiProvider: createFakeAIProvider(),
    knowledgeDirectories: [],
    logger: silentLogger(),
  });

  const response = await arthur.handle({
    message: 'что с закупками?',
    userId: 'sergey',
    channel: 'telegram',
  });

  assert.equal(response.status, 'success');
  assert.equal(response.modulesUsed.includes('purchasing'), true);
  assert.equal(coreCalls, 0);
});

test('Core outage does not break general AI conversation', async () => {
  let coreCalls = 0;
  const aiProvider = capturingAIProvider();
  const arthur = createArthurV1({
    coreConfig: coreConfig(async () => {
      coreCalls += 1;
      throw new Error('Core offline');
    }),
    aiProvider,
    knowledgeDirectories: [],
    logger: silentLogger(),
  });

  const response = await arthur.handle({
    message: 'Привет, Артур',
    userId: 'sergey',
    channel: 'telegram',
  });

  assert.equal(response.status, 'success');
  assert.equal(response.answer.text, 'Обычный разговор работает.');
  assert.equal(coreCalls, 0);
});
