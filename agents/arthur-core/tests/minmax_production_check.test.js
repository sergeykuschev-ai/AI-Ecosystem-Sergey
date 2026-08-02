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
  buildE2EMailOptions,
  buildE2ESubject,
  inspectHistoricalExecution,
  latestOutputJson,
  productionConfig,
  productionEnvironment: buildProductionEnvironment,
  registryNodeSnapshot,
  verifyConnectionRefused,
  verifyCredentialMetadata,
  verifyDeployedRuntimeConfig,
  waitForE2EExecution,
} = require('../../../scripts/arthur/minmax-production-check');
const {
  bindFixedRuntimeConfig,
} = require('../../../scripts/arthur/minmax-n8n-workflow-deployment');

const ROOT = path.resolve(__dirname, '../../..');
const workflow = JSON.parse(fs.readFileSync(path.join(
  ROOT,
  'n8n/workflows/arthur-minmax-yandex-mail-intake-fixed.json'
), 'utf8'));

function productionEnvironment(overrides = {}) {
  return {
    N8N_API_KEY: 'n8n-secret',
    PURCHASING_API_TOKEN: '0123456789abcdef',
    MINMAX_E2E_MAIL_USER: 'e2e-sender@example.test',
    MINMAX_E2E_MAIL_PASSWORD: 'mail-secret',
    MINMAX_NOTIFY_EMAIL: 'owner@example.test',
    MINMAX_SMTP_FROM: 'robot@example.test',
    ...overrides,
  };
}

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

test('production config uses required runtime values and production ids', () => {
  const config = productionConfig(productionEnvironment());

  assert.equal(config.n8n.workflowId, 'minmaxYandexIntakeFixed01');
  assert.equal(config.n8n.credentials.httpHeaderAuth, 'pjXec1bxtt81cy0u');
  assert.equal(config.n8n.credentials.imap, 'Od4UJQh12iTGufks');
  assert.equal(config.n8n.credentials.smtp, 'zOGxEOJGUvn59jgC');
  assert.equal(config.n8n.container, 'n8n');
  assert.equal(config.mail.smtpHost, 'smtp.yandex.ru');
  assert.equal(config.mail.imapHost, 'imap.yandex.ru');
  assert.equal(config.allowedSender, 'e2e-sender@example.test');
  assert.equal(config.subjectPattern, 'minmax production e2e');
  assert.equal(config.executionId, null);
  assert.match(config.ownerUrl, /^http:\/\/[^/]+:3210$/);
});

test('production config rejects missing secrets and placeholder owner URL', () => {
  assert.throws(() => productionConfig({}), /MINMAX_E2E_MAIL_USER/);
  assert.throws(() => productionConfig(productionEnvironment({
    MINMAX_OWNER_UI_BASE_URL: 'http://<SERVER-IP>:3210',
  })), /absolute usable URL/);
  assert.throws(
    () => productionConfig(productionEnvironment({
      MINMAX_NOTIFY_EMAIL: '',
    })),
    /MINMAX_NOTIFY_EMAIL is required/
  );
  assert.throws(
    () => productionConfig(productionEnvironment({
      MINMAX_SMTP_FROM: '',
    })),
    /MINMAX_SMTP_FROM is required/
  );
});

test('empty production sender or subject pattern fails before deploy', () => {
  assert.throws(
    () => productionConfig(productionEnvironment({
      MINMAX_ALLOWED_SENDER: '',
    })),
    /MINMAX_ALLOWED_SENDER is required/
  );
  assert.throws(
    () => productionConfig(productionEnvironment({
      MINMAX_SUBJECT_PATTERN: '',
    })),
    /MINMAX_SUBJECT_PATTERN is required/
  );
});

test('E2E sender and subject match deployed production filters', () => {
  const config = productionConfig(productionEnvironment());
  config.shortSha = '031aabd';
  const deployEnvironment = buildProductionEnvironment(config);
  const deployed = bindFixedRuntimeConfig(workflow, {
    allowedSender: deployEnvironment.MINMAX_ALLOWED_SENDER,
    subjectPattern: deployEnvironment.MINMAX_SUBJECT_PATTERN,
    notifyTo: deployEnvironment.MINMAX_NOTIFY_EMAIL,
    notifyFrom: deployEnvironment.MINMAX_SMTP_FROM,
  });
  const snapshot = verifyDeployedRuntimeConfig(deployed, config);
  const marker = 'minmax-correlation-marker';
  const mail = buildE2EMailOptions(config, marker, Buffer.from('fixture'));

  assert.equal(snapshot.allowedSender, config.mail.user);
  assert.equal(deployEnvironment.MINMAX_ALLOWED_SENDER, config.mail.user);
  assert.equal(
    deployEnvironment.MINMAX_SUBJECT_PATTERN,
    'minmax production e2e'
  );
  assert.equal(mail.from, config.mail.user);
  assert.equal(mail.subject, buildE2ESubject(config, marker));
  assert.ok(mail.subject.toLowerCase().includes(
    snapshot.subjectPattern.toLowerCase()
  ));
});

test('accept-all deployed filter configuration is forbidden', () => {
  const config = productionConfig(productionEnvironment());
  assert.throws(
    () => verifyDeployedRuntimeConfig(workflow, config),
    /must not be accept-all/
  );
});

test('historical inspect is skipped without MINMAX_EXECUTION_ID', async () => {
  const config = productionConfig(productionEnvironment());
  let calls = 0;
  const result = await inspectHistoricalExecution(config, {}, {
    logger: { log() {} },
    inspectExecution: async () => { calls += 1; },
  });
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test('historical inspect runs when MINMAX_EXECUTION_ID is explicit', async () => {
  const config = productionConfig(productionEnvironment({
    MINMAX_EXECUTION_ID: '891',
  }));
  let received = null;
  const result = await inspectHistoricalExecution(config, { id: 'client' }, {
    logger: { log() {} },
    inspectExecution: async options => {
      received = options;
      return { cause: 'retained JSON evidence' };
    },
    printInspection() {},
  });
  assert.equal(received.executionId, '891');
  assert.equal(result.cause, 'retained JSON evidence');
});

test('repository workflow contains no real email addresses', () => {
  const code = workflow.nodes.find(node => node.id === 'minmax-fixed-config')
    .parameters.jsCode;
  assert.doesNotMatch(JSON.stringify(workflow), /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.match(code, /notifyTo: ''/);
  assert.match(code, /notifyFrom: ''/);
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
