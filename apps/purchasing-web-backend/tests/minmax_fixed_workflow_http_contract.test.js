const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');

const {
  DEFAULT_SERVER_PATHS,
  MINMAX_HTTP_CONTRACT_VERSION,
} = require('../config');
const {
  runPurchasingWebOrchestrator,
} = require('../application/purchasing_run_orchestrator');
const {
  createPurchasingWebServer,
} = require('../server');
const {
  FileRunRegistry,
} = require('../storage/file_run_registry');
const {
  inspectWindowsPort,
  probeN8nContainer,
  verifyDirectContract,
} = require('../../../scripts/purchasing/verify-minmax-n8n-contract');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW_PATH = path.join(
  REPOSITORY_ROOT,
  'n8n/workflows/arthur-minmax-yandex-mail-intake-fixed.json'
);
const WORKBOOK_PATH = path.join(
  REPOSITORY_ROOT,
  'tests/fixtures/SmartZapas_synthetic.xlsx'
);
const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
const API_TOKEN = 'minmax-fixed-contract-token';
const RUN_KEY =
  'minmax-contract-run-000000000000000000000000000000000000000000000001';
const ERROR_KEY =
  'minmax-contract-error-0000000000000000000000000000000000000000000001';

const HTTP_NODE_CONTRACT = Object.freeze({
  'register-ignored': Object.freeze({
    method: 'POST',
    pathFragment: '/api/v1/upload-idempotency',
  }),
  'check-registry': Object.freeze({
    method: 'GET',
    pathFragment: '/api/v1/upload-idempotency/',
  }),
  'upload-excel': Object.freeze({
    method: 'POST',
    pathFragment: '/api/v1/runs',
  }),
  'poll-run-status': Object.freeze({
    method: 'GET',
    pathFragment: '/api/v1/runs/',
  }),
  'fetch-summary': Object.freeze({
    method: 'GET',
    pathFragment: '/summary',
  }),
  'fetch-items-summary': Object.freeze({
    method: 'GET',
    pathFragment: '/items?page_size=1',
  }),
  'mark-notification-sent': Object.freeze({
    method: 'POST',
    pathFragment: '/notification',
  }),
  'mark-uncertain': Object.freeze({
    method: 'POST',
    pathFragment: '/state',
  }),
});

function isolatedServerPaths(root) {
  return {
    ...DEFAULT_SERVER_PATHS,
    ownerDecisionsPath: path.join(root, 'owner-decisions.json'),
    ownerDecisionHistoryPath: path.join(
      root,
      'owner-decision-history.json'
    ),
    ownerLearningCandidateLifecycleFilePath: path.join(
      root,
      'owner-learning-candidate-lifecycle.json'
    ),
    ownerLearningRuleMaterializationsFilePath: path.join(
      root,
      'owner-learning-rule-materializations.json'
    ),
    ownerLearningRuleStatusEventsFilePath: path.join(
      root,
      'owner-learning-rule-status-events.json'
    ),
    ownerLearningRuleActivationPreviewsFilePath: path.join(
      root,
      'owner-learning-rule-activation-previews.json'
    ),
    ownerLearningRuleEffectivenessFilePath: path.join(
      root,
      'owner-learning-rule-effectiveness.json'
    ),
    approvedRulesPath: path.join(root, 'owner-approved-rules.json'),
    ownerLearningHistoryPath: path.join(root, 'owner-learning-history.json'),
  };
}

function workbookForm() {
  const form = new FormData();
  form.append('file', new Blob([
    fs.readFileSync(WORKBOOK_PATH),
  ], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), 'minmax-contract.xlsx');
  form.append('idempotency_key', RUN_KEY);
  form.append('mailbox', 'INBOX');
  form.append('message_uid', 'contract-1001');
  return form;
}

async function startContractServer(root, orchestrator) {
  const runsRoot = path.join(root, 'runs');
  const registry = new FileRunRegistry({
    runsRoot,
    ownerLearningHistoryPath: path.join(root, 'owner-learning-history.json'),
    approvedRulesPath: path.join(root, 'owner-approved-rules.json'),
    logger: { warn() {}, error() {}, info() {} },
  });
  const server = createPurchasingWebServer({
    registry,
    serverPaths: isolatedServerPaths(root),
    uploadRoot: path.join(root, 'uploads'),
    uploadIdempotencyPath: path.join(root, 'upload-idempotency.json'),
    apiToken: API_TOKEN,
    backendBuildSha: 'abcdef1',
    routerOptions: {
      isLoopbackRequest: () => false,
    },
    orchestrator,
    logger: { warn() {}, error() {}, info() {} },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    registry,
    runsRoot,
    server,
  };
}

async function jsonRequest(baseUrl, requestPath, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.useApiKey !== false) headers.set('x-api-key', API_TOKEN);
  const response = await fetch(`${baseUrl}${requestPath}`, {
    ...options,
    headers,
  });
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  assert.match(
    contentType,
    /^application\/json(?:;|$)/i,
    `${options.method || 'GET'} ${requestPath} должен вернуть JSON`
  );
  let body;
  assert.doesNotThrow(() => {
    body = JSON.parse(text);
  }, `${options.method || 'GET'} ${requestPath} вернул невалидный JSON`);
  assert.notEqual(
    body?.error?.code,
    'ROUTE_NOT_FOUND',
    `${options.method || 'GET'} ${requestPath} отсутствует в router`
  );
  return { response, body };
}

test('fixed workflow HTTP-ноды соответствуют единому backend-контракту', () => {
  const httpNodes = workflow.nodes.filter(
    node => node.type === 'n8n-nodes-base.httpRequest'
  );
  assert.deepEqual(
    httpNodes.map(node => node.id).sort(),
    Object.keys(HTTP_NODE_CONTRACT).sort(),
    'каждая HTTP-нода должна быть явно учтена контрактом'
  );

  for (const node of httpNodes) {
    const expected = HTTP_NODE_CONTRACT[node.id];
    assert.equal(node.parameters.method || 'GET', expected.method);
    assert.ok(
      node.parameters.url.includes(expected.pathFragment),
      `${node.name}: URL должен содержать ${expected.pathFragment}`
    );
    assert.equal(node.parameters.authentication, 'genericCredentialType');
    assert.equal(node.parameters.genericAuthType, 'httpHeaderAuth');
    assert.equal(node.credentials.httpHeaderAuth.name, 'Arthur Core API');
    assert.ok(
      node.parameters.headerParameters.parameters.some(parameter =>
        parameter.name === 'Accept' && parameter.value === 'application/json'
      ),
      `${node.name}: должен явно запрашивать application/json`
    );
    assert.equal(
      node.parameters.options.response.response.responseFormat,
      'json'
    );
  }
});

test('HTTP Request JSON contract handles registry 404 and found with x-api-key', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minmax-http-node-json-'));
  const runtime = await startContractServer(root, async () => {});
  t.after(async () => {
    runtime.server.close();
    await once(runtime.server, 'close').catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });

  const node = workflow.nodes.find(item => item.id === 'check-registry');
  assert.equal(
    node.parameters.options.response.response.responseFormat,
    'json'
  );
  assert.ok(node.parameters.headerParameters.parameters.some(header =>
    header.name === 'Accept' && header.value === 'application/json'
  ));

  const key = 'minmax-http-node-contract-404-and-found';
  const missing = await jsonRequest(
    runtime.baseUrl,
    `/api/v1/upload-idempotency/${key}`
  );
  assert.equal(missing.response.status, 404);
  assert.equal(
    missing.body.error.code,
    'UPLOAD_IDEMPOTENCY_RECORD_NOT_FOUND'
  );

  const created = await jsonRequest(
    runtime.baseUrl,
    '/api/v1/upload-idempotency',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotency_key: key,
        mailbox: 'INBOX',
        message_uid: 'contract-272',
        attachment_name: 'contract.xlsx',
        state: 'rejected',
        error_code: 'CONTRACT_ONLY',
      }),
    }
  );
  assert.equal(created.response.status, 201);

  const found = await jsonRequest(
    runtime.baseUrl,
    `/api/v1/upload-idempotency/${key}`
  );
  assert.equal(found.response.status, 200);
  assert.equal(found.body.data.idempotency_key, key);

  const unauthorized = await jsonRequest(
    runtime.baseUrl,
    `/api/v1/upload-idempotency/${key}`,
    { useApiKey: false }
  );
  assert.equal(unauthorized.response.status, 401);
  assert.equal(unauthorized.body.error.code, 'API_TOKEN_REQUIRED');
});

test('реальный backend обслуживает полный fixed-workflow lifecycle и replay', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minmax-contract-'));
  let releaseOrchestrator;
  let notifyOrchestratorStarted;
  const orchestratorStarted = new Promise(resolve => {
    notifyOrchestratorStarted = resolve;
  });
  const orchestratorGate = new Promise(resolve => {
    releaseOrchestrator = resolve;
  });
  const orchestrator = async (...args) => {
    notifyOrchestratorStarted();
    await orchestratorGate;
    return runPurchasingWebOrchestrator(...args);
  };
  const runtime = await startContractServer(root, orchestrator);
  t.after(async () => {
    releaseOrchestrator();
    runtime.server.close();
    await once(runtime.server, 'close').catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });

  const bearerOnly = await jsonRequest(
    runtime.baseUrl,
    `/api/v1/upload-idempotency/${RUN_KEY}`,
    {
      headers: { authorization: `Bearer ${API_TOKEN}` },
      useApiKey: false,
    }
  );
  assert.equal(bearerOnly.response.status, 401);
  assert.equal(bearerOnly.body.error.code, 'API_TOKEN_REQUIRED');

  const health = await jsonRequest(runtime.baseUrl, '/api/v1/health');
  assert.equal(health.response.status, 200);
  assert.equal(
    health.body.data.minmax_http_contract,
    MINMAX_HTTP_CONTRACT_VERSION
  );
  assert.equal(health.body.data.build_sha, 'abcdef1');

  const missing = await jsonRequest(
    runtime.baseUrl,
    `/api/v1/upload-idempotency/${RUN_KEY}`
  );
  assert.equal(missing.response.status, 404);
  assert.equal(
    missing.body.error.code,
    'UPLOAD_IDEMPOTENCY_RECORD_NOT_FOUND'
  );

  const errorRegistered = await jsonRequest(
    runtime.baseUrl,
    '/api/v1/upload-idempotency',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotency_key: ERROR_KEY,
        mailbox: 'INBOX',
        message_uid: 'contract-error-1',
        attachment_name: 'invalid.pdf',
        state: 'rejected',
        error_code: 'ATTACHMENT_TYPE_UNSUPPORTED',
      }),
    }
  );
  assert.equal(errorRegistered.response.status, 201);
  assert.equal(errorRegistered.body.data.state, 'rejected');

  const uncertain = await jsonRequest(
    runtime.baseUrl,
    `/api/v1/upload-idempotency/${ERROR_KEY}/state`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        state: 'uncertain',
        error_code: 'POLL_TIMEOUT',
      }),
    }
  );
  assert.equal(uncertain.response.status, 200);
  assert.equal(uncertain.body.data.state, 'uncertain');
  assert.equal(uncertain.body.data.error_code, 'POLL_TIMEOUT');

  const uploadPromise = jsonRequest(runtime.baseUrl, '/api/v1/runs', {
    method: 'POST',
    headers: { 'x-idempotency-key': RUN_KEY },
    body: workbookForm(),
  });
  await orchestratorStarted;

  const processing = await jsonRequest(
    runtime.baseUrl,
    `/api/v1/upload-idempotency/${RUN_KEY}`
  );
  assert.equal(processing.response.status, 200);
  assert.equal(processing.body.data.state, 'processing');
  assert.match(processing.body.data.run_id, /^[0-9a-f-]{36}$/i);

  releaseOrchestrator();
  const uploaded = await uploadPromise;
  assert.equal(uploaded.response.status, 201);
  const runId = uploaded.body.data.run_id;
  assert.equal(runId, processing.body.data.run_id);

  const status = await jsonRequest(
    runtime.baseUrl,
    `/api/v1/runs/${runId}`
  );
  assert.equal(status.response.status, 200);
  assert.equal(status.body.data.status, 'completed');

  const summary = await jsonRequest(
    runtime.baseUrl,
    `/api/v1/runs/${runId}/summary`
  );
  assert.equal(summary.response.status, 200);
  assert.equal(summary.body.data.run_id, runId);

  const items = await jsonRequest(
    runtime.baseUrl,
    `/api/v1/runs/${runId}/items?page_size=1`
  );
  assert.equal(items.response.status, 200);
  assert.ok(Array.isArray(items.body.data.items));

  const notifiedAt = '2026-08-01T01:00:00.000Z';
  const notified = await jsonRequest(
    runtime.baseUrl,
    `/api/v1/upload-idempotency/${RUN_KEY}/notification`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sent_at: notifiedAt }),
    }
  );
  assert.equal(notified.response.status, 200);
  assert.equal(notified.body.data.notification_sent_at, notifiedAt);

  const replay = await jsonRequest(runtime.baseUrl, '/api/v1/runs', {
    method: 'POST',
    headers: { 'x-idempotency-key': RUN_KEY },
    body: workbookForm(),
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.data.run_id, runId);
  assert.equal(replay.body.data.idempotent_replay, true);

  const runDirectories = fs.readdirSync(runtime.runsRoot, {
    withFileTypes: true,
  }).filter(entry => entry.isDirectory());
  assert.equal(runDirectories.length, 1, 'replay не создаёт второй run');
});

test('диагностический скрипт проверяет реальные JSON headers/body и все idempotency routes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minmax-diagnostic-'));
  const runtime = await startContractServer(
    root,
    runPurchasingWebOrchestrator
  );
  t.after(async () => {
    runtime.server.close();
    await once(runtime.server, 'close').catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });
  const messages = [];
  const diagnosticOptions = {
    baseUrl: runtime.baseUrl,
    apiKey: API_TOKEN,
    expectedSha: 'abcdef1',
  };
  const diagnosticDependencies = {
    logger: { log(message) { messages.push(message); } },
  };
  const result = await verifyDirectContract(
    diagnosticOptions,
    diagnosticDependencies
  );
  const repeated = await verifyDirectContract(
    diagnosticOptions,
    diagnosticDependencies
  );

  assert.equal(result.expectedSha, 'abcdef1');
  assert.notEqual(result.key, repeated.key);
  assert.ok(messages.some(message => message.includes('health auth=none')));
  assert.ok(messages.some(message => message.includes('health auth=bearer')));
  assert.ok(messages.some(message => message.includes('health auth=x-api-key')));
  assert.ok(messages.some(message => message.includes('GET registry')));
  assert.ok(messages.some(message => message.includes('POST registry')));
  assert.ok(messages.some(message => message.includes('POST state')));
  assert.ok(messages.some(message => message.includes('POST notification')));
  assert.deepEqual(
    fs.readdirSync(root, { recursive: true })
      .filter(name => name.endsWith('.tmp')),
    []
  );
});

test('диагностика проверяет listener Windows и маршрут из n8n-контейнера', () => {
  const messages = [];
  const logger = { log(message) { messages.push(message); } };
  const listener = inspectWindowsPort(3210, {
    platform: 'win32',
    logger,
    spawn() {
      return {
        status: 0,
        stdout: JSON.stringify({
          pid: 4242,
          name: 'node.exe',
          commandLine: 'node apps/purchasing-web-backend/server.js',
        }),
        stderr: '',
      };
    },
  });
  assert.equal(listener.pid, 4242);

  const healthBody = JSON.stringify({
    api_version: 'v1',
    data: {
      status: 'ok',
      service: 'purchasing-web',
      minmax_http_contract: MINMAX_HTTP_CONTRACT_VERSION,
      build_sha: 'abcdef1',
    },
  });
  const requiredBody = JSON.stringify({
    api_version: 'v1',
    error: { code: 'API_TOKEN_REQUIRED' },
  });
  let capturedSpawn = null;
  const probe = probeN8nContainer({
    apiKey: API_TOKEN,
    expectedSha: 'abcdef1',
    n8nContainer: 'n8n',
    containerBaseUrl: 'http://host.docker.internal:3210',
  }, {
    logger,
    spawn(command, args, spawnOptions) {
      capturedSpawn = { command, args, spawnOptions };
      return {
        status: 0,
        stdout: JSON.stringify([
          {
            mode: 'none',
            status: 401,
            contentType: 'application/json; charset=utf-8',
            body: requiredBody,
          },
          {
            mode: 'bearer',
            status: 401,
            contentType: 'application/json; charset=utf-8',
            body: requiredBody,
          },
          {
            mode: 'x-api-key',
            status: 200,
            contentType: 'application/json; charset=utf-8',
            body: healthBody,
          },
        ]),
        stderr: '',
      };
    },
  });
  assert.equal(probe.length, 3);
  assert.equal(capturedSpawn.command, 'docker');
  assert.deepEqual(capturedSpawn.args.slice(0, 2), ['exec', '-i']);
  assert.deepEqual(capturedSpawn.args.slice(-3), [
    'node', '-', 'http://host.docker.internal:3210',
  ]);
  assert.match(capturedSpawn.spawnOptions.input, /Promise\.all/);
  assert.ok(!capturedSpawn.args.includes(capturedSpawn.spawnOptions.input));
  assert.ok(!capturedSpawn.args.includes(API_TOKEN));
  assert.ok(messages.some(message => message.includes('PID 4242')));
  assert.ok(messages.some(message =>
    message.includes('container health auth=x-api-key')
  ));
});
