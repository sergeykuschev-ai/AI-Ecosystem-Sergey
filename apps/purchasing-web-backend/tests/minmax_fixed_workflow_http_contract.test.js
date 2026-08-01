const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');

const {
  DEFAULT_SERVER_PATHS,
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
    assert.equal(
      node.parameters.options.response.response.responseFormat,
      'json'
    );
  }
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
