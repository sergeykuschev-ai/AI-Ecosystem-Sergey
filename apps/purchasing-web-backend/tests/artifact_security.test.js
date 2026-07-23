const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { after, before, test } = require('node:test');

const {
  runPurchasingWebOrchestrator,
} = require('../application/purchasing_run_orchestrator');
const { RunQueryService } = require('../application/run_query_service');
const { ARTIFACT_NAMES } = require('../config');
const {
  FileArtifactStore,
} = require('../storage/file_artifact_store');
const {
  FileRunRegistry,
} = require('../storage/file_run_registry');
const {
  createPurchasingWebServer,
  startPurchasingWebServer,
} = require('../server');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const COMPLETED_RUN_ID = '11111111-aaaa-4111-8111-111111111111';
const OTHER_RUN_ID = '22222222-aaaa-4222-8222-222222222222';
const MISSING_RUN_ID = '33333333-aaaa-4333-8333-333333333333';
const SYMLINK_RUN_ID = '44444444-aaaa-4444-8444-444444444444';
const CORRUPTED_RUN_ID = '55555555-aaaa-4555-8555-555555555555';
const PROCESSING_RUN_ID = '66666666-aaaa-4666-8666-666666666666';
const FAILED_RUN_ID = '77777777-aaaa-4777-8777-777777777777';
const GENERATED_AT = '2026-07-23T00:00:00.000Z';

let root;
let runsRoot;
let uploadRoot;
let registry;
let server;
let baseUrl;
let bundle;
let artifactStreamCalls = 0;
let wholeArtifactReads = 0;

function requestFor(runId) {
  return {
    runId,
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

function instrumentedFs() {
  const wrapped = Object.create(fs);
  wrapped.createReadStream = (...args) => {
    artifactStreamCalls += 1;
    return fs.createReadStream(...args);
  };
  wrapped.readFileSync = (filePath, ...args) => {
    if (
      String(filePath).includes(`${path.sep}artifacts${path.sep}`) &&
      path.basename(String(filePath)) !== 'manifest.json'
    ) {
      wholeArtifactReads += 1;
    }
    return fs.readFileSync(filePath, ...args);
  };
  return wrapped;
}

function createProcessing(runId) {
  registry.createProcessingRun({
    runId,
    createdAt: GENERATED_AT,
    source: { original_name: 'fixture.xlsx' },
  });
}

function completeRun(runId) {
  createProcessing(runId);
  registry.saveCompletedRun({
    ...bundle,
    run_id: runId,
  }, {
    completedAt: GENERATED_AT,
  });
}

async function api(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const body = response.status >= 400
    ? JSON.parse(bytes.toString('utf8'))
    : bytes;
  return { response, body };
}

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-security-'));
  runsRoot = path.join(root, 'runs');
  uploadRoot = path.join(root, 'uploads');
  const fsModule = instrumentedFs();
  const artifactStore = new FileArtifactStore({ runsRoot, fsModule });
  registry = new FileRunRegistry({
    runsRoot,
    fsModule,
    artifactStore,
  });
  bundle = await runPurchasingWebOrchestrator(
    requestFor(COMPLETED_RUN_ID)
  );
  [
    COMPLETED_RUN_ID,
    OTHER_RUN_ID,
    MISSING_RUN_ID,
    SYMLINK_RUN_ID,
    CORRUPTED_RUN_ID,
  ].forEach(completeRun);
  createProcessing(PROCESSING_RUN_ID);
  createProcessing(FAILED_RUN_ID);
  registry.saveFailedRun(FAILED_RUN_ID, new Error('fixture failure'), {
    completedAt: GENERATED_AT,
  });

  fs.unlinkSync(path.join(
    runsRoot,
    MISSING_RUN_ID,
    'artifacts',
    'result.json'
  ));
  const outside = path.join(root, 'outside.json');
  fs.writeFileSync(outside, '{}\n');
  const symlinkArtifact = path.join(
    runsRoot,
    SYMLINK_RUN_ID,
    'artifacts',
    'result.json'
  );
  fs.unlinkSync(symlinkArtifact);
  fs.symlinkSync(outside, symlinkArtifact);
  fs.appendFileSync(path.join(
    runsRoot,
    CORRUPTED_RUN_ID,
    'artifacts',
    'result.json'
  ), 'tampered');

  server = createPurchasingWebServer({
    registry,
    queryService: new RunQueryService(registry),
    uploadRoot,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) {
    server.close();
    await once(server, 'close');
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('every whitelisted artifact streams with secure headers', async () => {
  const expectedTypes = {
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
  };
  const streamCountBefore = artifactStreamCalls;
  for (const name of ARTIFACT_NAMES) {
    const result = await api(
      `/api/v1/runs/${COMPLETED_RUN_ID}/artifacts/${name}`
    );
    assert.equal(result.response.status, 200, name);
    assert.equal(
      result.response.headers.get('content-type'),
      expectedTypes[path.extname(name)],
      name
    );
    assert.equal(
      result.response.headers.get('content-disposition'),
      `attachment; filename="${name}"`,
      name
    );
    assert.equal(
      Number(result.response.headers.get('content-length')),
      result.body.length,
      name
    );
    assert.equal(
      result.response.headers.get('x-content-type-options'),
      'nosniff'
    );
    assert.equal(result.response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(
    artifactStreamCalls - streamCountBefore,
    ARTIFACT_NAMES.length
  );
  assert.equal(wholeArtifactReads, 0);
});

test('manifest is browser-safe and complete', () => {
  const manifest = registry.artifactStore.readManifest(COMPLETED_RUN_ID);
  assert.equal(manifest.artifacts.length, ARTIFACT_NAMES.length);
  for (const artifact of manifest.artifacts) {
    assert.deepEqual(Object.keys(artifact).sort(), [
      'content_type',
      'download_url',
      'name',
      'sha256',
      'size_bytes',
    ]);
    assert.equal(
      artifact.download_url,
      `/api/v1/runs/${COMPLETED_RUN_ID}/artifacts/${artifact.name}`
    );
    assert.match(artifact.content_type, /^(application|text)\//);
    assert.ok(Number.isInteger(artifact.size_bytes));
    assert.ok(artifact.size_bytes > 0);
    assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
  }
  const serialized = JSON.stringify(manifest);
  assert.equal(serialized.includes(root), false);
  assert.equal(serialized.includes('/Users/'), false);
  assert.equal(serialized.includes('.tmp'), false);
});

test('unknown and missing artifacts return distinct safe errors', async () => {
  const unknown = await api(
    `/api/v1/runs/${COMPLETED_RUN_ID}/artifacts/unknown.json`
  );
  const missing = await api(
    `/api/v1/runs/${MISSING_RUN_ID}/artifacts/result.json`
  );
  assert.equal(unknown.response.status, 403);
  assert.equal(unknown.body.error.code, 'ARTIFACT_NOT_ALLOWED');
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, 'ARTIFACT_NOT_FOUND');
});

test('traversal, backslash, absolute path and NUL are invalid', async () => {
  const attacks = [
    '%2e%2e%2fresult.json',
    '%2e%2e%5cresult.json',
    '%2fetc%2fpasswd',
    'result.json%00',
    encodeURIComponent(
      `../../${OTHER_RUN_ID}/artifacts/result.json`
    ),
  ];
  for (const attack of attacks) {
    const result = await api(
      `/api/v1/runs/${COMPLETED_RUN_ID}/artifacts/${attack}`
    );
    assert.equal(result.response.status, 400, attack);
    assert.equal(result.body.error.code, 'INVALID_ARTIFACT_NAME', attack);
    assert.equal(JSON.stringify(result.body).includes(root), false);
  }
});

test('directory listing is absent and invalid UUID is rejected', async () => {
  const listing = await api(
    `/api/v1/runs/${COMPLETED_RUN_ID}/artifacts/`
  );
  const invalidRun = await api(
    '/api/v1/runs/not-a-uuid/artifacts/result.json'
  );
  assert.equal(listing.response.status, 400);
  assert.equal(listing.body.error.code, 'INVALID_ARTIFACT_NAME');
  assert.equal(invalidRun.response.status, 400);
  assert.equal(invalidRun.body.error.code, 'INVALID_RUN_ID');
});

test('processing and failed runs cannot stream artifacts', async () => {
  const processing = await api(
    `/api/v1/runs/${PROCESSING_RUN_ID}/artifacts/result.json`
  );
  const failed = await api(
    `/api/v1/runs/${FAILED_RUN_ID}/artifacts/result.json`
  );
  assert.equal(processing.response.status, 409);
  assert.equal(processing.body.error.code, 'RUN_NOT_READY');
  assert.equal(failed.response.status, 409);
  assert.equal(failed.body.error.code, 'RUN_FAILED');
});

test('symlink escape is blocked and size mismatch is a stream error', async () => {
  const symlink = await api(
    `/api/v1/runs/${SYMLINK_RUN_ID}/artifacts/result.json`
  );
  const corrupted = await api(
    `/api/v1/runs/${CORRUPTED_RUN_ID}/artifacts/result.json`
  );
  assert.equal(symlink.response.status, 403);
  assert.equal(symlink.body.error.code, 'ARTIFACT_NOT_ALLOWED');
  assert.equal(corrupted.response.status, 500);
  assert.equal(corrupted.body.error.code, 'ARTIFACT_STREAM_ERROR');
});

test('startup cleanup removes expired runs and stale uploads only', async () => {
  const cleanupRoot = fs.mkdtempSync(path.join(root, 'startup-'));
  const cleanupRuns = path.join(cleanupRoot, 'runs');
  const cleanupUploads = path.join(cleanupRoot, 'uploads');
  const oldRun = '88888888-aaaa-4888-8888-888888888888';
  const activeRun = '99999999-aaaa-4999-8999-999999999999';
  for (const [runId, status] of [
    [oldRun, 'completed'],
    [activeRun, 'processing'],
  ]) {
    const directory = path.join(cleanupRuns, runId);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify({
      run_id: runId,
      status,
      created_at: '2026-07-20T00:00:00.000Z',
      completed_at: status === 'completed'
        ? '2026-07-20T01:00:00.000Z'
        : null,
    }));
  }
  const staleUploadId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const staleDirectory = path.join(cleanupUploads, staleUploadId);
  fs.mkdirSync(staleDirectory, { recursive: true });
  fs.writeFileSync(path.join(staleDirectory, 'upload.tmp'), 'partial');

  const cleanupServer = startPurchasingWebServer({
    port: 0,
    runsRoot: cleanupRuns,
    uploadRoot: cleanupUploads,
    retentionTtlMs: 24 * 60 * 60 * 1000,
    now: '2026-07-23T00:00:00.000Z',
    logger: { warn() {} },
  });
  await once(cleanupServer, 'listening');
  cleanupServer.close();
  await once(cleanupServer, 'close');

  assert.equal(fs.existsSync(path.join(cleanupRuns, oldRun)), false);
  assert.equal(fs.existsSync(path.join(cleanupRuns, activeRun)), true);
  assert.equal(fs.existsSync(staleDirectory), false);
});
