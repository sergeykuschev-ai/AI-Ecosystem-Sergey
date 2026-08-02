'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  buildExcelMessage,
  imapSinceDate,
} = require('../../../scripts/arthur/minmax-mail-protocol');
const {
  latestOutputJson,
  productionConfig,
  registryNodeSnapshot,
  verifyConnectionRefused,
  verifyCredentialMetadata,
  waitForE2EExecution,
} = require('../../../scripts/arthur/minmax-production-check');

const ROOT = path.resolve(__dirname, '../../..');
const workflow = JSON.parse(fs.readFileSync(path.join(
  ROOT,
  'n8n/workflows/arthur-minmax-yandex-mail-intake-fixed.json'
), 'utf8'));

function execution(overrides = {}) {
  return {
    id: 'e2e-100',
    workflowId: 'minmaxYandexIntakeFixed01',
    startedAt: '2026-08-02T00:00:00.000Z',
    status: 'success',
    finished: true,
    data: {
      resultData: {
        runData: {
          'Конфигурация MinMax': [{
            data: { main: [[{ json: { subject: 'MinMax production E2E marker' } }]] },
          }],
          'Сформировать уведомление': [{
            data: { main: [[{ json: { runId: 'run-1' } }]] },
          }],
        },
      },
    },
    ...overrides,
  };
}

test('production config needs only secret values and uses production ids', () => {
  const config = productionConfig({
    N8N_API_KEY: 'n8n-secret',
    PURCHASING_API_TOKEN: '0123456789abcdef',
    MINMAX_E2E_MAIL_USER: 'miskakhv@yandex.ru',
    MINMAX_E2E_MAIL_PASSWORD: 'mail-secret',
  });

  assert.equal(config.n8n.workflowId, 'minmaxYandexIntakeFixed01');
  assert.equal(config.n8n.credentials.httpHeaderAuth, 'pjXec1bxtt81cy0u');
  assert.equal(config.n8n.credentials.imap, 'Od4UJQh12iTGufks');
  assert.equal(config.n8n.credentials.smtp, 'zOGxEOJGUvn59jgC');
  assert.equal(config.n8n.container, 'n8n');
  assert.equal(config.mail.smtpHost, 'smtp.yandex.ru');
  assert.equal(config.mail.imapHost, 'imap.yandex.ru');
  assert.match(config.ownerUrl, /^http:\/\/[^/]+:3210$/);
});

test('production config rejects missing secrets and placeholder owner URL', () => {
  assert.throws(() => productionConfig({}), /MINMAX_E2E_MAIL_USER/);
  assert.throws(() => productionConfig({
    N8N_API_KEY: 'n8n-secret',
    PURCHASING_API_TOKEN: '0123456789abcdef',
    MINMAX_E2E_MAIL_USER: 'owner@example.test',
    MINMAX_E2E_MAIL_PASSWORD: 'mail-secret',
    MINMAX_OWNER_UI_BASE_URL: 'http://<SERVER-IP>:3210',
  }), /absolute usable URL/);
});

test('published registry node contract exposes JSON, retries and exact options', () => {
  const snapshot = registryNodeSnapshot(workflow);
  assert.equal(snapshot.method, 'GET');
  assert.equal(snapshot.accept, 'application/json');
  assert.equal(snapshot.responseFormat, 'json');
  assert.equal(snapshot.neverError, true);
  assert.equal(snapshot.fullResponse, false);
  assert.equal(snapshot.includeHeaders, false);
  assert.equal(snapshot.retryOnFail, true);
  assert.equal(snapshot.maxTries, 3);
  assert.equal(snapshot.waitBetweenTries, 5000);
  assert.equal(snapshot.redirects, true);
  assert.equal(snapshot.encoding, 'utf8');
  assert.equal(snapshot.timeout, 30000);
});

test('Docker service is restart-safe and keeps output/data on host mounts', () => {
  const compose = fs.readFileSync(path.join(
    ROOT,
    'docker/purchasing-web-backend/compose.yml'
  ), 'utf8');
  const dockerfile = fs.readFileSync(path.join(
    ROOT,
    'docker/purchasing-web-backend/Dockerfile'
  ), 'utf8');
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /"3210:3210"/);
  assert.match(compose, /\.\.\/\.\.\/output:\/app\/output/);
  assert.match(compose, /data\/purchasing:\/app\/data\/purchasing/);
  assert.match(compose, /PURCHASING_API_TOKEN/);
  assert.match(compose, /PURCHASING_BUILD_SHA/);
  assert.match(dockerfile, /HEALTHCHECK/);
});

test('SMTP message has one Excel attachment and correlation marker', () => {
  const message = buildExcelMessage({
    marker: 'marker-123',
    from: 'from@example.test',
    to: 'to@example.test',
    subject: 'MinMax production E2E marker-123',
    fileName: 'minmax-e2e.xlsx',
    file: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    date: '2026-08-02T00:00:00.000Z',
  });
  assert.match(message, /Message-ID: <marker-123@codex-minmax-e2e>/);
  assert.match(message, /filename="minmax-e2e\.xlsx"/);
  assert.equal((message.match(/Content-Disposition: attachment/g) || []).length, 1);
  assert.match(message, /UEsDBA==/);
});

test('IMAP search starts one UTC day earlier to avoid timezone gaps', () => {
  assert.equal(imapSinceDate('2026-08-02T00:01:00.000Z'), '1-Aug-2026');
});

test('execution polling selects one correlated successful production execution', async () => {
  const detail = execution();
  const client = {
    async request(method, endpoint) {
      assert.equal(method, 'GET');
      if (endpoint.startsWith('/executions?')) {
        return { data: [{
          id: detail.id,
          startedAt: detail.startedAt,
        }] };
      }
      return detail;
    },
  };
  const result = await waitForE2EExecution(client, {
    timeoutMs: 100,
    n8n: { workflowId: 'minmaxYandexIntakeFixed01' },
  }, 'MinMax production E2E marker', Date.parse(detail.startedAt), {
    delay: async () => {},
  });
  assert.equal(result.id, 'e2e-100');
  assert.deepEqual(
    latestOutputJson(result, 'Сформировать уведомление'),
    { runId: 'run-1' }
  );
});

test('execution polling rejects a correlated duplicate', async () => {
  const first = execution();
  const second = execution({ id: 'e2e-101' });
  const client = {
    async request(method, endpoint) {
      if (endpoint.startsWith('/executions?')) {
        return { data: [first, second] };
      }
      return endpoint.includes(first.id) ? first : second;
    },
  };
  await assert.rejects(
    () => waitForE2EExecution(client, {
      timeoutMs: 100,
      n8n: { workflowId: 'minmaxYandexIntakeFixed01' },
    }, 'MinMax production E2E marker', Date.parse(first.startedAt), {
      delay: async () => {},
    }),
    /Expected one matching execution, found 2/
  );
});

test('credential metadata verifies all three deployed credential types', async () => {
  const values = new Map([
    ['http-id', { id: 'http-id', name: 'Arthur Core API', type: 'httpHeaderAuth' }],
    ['imap-id', { id: 'imap-id', name: 'Yandex IMAP', type: 'imap' }],
    ['smtp-id', { id: 'smtp-id', name: 'Yandex SMTP', type: 'smtp' }],
  ]);
  const result = await verifyCredentialMetadata({
    n8n: { credentials: {
      httpHeaderAuth: 'http-id',
      imap: 'imap-id',
      smtp: 'smtp-id',
    } },
  }, {
    request: async (method, endpoint) => values.get(endpoint.split('/').at(-1)),
  });
  assert.equal(result.length, 3);
});

test('connection-refused check accepts only a real transport failure', async () => {
  const cause = new Error('connect ECONNREFUSED 127.0.0.1:1');
  assert.equal(await verifyConnectionRefused({
    fetch: async () => { throw cause; },
  }), cause);
  await assert.rejects(
    () => verifyConnectionRefused({ fetch: async () => ({ ok: true }) }),
    /unexpectedly reached port 1/
  );
});
