'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createArthurV1 } = require('../index');
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
});

test('valid Core configuration registers and advertises only read-only Core capabilities', async () => {
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
  assert.match(aiProvider.generateSystem, /\(id: arthur-core\): getProfile, listTasks, getTaskBrief/);
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
