const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter, once } = require('node:events');
const { afterEach, before, test } = require('node:test');

const {
  runPurchasingWebOrchestrator,
} = require('../application/purchasing_run_orchestrator');
const {
  RunExecutionLock,
} = require('../application/run_execution_lock');
const {
  createPurchasingWebServer,
  installGracefulShutdown,
} = require('../server');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const GENERATED_AT = '2026-07-23T00:00:00.000Z';
const temporaryRoots = [];
const openServers = [];
let sourceBundle;
let workbook;

function runRequest() {
  return {
    runId: 'aaaaaaaa-1111-4111-8111-111111111111',
    inputPath: path.join(
      REPOSITORY_ROOT,
      'tests/fixtures/SmartZapas_synthetic.xlsx'
    ),
    generatedAt: GENERATED_AT,
    financialDataPath: path.join(
      REPOSITORY_ROOT,
      'data/purchasing/miska-financial-current.json'
    ),
    configPath: path.join(
      REPOSITORY_ROOT,
      'data/purchasing/miska-matrix-builder-config.json'
    ),
    matrixPath: path.join(
      REPOSITORY_ROOT,
      'data/purchasing/miska-assortment-matrix.json'
    ),
    ownerDecisionsPath: path.join(
      REPOSITORY_ROOT,
      'data/purchasing/miska-owner-decisions.json'
    ),
    recommendationConfigPath: path.join(
      REPOSITORY_ROOT,
      'data/purchasing/miska-recommendation-explainer-config.json'
    ),
  };
}

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operational-safety-'));
  temporaryRoots.push(root);
  return root;
}

function uploadForm() {
  const form = new FormData();
  form.append('file', new Blob([workbook], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), 'fixture.xlsx');
  return form;
}

function bundleFor(request) {
  return {
    ...sourceBundle,
    run_id: request.runId,
    generated_at: request.generatedAt,
  };
}

async function startApplicationServer(options = {}) {
  const root = temporaryRoot();
  const server = createPurchasingWebServer({
    runsRoot: path.join(root, 'runs'),
    uploadRoot: path.join(root, 'uploads'),
    ...options,
  });
  openServers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

async function closeServer(server) {
  if (!server?.listening) return;
  const closed = once(server, 'close');
  server.close();
  await closed;
}

before(async () => {
  sourceBundle = await runPurchasingWebOrchestrator(runRequest());
  workbook = fs.readFileSync(runRequest().inputPath);
});

afterEach(async () => {
  while (openServers.length > 0) {
    await closeServer(openServers.pop());
  }
  while (temporaryRoots.length > 0) {
    fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

test('concurrent POST is rejected and success releases the lock', async () => {
  const runLock = new RunExecutionLock();
  let orchestratorCalls = 0;
  let releasePipeline;
  let pipelineEntered;
  const entered = new Promise(resolve => {
    pipelineEntered = resolve;
  });
  const gate = new Promise(resolve => {
    releasePipeline = resolve;
  });
  const orchestrator = async request => {
    orchestratorCalls += 1;
    pipelineEntered();
    await gate;
    return bundleFor(request);
  };
  const { baseUrl } = await startApplicationServer({
    orchestrator,
    runLock,
  });

  const firstRequest = fetch(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    body: uploadForm(),
  });
  await entered;
  assert.equal(runLock.isActive(), true);

  const secondResponse = await fetch(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    body: uploadForm(),
  });
  const secondBody = await secondResponse.json();
  assert.equal(secondResponse.status, 409);
  assert.equal(secondBody.api_version, 'v1');
  assert.equal(
    secondBody.error.code,
    'RUN_ALREADY_IN_PROGRESS'
  );
  assert.equal(orchestratorCalls, 1);

  releasePipeline();
  const firstResponse = await firstRequest;
  assert.equal(firstResponse.status, 201);
  assert.equal(runLock.isActive(), false);

  const thirdResponse = await fetch(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    body: uploadForm(),
  });
  assert.equal(thirdResponse.status, 201);
  assert.equal(orchestratorCalls, 2);
  assert.equal(runLock.isActive(), false);
});

test('pipeline failure releases the lock for the next POST', async () => {
  const runLock = new RunExecutionLock();
  let orchestratorCalls = 0;
  const orchestrator = async request => {
    orchestratorCalls += 1;
    if (orchestratorCalls === 1) {
      throw new Error('synthetic pipeline failure');
    }
    return bundleFor(request);
  };
  const { baseUrl } = await startApplicationServer({
    orchestrator,
    runLock,
  });

  const failedResponse = await fetch(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    body: uploadForm(),
  });
  const failedBody = await failedResponse.json();
  assert.equal(failedResponse.status, 500);
  assert.equal(failedBody.error.code, 'RUN_FAILED');
  assert.equal(runLock.isActive(), false);

  const successfulResponse = await fetch(`${baseUrl}/api/v1/runs`, {
    method: 'POST',
    body: uploadForm(),
  });
  assert.equal(successfulResponse.status, 201);
  assert.equal(orchestratorCalls, 2);
  assert.equal(runLock.isActive(), false);
});

test('graceful shutdown stops new connections and closes cleanly', async () => {
  let activeResponse;
  let requestEntered;
  const entered = new Promise(resolve => {
    requestEntered = resolve;
  });
  const server = http.createServer((request, response) => {
    activeResponse = response;
    requestEntered();
  });
  openServers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const activeRequest = fetch(`http://127.0.0.1:${port}/active`);
  await entered;

  const processObject = new EventEmitter();
  const exits = [];
  let resolveExit;
  const exited = new Promise(resolve => {
    resolveExit = resolve;
  });
  installGracefulShutdown({
    server,
    processObject,
    timeoutMs: 1000,
    logger: { warn() {} },
    exit: code => {
      exits.push(code);
      resolveExit();
    },
  });
  processObject.emit('SIGTERM', 'SIGTERM');
  assert.equal(server.listening, false);

  await assert.rejects(new Promise((resolve, reject) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port,
      path: '/new',
      agent: false,
    }, resolve);
    request.once('error', reject);
  }));

  activeResponse.end('done');
  const activeResult = await activeRequest;
  assert.equal(await activeResult.text(), 'done');
  await exited;
  assert.deepEqual(exits, [0]);
  assert.equal(server.listening, false);
});

test('a repeated shutdown signal forces termination', async () => {
  let activeResponse;
  let requestEntered;
  const entered = new Promise(resolve => {
    requestEntered = resolve;
  });
  const server = http.createServer((request, response) => {
    activeResponse = response;
    requestEntered();
  });
  openServers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const activeRequest = fetch(
    `http://127.0.0.1:${server.address().port}/active`
  ).catch(() => null);
  await entered;

  const processObject = new EventEmitter();
  const exits = [];
  installGracefulShutdown({
    server,
    processObject,
    timeoutMs: 1000,
    logger: { warn() {} },
    exit: code => exits.push(code),
  });
  processObject.emit('SIGINT', 'SIGINT');
  processObject.emit('SIGINT', 'SIGINT');
  await activeRequest;

  assert.deepEqual(exits, [1]);
  assert.equal(server.listening, false);
  if (!activeResponse.destroyed) activeResponse.destroy();
});
