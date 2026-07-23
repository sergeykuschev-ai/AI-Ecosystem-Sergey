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
  assert.equal(artifacts.length, 10);
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
