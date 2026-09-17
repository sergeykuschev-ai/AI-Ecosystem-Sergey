const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const {
  runPurchasingWebOrchestrator,
} = require('../application/purchasing_run_orchestrator');
const {
  RunQueryService,
  compareItems,
} = require('../application/run_query_service');
const {
  FileArtifactStore,
} = require('../storage/file_artifact_store');
const {
  FileRunRegistry,
} = require('../storage/file_run_registry');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const RUN_ID = '55555555-5555-4555-8555-555555555555';
const GENERATED_AT = '2026-07-23T00:00:00.000Z';
let runsRoot;
let registry;
let service;

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

before(async () => {
  runsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'purchasing-query-'));
  const artifactStore = new FileArtifactStore({ runsRoot });
  registry = new FileRunRegistry({ runsRoot, artifactStore });
  registry.createProcessingRun({
    runId: RUN_ID,
    createdAt: GENERATED_AT,
    source: {
      original_name: 'SmartZapas_synthetic.xlsx',
      size_bytes: 100,
      sha256: 'input-sha',
    },
  });
  const bundle = await runPurchasingWebOrchestrator(runRequest());
  registry.saveCompletedRun(bundle, { completedAt: GENERATED_AT });
  service = new RunQueryService(registry);
});

after(() => {
  fs.rmSync(runsRoot, { recursive: true, force: true });
});

test('status, summary, and artifact manifest are queryable', () => {
  assert.equal(service.getRunStatus(RUN_ID).status, 'completed');
  assert.equal(service.getRunSummary(RUN_ID).sku_count, 6);
  const artifacts = service.listArtifacts(RUN_ID);
  assert.equal(artifacts.length, 18);
  assert.ok(artifacts.every(item =>
    item.download_url.startsWith(`/api/v1/runs/${RUN_ID}/artifacts/`)
  ));
  assert.equal(JSON.stringify(artifacts).includes(runsRoot), false);
});

test('item pagination is applied after filtering', () => {
  const all = service.listItems(RUN_ID, { page_size: 100 });
  const selectedDecision = all.items[0].decision;
  const matchingCount = all.items.filter(
    item => item.decision === selectedDecision
  ).length;
  const page = service.listItems(RUN_ID, {
    decision: selectedDecision,
    page: 1,
    page_size: 1,
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.pagination.total_items, matchingCount);
  assert.equal(page.pagination.page_size, 1);
});

test('all supported filters use compact DTO fields', () => {
  const all = service.listItems(RUN_ID, { page_size: 100 });
  const sample = all.items[0];
  const cases = [
    ['q', sample.sku || sample.name],
    ['decision', sample.decision],
    ['workflow_status', sample.workflow_status],
    ['matrix_role', sample.matrix.role],
    ['confidence', sample.confidence],
    ['owner_review', String(sample.matrix.owner_review_required)],
  ];
  cases.forEach(([name, value]) => {
    const result = service.listItems(RUN_ID, {
      [name]: value,
      page_size: 100,
    });
    assert.ok(result.items.length > 0, name);
  });

  const positive = service.listItems(RUN_ID, {
    positive_order: 'true',
    page_size: 100,
  });
  assert.ok(positive.items.every(item =>
    (item.quantities.approved_quantity ?? 0) > 0 ||
    (item.quantities.provisional_quantity ?? 0) > 0
  ));
});

test('item search includes supplier and extended sorts are stable', () => {
  const all = service.listItems(RUN_ID, { page_size: 100 });
  const supplierItem = all.items.find(item => item.supplier);
  assert.ok(supplierItem);
  const supplierSearch = service.listItems(RUN_ID, {
    q: supplierItem.supplier,
    page_size: 100,
  });
  assert.ok(supplierSearch.items.some(
    item => item.row_id === supplierItem.row_id
  ));

  for (const sort of [
    'recommended_quantity',
    'recommended_line_value',
    'free_stock',
    'sales_28_days',
  ]) {
    const first = service.listItems(RUN_ID, {
      sort,
      order: 'desc',
      page_size: 100,
    }).items;
    const second = service.listItems(RUN_ID, {
      sort,
      order: 'desc',
      page_size: 100,
    }).items;
    assert.deepEqual(first, second, sort);
  }
});

test('default sorting is source_row asc and then row_id asc', () => {
  const first = service.listItems(RUN_ID, { page_size: 100 }).items;
  const second = service.listItems(RUN_ID, { page_size: 100 }).items;
  assert.deepEqual(first, second);
  for (let index = 1; index < first.length; index += 1) {
    assert.ok(compareItems(first[index - 1], first[index]) <= 0);
  }

  const tied = [
    { row_id: 'b', source_row: 1 },
    { row_id: 'a', source_row: 1 },
  ].sort(compareItems);
  assert.deepEqual(tied.map(item => item.row_id), ['a', 'b']);
});

test('invalid pagination and boolean filters are rejected', () => {
  assert.throws(
    () => service.listItems(RUN_ID, { page_size: 101 }),
    error => error.code === 'INVALID_QUERY'
  );
  assert.throws(
    () => service.listItems(RUN_ID, { owner_review: 'maybe' }),
    error => error.code === 'INVALID_QUERY'
  );
});

test('Owner Review sections support pagination', () => {
  const result = service.getOwnerReview(RUN_ID, {
    section: 'top_priority',
    page: 1,
    page_size: 2,
  });
  assert.equal(result.run_id, RUN_ID);
  assert.equal(result.section, 'top_priority');
  assert.equal(result.section_items.length, 2);
  assert.equal(
    result.pagination.total_items,
    result.summary.owner_action_displayed
  );
});


test('review triage is authoritative for the owner-decision queue when available', () => {
  const fakeRegistry = {
    getItems() {
      return [
        {
          row_id: 'active',
          matrix: { owner_review_required: true, owner_action_class: 'OWNER_ACTION_REQUIRED' },
          owner_decision: { decision: null },
        },
        {
          row_id: 'blocked',
          matrix: { owner_review_required: true, owner_action_class: 'OWNER_ACTION_REQUIRED' },
          owner_decision: { decision: null },
        },
        {
          row_id: 'legacy-no-longer-active',
          matrix: { owner_review_required: true, owner_action_class: 'OWNER_ACTION_REQUIRED' },
          owner_decision: { decision: null },
        },
      ];
    },
    getReviewTriageArtifacts() {
      return {
        triage: {
          items: [
            {
              row_identity: 'active',
              requires_owner_decision: true,
              owner_decision_status: 'ACTIVE',
              owner_decision_blocker: null,
              reason_code: 'OWNER_DECISION_REQUIRED',
              section: 'owner_decisions',
            },
            {
              row_identity: 'blocked',
              requires_owner_decision: true,
              owner_decision_status: 'BLOCKED_BY_DATA',
              owner_decision_blocker: 'data_or_linkage',
              reason_code: 'SUPPLIER_DATA_MISSING',
              section: 'owner_decisions',
            },
          ],
          owner_review_compaction: {
            business_sku_count: 1,
            total_owner_decision_count: 1,
            blocked_by_data_count: 1,
            data_or_linkage_count: 2,
          },
        },
      };
    },
  };
  const triageService = new RunQueryService(fakeRegistry);
  const decorated = triageService.getDecoratedItems('run');
  const active = decorated.find(item => item.row_id === 'active');
  const blocked = decorated.find(item => item.row_id === 'blocked');
  const resolved = decorated.find(item => item.row_id === 'legacy-no-longer-active');
  assert.equal(active.matrix.owner_review_required, true);
  assert.equal(active.matrix.owner_action_class, 'OWNER_ACTION_REQUIRED');
  assert.equal(blocked.matrix.owner_review_required, false);
  assert.equal(blocked.matrix.owner_action_class, 'DATA_BLOCKED');
  assert.equal(blocked.matrix.data_blocked, true);
  assert.equal(resolved.matrix.owner_review_required, false);
  assert.equal(resolved.matrix.owner_action_class, 'TRIAGE_RESOLVED');
});

test('run summary exposes triage queue separately from the legacy counter', () => {
  const fakeRegistry = {
    getRunStatus() { return { status: 'completed' }; },
    getRunSummary() {
      return { owner_review: { action_required: 168, warnings: 10 } };
    },
    getReviewTriageArtifacts() {
      return { triage: {
        items: [],
        owner_review_compaction: {
          business_sku_count: 3,
          total_owner_decision_count: 2,
          blocked_by_data_count: 41,
          data_or_linkage_count: 93,
        },
      } };
    },
  };
  const triageService = new RunQueryService(fakeRegistry);
  const summary = triageService.getRunSummary('run');
  assert.equal(summary.owner_review.action_required, 3);
  assert.equal(summary.owner_review.decision_count, 2);
  assert.equal(summary.owner_review.data_blocked, 41);
  assert.equal(summary.owner_review.data_issues, 93);
  assert.equal(summary.owner_review.legacy_action_required, 168);
  assert.equal(summary.owner_review.triage_authoritative, true);
});
