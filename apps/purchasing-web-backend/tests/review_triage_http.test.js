'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { once } = require('node:events');

const {
  DEFAULT_SERVER_PATHS,
} = require('../config');
const {
  runPurchasingWebOrchestrator,
} = require('../application/purchasing_run_orchestrator');
const {
  createReviewTriageService,
} = require('../application/review_triage_service');
const { RunQueryService } = require('../application/run_query_service');
const {
  FileRunRegistry,
} = require('../storage/file_run_registry');
const {
  createPurchasingWebServer,
} = require('../server');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const TRIAGE_RUN_ID = '11111111-2222-4111-8111-111111111111';
const LEGACY_RUN_ID = '22222222-3333-4222-8222-222222222222';
const FULL_FLOW_RUN_ID = '33333333-4444-4333-8333-333333333333';
const GENERATED_AT = '2026-07-23T00:00:00.000Z';

let temporaryRoot;
let runsRoot;
let registry;
let server;
let baseUrl;
let bundle;

function orchestratorRequest(runId) {
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

/**
 * Synthetic bundle with deterministic triage semantics:
 *   row-1, row-2 — verified-free POLICY conflicts (PKG1 members, 2 SKU);
 *   row-3        — exit candidate without canonical EXIT (DATA_OR_LINKAGE);
 *   row-4        — commercial review blocked by missing supplier data
 *                  (BLOCKED_BY_DATA, не active decision).
 */
function syntheticBundle() {
  const policyRow = identity => ({
    rowIdentity: identity,
    article: identity.toUpperCase(),
    name: `Товар ${identity}`,
    supplier: 'Поставщик',
    freeStock: 5,
    provisionalOrderQuantity: 3,
    workflowStatus: 'pending_manual_review',
  });
  const policyDraft = identity => ({
    rowIdentity: identity,
    article: identity.toUpperCase(),
    name: `Товар ${identity}`,
    supplier: 'Поставщик',
    manual_review_required: true,
    review_queue_memberships: [],
    reason_codes: [],
    data_quality: { missing_fields: [] },
    evidence: {
      purchase_price: 10,
      free_stock: 5,
      supplier_need_qty: 3,
      supplier_recommended_qty: 3,
    },
    existing_matrix_item: true,
  });
  const policyReview = identity => ({
    rowIdentity: identity,
    owner_action_required: true,
    owner_action_class: 'OWNER_ACTION_REQUIRED',
    owner_review_reasons: ['approved_policy_conflict'],
  });
  return {
    runId: TRIAGE_RUN_ID,
    agentJson: {
      run_id: TRIAGE_RUN_ID,
      workingOrderVersion: 'synthetic-version-1',
      workingOrderProducts: [
        policyRow('row-1'),
        policyRow('row-2'),
        {
          rowIdentity: 'row-3',
          article: 'ART-3',
          name: 'Товар exit',
          supplier: 'Поставщик',
          freeStock: 1,
          provisionalOrderQuantity: 0,
          workflowStatus: 'pending_manual_review',
        },
        {
          rowIdentity: 'row-4',
          article: 'ART-4',
          name: 'Товар blocked',
          supplier: 'Поставщик',
          freeStock: 2,
          provisionalOrderQuantity: 1,
          workflowStatus: 'pending_manual_review',
        },
      ],
    },
    manualReview: {
      items: [
        policyDraft('row-1'),
        policyDraft('row-2'),
        {
          rowIdentity: 'row-3',
          article: 'ART-3',
          name: 'Товар exit',
          supplier: 'Поставщик',
          manual_review_required: true,
          review_queue_memberships: ['exit_review'],
          reason_codes: [],
          data_quality: { missing_fields: [] },
          evidence: {
            purchase_price: 10,
            free_stock: 1,
            supplier_need_qty: 0,
            supplier_recommended_qty: 0,
          },
          existing_matrix_item: true,
        },
        {
          rowIdentity: 'row-4',
          article: 'ART-4',
          name: 'Товар blocked',
          supplier: 'Поставщик',
          manual_review_required: true,
          review_queue_memberships: [],
          reason_codes: [],
          data_quality: { missing_fields: [] },
          evidence: {
            purchase_price: 10,
            free_stock: 2,
            supplier_need_qty: null,
            supplier_recommended_qty: null,
          },
          existing_matrix_item: true,
        },
      ],
    },
    ownerReview: {
      report_version: 'synthetic-report-1',
      items: [
        policyReview('row-1'),
        policyReview('row-2'),
        {
          rowIdentity: 'row-3',
          owner_action_required: true,
          owner_action_class: 'OWNER_ACTION_REQUIRED',
          owner_review_reasons: ['exit_candidate'],
        },
        {
          rowIdentity: 'row-4',
          owner_action_required: true,
          owner_action_class: 'OWNER_ACTION_REQUIRED',
          owner_review_reasons: ['commercial_review'],
        },
      ],
    },
  };
}

function completeRun(runId, withTriage) {
  registry.createProcessingRun({
    runId,
    createdAt: GENERATED_AT,
    source: { original_name: 'fixture.xlsx' },
  });
  registry.saveCompletedRun({ ...bundle, run_id: runId }, {
    completedAt: GENERATED_AT,
  });
  if (!withTriage) return;
  const service = createReviewTriageService({
    logger: { warn() {}, error() {} },
    now: () => GENERATED_AT,
  });
  service.buildAndSaveReviewTriage({
    runId,
    agentResult: bundle.agentResult,
    manualReview: bundle.manualReview,
    ownerReview: bundle.ownerReview,
    artifactStore: registry.artifactStore,
    generatedAt: GENERATED_AT,
  });
}

before(async () => {
  temporaryRoot = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'purchasing-review-triage-'
  ));
  runsRoot = path.join(temporaryRoot, 'runs');
  registry = new FileRunRegistry({ runsRoot });
  bundle = await runPurchasingWebOrchestrator(
    orchestratorRequest(TRIAGE_RUN_ID)
  );

  // Real-flow run: triage artifacts are produced next to the run artifacts.
  completeRun(FULL_FLOW_RUN_ID, true);
  // Legacy run saved before review triage existed: no triage artifacts.
  completeRun(LEGACY_RUN_ID, false);

  // Synthetic deterministic triage for the endpoint contract test.
  const synthetic = syntheticBundle();
  const syntheticService = createReviewTriageService({
    matrixPath: path.join(temporaryRoot, 'missing-canonical.json'),
    sessionsPath: path.join(temporaryRoot, 'missing-sessions.json'),
    logger: { warn() {}, error() {} },
    now: () => GENERATED_AT,
  });
  syntheticService.buildAndSaveReviewTriage({
    runId: FULL_FLOW_RUN_ID,
    agentJson: synthetic.agentJson,
    manualReview: synthetic.manualReview,
    ownerReview: synthetic.ownerReview,
    artifactStore: registry.artifactStore,
    generatedAt: GENERATED_AT,
  });

  server = createPurchasingWebServer({
    registry,
    queryService: new RunQueryService(registry),
    serverPaths: {
      ...DEFAULT_SERVER_PATHS,
      ownerLearningHistoryPath: path.join(
        temporaryRoot,
        'owner-learning-history.json'
      ),
    },
    uploadRoot: path.join(temporaryRoot, 'uploads'),
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
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

async function jsonRequest(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  return { response, body: await response.json() };
}

test('completed run persists review-triage and compaction artifacts', () => {
  const artifactDirectory = path.join(runsRoot, FULL_FLOW_RUN_ID, 'artifacts');
  const triage = JSON.parse(fs.readFileSync(
    path.join(artifactDirectory, 'review-triage.json'),
    'utf8'
  ));
  const compaction = JSON.parse(fs.readFileSync(
    path.join(artifactDirectory, 'owner-review-compaction.json'),
    'utf8'
  ));
  assert.equal(triage.triage_version, 'review-triage-v2');
  assert.equal(triage.source_run_id, FULL_FLOW_RUN_ID);
  assert.equal(compaction.compactor_version, 'owner-review-compactor-v2');
  assert.equal(compaction.source_run_id, FULL_FLOW_RUN_ID);
  assert.deepEqual(
    compaction,
    triage.owner_review_compaction
  );

  const manifest = registry.artifactStore.readManifest(FULL_FLOW_RUN_ID);
  const names = manifest.artifacts.map(artifact => artifact.name);
  assert.ok(names.includes('review-triage.json'));
  assert.ok(names.includes('owner-review-compaction.json'));
});

test('GET review-triage returns contract fields and synthetic counters', async () => {
  const { response, body } = await jsonRequest(
    `/api/v1/runs/${FULL_FLOW_RUN_ID}/review-triage`
  );
  assert.equal(response.status, 200);
  assert.equal(body.api_version, 'v1');
  assert.equal(body.data.run_id, FULL_FLOW_RUN_ID);
  assert.equal(body.data.available, true);
  assert.equal(body.data.calculation_version, 'synthetic-version-1');

  assert.equal(body.data.summary.comparison.manual_queue_total_before, 4);
  assert.equal(body.data.summary.comparison.real_owner_decisions_after, 3);
  assert.equal(body.data.summary.sections.owner_decisions, 3);
  assert.equal(body.data.summary.sections.data_problems, 1);
  assert.equal(
    body.data.summary.categories.OWNER_DECISION_REQUIRED,
    3
  );

  const compaction = body.data.compaction;
  assert.equal(compaction.owner_queue_sku_count, 4);
  assert.equal(compaction.business_sku_count, 2);
  assert.equal(compaction.package_decision_count, 1);
  assert.equal(compaction.package_sku_count, 2);
  assert.equal(compaction.individual_decision_count, 0);
  assert.equal(compaction.total_owner_decision_count, 1);
  assert.equal(compaction.data_or_linkage_count, 1);
  assert.equal(compaction.blocked_by_data_count, 1);
  assert.equal(compaction.packages[0].package_id, 'PKG1');
  assert.equal(compaction.packages[0].count, 2);
  assert.deepEqual(compaction.exclusions[0].linkage_reason, 'exit');

  // BLOCKED_BY_DATA: позиция с data-дефектом не попала в active decisions,
  // но сохранила сигналы и пометку о будущем решении.
  const blocked = compaction.blocked[0];
  assert.equal(blocked.article, 'ART-4');
  assert.equal(blocked.blocker, 'data_or_linkage');
  assert.deepEqual(blocked.owner_signals, ['commercial_review']);
  assert.match(blocked.note, /После исправления данных/);
  assert.equal(
    compaction.packages[0].row_identities.includes(blocked.row_identity),
    false
  );

  // Presentation fields: members разрешены из полных artifacts (здесь
  // синтетический run без совпадающих items/manual — значения null, НЕ 0).
  const members = compaction.packages[0].members;
  assert.equal(members.length, 2);
  for (const member of members) {
    assert.equal(member.recommended_qty === 0, false);
    assert.equal(member.free_stock === 0, false);
    assert.ok('supplier_recommended_qty' in member);
    assert.ok('min_stock' in member);
    assert.ok('sales' in member);
  }
  assert.ok(blocked.recommended_action.length > 0);
  assert.equal(
    members.some(member => member.article === 'ROW-1' || member.article === 'ROW-2'),
    true
  );
});

test('GET review-triage for a run without artifacts returns 404 available=false',
  async () => {
    const { response, body } = await jsonRequest(
      `/api/v1/runs/${LEGACY_RUN_ID}/review-triage`
    );
    assert.equal(response.status, 404);
    assert.deepEqual(body, {
      run_id: LEGACY_RUN_ID,
      available: false,
      error: 'review_triage_not_available',
    });
  });

test('GET review-triage for an unknown run returns 404 without recalculation',
  async () => {
    const unknownId = '44444444-5555-4555-8555-444444444444';
    const { response, body } = await jsonRequest(
      `/api/v1/runs/${unknownId}/review-triage`
    );
    assert.equal(response.status, 404);
    assert.equal(body.available, false);
    assert.equal(body.error, 'review_triage_not_available');
  });

test('broken or missing owner-review session registry fails safe', () => {
  const missingPath = path.join(temporaryRoot, 'no-sessions.json');
  const service = createReviewTriageService({
    sessionsPath: missingPath,
    logger: { warn() {}, error() {} },
  });
  assert.deepEqual(service.loadOwnerReviewSessions(), []);

  const brokenPath = path.join(temporaryRoot, 'broken-sessions.json');
  fs.writeFileSync(brokenPath, '{ damaged', 'utf8');
  const brokenService = createReviewTriageService({
    sessionsPath: brokenPath,
    logger: { warn() {}, error() {} },
  });
  assert.deepEqual(brokenService.loadOwnerReviewSessions(), []);

  const controlArtifact = path.join(temporaryRoot, 'control.json');
  fs.writeFileSync(controlArtifact, '{}\n', 'utf8');
  const registryPath = path.join(temporaryRoot, 'sessions.json');
  fs.writeFileSync(registryPath, JSON.stringify({
    sessions: [
      { session_id: 'no-artifact' },
      {
        session_id: 'missing-file',
        control_artifact_path: path.join(
          temporaryRoot,
          'does-not-exist.json'
        ),
      },
      {
        session_id: 'verified',
        control_artifact_path: controlArtifact,
        verified_at: GENERATED_AT,
        verified_by: 'test',
      },
    ],
  }), 'utf8');
  const registryService = createReviewTriageService({
    sessionsPath: registryPath,
    logger: { warn() {}, error() {} },
  });
  assert.deepEqual(registryService.loadOwnerReviewSessions(), [{
    session_id: 'verified',
    verified_at: GENERATED_AT,
    verified_by: 'test',
    control_artifact_path: controlArtifact,
  }]);
});

test('missing canonical matrix loads as null without throwing', () => {
  const service = createReviewTriageService({
    matrixPath: path.join(temporaryRoot, 'missing-matrix.json'),
    sessionsPath: path.join(temporaryRoot, 'missing-sessions.json'),
    logger: { warn() {}, error() {} },
  });
  assert.equal(service.loadCanonicalMatrix(), null);
});

test('adapter returns triage and compaction without an artifact store', () => {
  const synthetic = syntheticBundle();
  const service = createReviewTriageService({
    matrixPath: path.join(temporaryRoot, 'missing-matrix.json'),
    sessionsPath: path.join(temporaryRoot, 'missing-sessions.json'),
    logger: { warn() {}, error() {} },
    now: () => GENERATED_AT,
  });
  const { triage, compaction } = service.buildAndSaveReviewTriage({
    runId: TRIAGE_RUN_ID,
    agentJson: synthetic.agentJson,
    manualReview: synthetic.manualReview,
    ownerReview: synthetic.ownerReview,
    generatedAt: GENERATED_AT,
  });
  assert.equal(triage.calculation_version, 'synthetic-version-1');
  assert.equal(triage.owner_review_compaction, compaction);
  assert.equal(compaction.total_owner_decision_count, 1);
});
