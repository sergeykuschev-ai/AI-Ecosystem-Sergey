const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, before, test } = require('node:test');

const {
  runPurchasingWebOrchestrator,
} = require('../application/purchasing_run_orchestrator');
const {
  FileArtifactStore,
} = require('../storage/file_artifact_store');
const {
  FileRunRegistry,
} = require('../storage/file_run_registry');
const {
  cleanupExpiredRuns,
} = require('../storage/retention_cleanup');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const OLD_RUN_ID = '33333333-3333-4333-8333-333333333333';
const PROCESSING_RUN_ID = '44444444-4444-4444-8444-444444444444';
const GENERATED_AT = '2026-07-23T00:00:00.000Z';
const temporaryRoots = [];
let sourceBundle;

function runRequest() {
  return {
    runId: RUN_ID,
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-registry-'));
  temporaryRoots.push(root);
  return root;
}

function registryAt(root) {
  const artifactStore = new FileArtifactStore({ runsRoot: root });
  return new FileRunRegistry({ runsRoot: root, artifactStore });
}

function createProcessing(registry, runId, createdAt = GENERATED_AT) {
  return registry.createProcessingRun({
    runId,
    createdAt,
    startedAt: createdAt,
    source: {
      original_name: '/private/input/SmartZapas.xlsx',
      size_bytes: 164084,
      sha256: 'input-sha',
    },
  });
}

function temporaryFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true })
    .filter(name => name.endsWith('.tmp'));
}

before(async () => {
  sourceBundle = await runPurchasingWebOrchestrator(runRequest());
});

afterEach(() => {
  while (temporaryRoots.length > 0) {
    fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

test('completed bundle is atomically published with all required files', () => {
  const root = temporaryRoot();
  const registry = registryAt(root);
  createProcessing(registry, RUN_ID);
  const saved = registry.saveCompletedRun(sourceBundle, {
    completedAt: GENERATED_AT,
  });
  const runDirectory = path.join(root, RUN_ID);

  assert.equal(saved.status.status, 'completed');
  [
    'run.json',
    'summary.json',
    'items.json',
    'owner-review-compact.json',
    'artifacts/manifest.json',
  ].forEach(relativePath => {
    const content = fs.readFileSync(
      path.join(runDirectory, relativePath),
      'utf8'
    );
    assert.doesNotThrow(() => JSON.parse(content));
  });
  assert.equal(temporaryFiles(root).length, 0);
  assert.equal(saved.manifest.artifacts.length, 12);
  assert.ok(saved.manifest.artifacts.every(artifact =>
    artifact.download_url ===
      `/api/v1/runs/${RUN_ID}/artifacts/${artifact.name}`
  ));
});

test('completed run is readable after registry recreation', () => {
  const root = temporaryRoot();
  const firstRegistry = registryAt(root);
  createProcessing(firstRegistry, RUN_ID);
  firstRegistry.saveCompletedRun(sourceBundle, {
    completedAt: GENERATED_AT,
  });

  const recreatedRegistry = registryAt(root);
  assert.equal(recreatedRegistry.getRunStatus(RUN_ID).status, 'completed');
  assert.equal(recreatedRegistry.getRunSummary(RUN_ID).sku_count, 6);
  assert.equal(recreatedRegistry.getItems(RUN_ID).length, 6);
  assert.equal(
    recreatedRegistry.getOwnerReview(RUN_ID).run_id,
    RUN_ID
  );
  assert.equal(recreatedRegistry.listArtifacts(RUN_ID).length, 12);
});

test('failed run stores only a safe run error', () => {
  const root = temporaryRoot();
  const registry = registryAt(root);
  createProcessing(registry, RUN_ID);
  registry.saveFailedRun(
    RUN_ID,
    new Error('/Users/private/source.xlsx failed'),
    {
      completedAt: GENERATED_AT,
      requestId: 'request-1',
    }
  );

  assert.deepEqual(fs.readdirSync(path.join(root, RUN_ID)), ['run.json']);
  const status = registry.getRunStatus(RUN_ID);
  assert.equal(status.status, 'failed');
  assert.equal(status.error.code, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(status).includes('/Users/private'), false);
  assert.equal('stack' in status.error, false);
  assert.equal('cause' in status.error, false);
});

test('invalid UUID and traversal cannot address a run directory', () => {
  const root = temporaryRoot();
  const registry = registryAt(root);
  for (const runId of ['../outside', '/tmp/outside', 'not-a-uuid']) {
    assert.throws(
      () => registry.getRunStatus(runId),
      error => error.code === 'INVALID_RUN_ID'
    );
  }
  assert.equal(fs.existsSync(path.join(root, '..', 'outside')), false);
});

test('retention removes expired completed runs but keeps processing runs', () => {
  const root = temporaryRoot();
  const registry = registryAt(root);
  createProcessing(registry, PROCESSING_RUN_ID, GENERATED_AT);
  createProcessing(registry, OLD_RUN_ID, GENERATED_AT);
  registry.saveCompletedRun({
    ...sourceBundle,
    run_id: OLD_RUN_ID,
    generated_at: GENERATED_AT,
  }, {
    completedAt: GENERATED_AT,
  });

  const cleanup = cleanupExpiredRuns({
    runsRoot: root,
    ttlMs: 24 * 60 * 60 * 1000,
    now: '2026-07-25T00:00:00.001Z',
  });
  assert.deepEqual(cleanup.removed, [OLD_RUN_ID]);
  assert.deepEqual(cleanup.skipped_processing, [PROCESSING_RUN_ID]);
  assert.equal(fs.existsSync(path.join(root, OLD_RUN_ID)), false);
  assert.equal(fs.existsSync(path.join(root, PROCESSING_RUN_ID)), true);
});

test('retention safely ignores an absent runs directory', () => {
  const root = path.join(temporaryRoot(), 'absent');
  assert.deepEqual(cleanupExpiredRuns({ runsRoot: root }), {
    removed: [],
    skipped_processing: [],
    errors: 0,
  });
});
