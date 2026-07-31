const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { once } = require('node:events');

const {
  DEFAULT_SERVER_PATHS,
  resolveApiToken,
  resolveHttpHost,
} = require('../config');
const {
  enforceApiAccess,
  isLoopbackAddress,
} = require('../http/api_access_guard');
const {
  FileRunRegistry,
} = require('../storage/file_run_registry');
const {
  createPurchasingWebServer,
} = require('../server');

const API_TOKEN = 'guard-test-token-0123456789abcdef';
const UNKNOWN_RUN_URL = '/api/v1/runs/123e4567-e89b-42d3-a456-426614174000';

const servers = [];

async function startTestServer(options = {}) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'purchasing-guard-')
  );
  const registry = new FileRunRegistry({
    runsRoot: path.join(temporaryRoot, 'runs'),
  });
  const server = createPurchasingWebServer({
    registry,
    serverPaths: {
      ...DEFAULT_SERVER_PATHS,
      ownerDecisionsPath: path.join(temporaryRoot, 'owner-decisions.json'),
      ownerDecisionHistoryPath: path.join(
        temporaryRoot,
        'owner-decision-history.json'
      ),
      ownerLearningHistoryPath: path.join(
        temporaryRoot,
        'owner-learning-history.json'
      ),
    },
    uploadRoot: path.join(temporaryRoot, 'uploads'),
    logger: { warn() {}, error() {}, info() {} },
    ...options,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  servers.push(server);
  return {
    server,
    temporaryRoot,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

test.after(async () => {
  for (const server of servers.splice(0)) {
    server.close();
    await once(server, 'close').catch(() => {});
  }
});

// 1. Loopback-запрос (локальный браузер владельца) работает без токена,
//    даже когда токен настроен.
test('loopback-запрос без токена разрешён', async () => {
  const { baseUrl } = await startTestServer({ apiToken: API_TOKEN });
  const response = await fetch(`${baseUrl}${UNKNOWN_RUN_URL}`);
  // Доступ прошёл: 404 означает, что guard пропустил запрос к роутингу.
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, 'RUN_NOT_FOUND');
});

// 2. Внешний запрос без токена запрещён.
test('внешний запрос без токена запрещён', async () => {
  const { baseUrl } = await startTestServer({
    apiToken: API_TOKEN,
    routerOptions: { isLoopbackRequest: () => false },
  });
  const response = await fetch(`${baseUrl}${UNKNOWN_RUN_URL}`);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, 'API_TOKEN_REQUIRED');
});

// 3. Внешний запрос с неверным токеном запрещён.
test('внешний запрос с неверным токеном запрещён', async () => {
  const { baseUrl } = await startTestServer({
    apiToken: API_TOKEN,
    routerOptions: { isLoopbackRequest: () => false },
  });
  const response = await fetch(`${baseUrl}${UNKNOWN_RUN_URL}`, {
    headers: { 'x-api-key': 'wrong-token-value-9876543210fedcba' },
  });
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, 'API_TOKEN_INVALID');
});

// 4. Внешний запрос с правильным токеном разрешён.
test('внешний запрос с правильным токеном разрешён', async () => {
  const { baseUrl } = await startTestServer({
    apiToken: API_TOKEN,
    routerOptions: { isLoopbackRequest: () => false },
  });
  const response = await fetch(`${baseUrl}${UNKNOWN_RUN_URL}`, {
    headers: { 'x-api-key': API_TOKEN },
  });
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, 'RUN_NOT_FOUND');
});

// 5. Токен не появляется в ответах, заголовках и логах.
test('токен не появляется в ответах и логах', async () => {
  const loggedLines = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...args) => loggedLines.push(args.join(' '));
  console.error = (...args) => loggedLines.push(args.join(' '));
  try {
    const { baseUrl } = await startTestServer({
      apiToken: API_TOKEN,
      routerOptions: { isLoopbackRequest: () => false },
    });

    const denied = await fetch(`${baseUrl}${UNKNOWN_RUN_URL}`);
    const deniedBody = await denied.text();
    assert.equal(denied.status, 401);
    assert.ok(
      !deniedBody.includes(API_TOKEN),
      'ответ 401 не должен содержать токен'
    );
    for (const [name, value] of denied.headers.entries()) {
      assert.ok(
        !String(name).includes(API_TOKEN) && !String(value).includes(API_TOKEN),
        'заголовки ответа не должны содержать токен'
      );
    }

    const wrongToken = await fetch(`${baseUrl}${UNKNOWN_RUN_URL}`, {
      headers: { 'x-api-key': 'wrong-token-value-9876543210fedcba' },
    });
    const wrongBody = await wrongToken.text();
    assert.ok(
      !wrongBody.includes(API_TOKEN),
      'ответ на неверный токен не должен раскрывать ожидаемое значение'
    );

    const allowed = await fetch(`${baseUrl}${UNKNOWN_RUN_URL}`, {
      headers: { 'x-api-key': API_TOKEN },
    });
    const allowedBody = await allowed.text();
    assert.ok(
      !allowedBody.includes(API_TOKEN),
      'успешный ответ не должен содержать токен'
    );
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
  assert.ok(
    loggedLines.every(line => !line.includes(API_TOKEN)),
    'логи не должны содержать токен'
  );
});

// Дополнительно: статические страницы (UI) остаются доступны без токена,
// guard применяется только к /api/.
test('статический UI не требует токена', async () => {
  const { baseUrl } = await startTestServer({
    apiToken: API_TOKEN,
    routerOptions: { isLoopbackRequest: () => false },
  });
  const response = await fetch(`${baseUrl}/`);
  assert.notEqual(response.status, 401);
});

// Дополнительно: если токен не настроен, защита выключена — внешний
// запрос проходит (режим loopback-only по умолчанию).
test('без настроенного токена guard не блокирует запросы', async () => {
  const { baseUrl } = await startTestServer({
    apiToken: null,
    routerOptions: { isLoopbackRequest: () => false },
  });
  const response = await fetch(`${baseUrl}${UNKNOWN_RUN_URL}`);
  assert.equal(response.status, 404);
});

test('isLoopbackAddress распознаёт loopback-адреса', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::FFFF:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('10.0.0.5'), false);
  assert.equal(isLoopbackAddress('192.168.1.10'), false);
  assert.equal(isLoopbackAddress('::ffff:10.0.0.5'), false);
  assert.equal(isLoopbackAddress(''), false);
  assert.equal(isLoopbackAddress(undefined), false);
});

test('enforceApiAccess отклоняет дублированный x-api-key', () => {
  assert.throws(
    () => enforceApiAccess(
      {
        headers: { 'x-api-key': [API_TOKEN, API_TOKEN] },
        socket: { remoteAddress: '10.0.0.5' },
      },
      { apiToken: API_TOKEN }
    ),
    error => error.code === 'API_TOKEN_REQUIRED'
  );
});

test('resolveApiToken проверяет длину и пустое значение', () => {
  assert.equal(resolveApiToken(undefined), null);
  assert.equal(resolveApiToken(''), null);
  assert.equal(resolveApiToken(API_TOKEN), API_TOKEN);
  assert.throws(() => resolveApiToken('short'), TypeError);
  assert.throws(() => resolveApiToken('x'.repeat(513)), TypeError);
});

test('resolveHttpHost по умолчанию возвращает loopback', () => {
  assert.equal(resolveHttpHost(undefined), '127.0.0.1');
  assert.equal(resolveHttpHost(''), '127.0.0.1');
  assert.equal(resolveHttpHost('0.0.0.0'), '0.0.0.0');
  assert.throws(() => resolveHttpHost('http://host'), TypeError);
  assert.throws(() => resolveHttpHost('x'.repeat(256)), TypeError);
});
