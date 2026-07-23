const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { once } = require('node:events');

const {
  createPurchasingWebServer,
} = require('../server');
const {
  formatRub,
  pollRunStatus,
  selectArtifacts,
  summaryView,
} = require('../public/app');

const PUBLIC_ROOT = path.resolve(__dirname, '../public');
let server;
let baseUrl;

async function rawRequest(requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: requestPath,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
  });
}

before(async () => {
  server = createPurchasingWebServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) {
    server.close();
    await once(server, 'close');
  }
});

test('GET / serves the Russian frontend with secure headers', async () => {
  const response = await fetch(`${baseUrl}/`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-type'),
    'text/html; charset=utf-8'
  );
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(body, /AI-агент закупщик «Миска»/);
  assert.doesNotMatch(body, /Скачать результаты/);
  assert.match(body, />\s*Экспорт\s*</);
  for (const label of [
    'Полный отчёт',
    'Result JSON',
    'Owner Review',
    'Объяснения рекомендаций',
  ]) {
    assert.match(body, new RegExp(label));
  }
});

test('whitelisted CSS and JavaScript have correct content types', async () => {
  const [css, script] = await Promise.all([
    fetch(`${baseUrl}/styles.css`),
    fetch(`${baseUrl}/app.js`),
  ]);
  assert.equal(css.status, 200);
  assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal(css.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(script.status, 200);
  assert.equal(
    script.headers.get('content-type'),
    'text/javascript; charset=utf-8'
  );
  assert.equal(script.headers.get('x-content-type-options'), 'nosniff');
});

test('unknown static paths return 404 without directory listing', async () => {
  const response = await fetch(`${baseUrl}/public/`);
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'ROUTE_NOT_FOUND');
  assert.equal(body.api_version, 'v1');
});

test('static traversal attempts are rejected', async () => {
  for (const requestPath of [
    '/..%2fserver.js',
    '/%252e%252e%252fserver.js',
    '/..%5cserver.js',
    '/%00app.js',
  ]) {
    const response = await rawRequest(requestPath);
    assert.equal(response.statusCode, 400, requestPath);
    assert.equal(
      JSON.parse(response.body).error.code,
      'INVALID_STATIC_PATH',
      requestPath
    );
  }
});

test('frontend assets contain no external URL or remote dependency', () => {
  for (const name of ['index.html', 'styles.css', 'app.js']) {
    const source = fs.readFileSync(path.join(PUBLIC_ROOT, name), 'utf8');
    assert.doesNotMatch(source, /https?:\/\//i, name);
  }
});

test('RUB and summary formatting preserve distinct monetary amounts', () => {
  const formatted = formatRub(1234567.8);
  assert.match(formatted, /1[\s\u00a0]234[\s\u00a0]567,80/);
  assert.match(formatted, /₽/);
  assert.equal(formatRub(null), '—');

  const view = summaryView({
    sku_count: 403,
    amounts: {
      analyzer_order_sum: 1,
      auto_approved_sum: 2,
      pending_review_sum: 3,
      working_maximum_sum: 4,
      financially_assessed_sum: 5,
    },
    financial: { status: 'red' },
    owner_review: { action_required: 17 },
  }, {
    started_at: '2026-07-23T00:00:00.000Z',
    completed_at: '2026-07-23T00:00:05.000Z',
  });

  assert.match(view.analyzerOrderSum, /1,00/);
  assert.match(view.autoApprovedSum, /2,00/);
  assert.match(view.pendingReviewSum, /3,00/);
  assert.match(view.workingMaximumSum, /4,00/);
  assert.match(view.financiallyAssessedSum, /5,00/);
  assert.equal(view.ownerReviewCount, '17');
  assert.equal(view.calculationTime, '5 сек');
});

test('polling stops on completed and failed run statuses', async () => {
  const statuses = ['processing', 'completed'];
  let calls = 0;
  const completed = await pollRunStatus({
    fetchFunction: async () => ({
      ok: true,
      async json() {
        return {
          data: {
            status: statuses[calls++],
          },
        };
      },
    }),
    statusUrl: '/api/v1/runs/fixture',
    intervalMs: 0,
    sleep: async () => {},
  });
  assert.equal(completed.status, 'completed');
  assert.equal(calls, 2);

  await assert.rejects(
    pollRunStatus({
      fetchFunction: async () => ({
        ok: true,
        async json() {
          return { data: { status: 'failed' } };
        },
      }),
      statusUrl: '/api/v1/runs/fixture',
    }),
    error => error.code === 'RUN_FAILED'
  );
});

test('polling has a deterministic timeout', async () => {
  let timestamp = 0;
  await assert.rejects(
    pollRunStatus({
      fetchFunction: async () => ({
        ok: true,
        async json() {
          return { data: { status: 'processing' } };
        },
      }),
      statusUrl: '/api/v1/runs/fixture',
      intervalMs: 1000,
      timeoutMs: 2000,
      now: () => timestamp,
      sleep: async delay => {
        timestamp += delay;
      },
    }),
    error => error.code === 'POLL_TIMEOUT'
  );
});

test('artifact buttons accept only whitelisted manifest download URLs', () => {
  const selected = selectArtifacts({
    artifacts: [
      {
        name: 'result.json',
        download_url:
          '/api/v1/runs/11111111-1111-4111-8111-111111111111' +
          '/artifacts/result.json',
      },
      {
        name: 'owner-review-report.md',
        download_url: '../../private/owner-review-report.md',
      },
      {
        name: 'user-input.xlsx',
        download_url:
          '/api/v1/runs/11111111-1111-4111-8111-111111111111' +
          '/artifacts/user-input.xlsx',
      },
    ],
  });
  assert.deepEqual(Object.keys(selected), ['result']);
  assert.equal(selected.result.name, 'result.json');
});
