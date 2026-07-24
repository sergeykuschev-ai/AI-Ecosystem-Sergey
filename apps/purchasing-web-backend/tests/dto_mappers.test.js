const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

const {
  runPurchasingWebOrchestrator,
} = require('../application/purchasing_run_orchestrator');
const { mapApiError } = require('../dto/api_error_mapper');
const { mapOwnerReview } = require('../dto/owner_review_mapper');
const {
  mapPurchasingItems,
} = require('../dto/purchasing_item_mapper');
const { mapRunStatus } = require('../dto/run_status_mapper');
const { mapRunSummary } = require('../dto/run_summary_mapper');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const GENERATED_AT = '2026-07-23T00:00:00.000Z';
let bundle;

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
  bundle = await runPurchasingWebOrchestrator(runRequest());
});

test('RunSummaryDTO separates all five monetary amounts', () => {
  const summary = mapRunSummary(bundle);
  assert.deepEqual(Object.keys(summary.amounts).sort(), [
    'analyzer_order_sum',
    'auto_approved_sum',
    'financially_assessed_sum',
    'pending_review_sum',
    'working_maximum_sum',
  ]);
  assert.equal('total_order_sum' in summary, false);
  assert.equal('total_order_sum' in summary.amounts, false);
  Object.values(summary.amounts).forEach(value => {
    assert.ok(value === null || Number.isFinite(value));
  });
});

test('RunSummaryDTO keeps legacy financial amount separate from applied working order', () => {
  const source = structuredClone(bundle);
  const legacyAmount =
    source.agentResult[0].json.financial_assessment
      .proposed_order_amount;
  source.approvedRuleApplications = {
    applied: 1,
    appliedWorkingOrderFinancialAssessment: {
      amountBefore: 89742.05,
      amountAfter: 87280.8,
      skuBefore: 82,
      skuAfter: 81,
      unitsBefore: 476,
      unitsAfter: 421,
      availableAfterOrder: 100000,
      reserveSurplus: 50000,
      maximumSafeOrderAmount: 137280.8,
      financialStatus: 'APPROVED',
      financiallyPermitted: true,
      recalculationStatus: 'COMPLETE',
    },
  };

  const summary = mapRunSummary(source);

  assert.equal(
    summary.amounts.financially_assessed_sum,
    legacyAmount
  );
  assert.deepEqual(summary.applied_working_order_financial, {
    amount_before: 89742.05,
    amount_after: 87280.8,
    sku_before: 82,
    sku_after: 81,
    units_before: 476,
    units_after: 421,
    available_after_order: 100000,
    reserve_surplus: 50000,
    maximum_safe_order_amount: 137280.8,
    financial_status: 'APPROVED',
    financially_permitted: true,
    recalculation_status: 'COMPLETE',
  });
});

test('PurchasingItemDTO preserves unknown numeric values as null', () => {
  const items = mapPurchasingItems(bundle);
  const unknownStock = items.find(item => item.stock.stock_known === false);
  assert.ok(unknownStock);
  assert.equal(unknownStock.stock.free_stock, null);
  assert.equal(unknownStock.sales.last_28_days, null);
  assert.equal(unknownStock.quantities.approved_quantity, null);
  assert.equal(unknownStock.amounts.approved_line_value, null);
});

test('PurchasingItemDTO exposes the existing 28-day sales metric', () => {
  const modifiedBundle = structuredClone(bundle);
  const source =
    modifiedBundle.agentResult[0].json.workingOrderProducts[0];
  source.sales28 = 12;
  const [item] = mapPurchasingItems(modifiedBundle);
  assert.equal(item.sales.last_28_days, 12);
});

test('all SKU are mapped without loss', () => {
  const items = mapPurchasingItems(bundle);
  const sourceCount = bundle.agentResult[0].json.product_rows_count;
  assert.equal(items.length, sourceCount);
  assert.equal(new Set(items.map(item => item.row_id)).size, sourceCount);
  assert.ok(items.every(item => typeof item.row_id === 'string'));
});

test('browser DTO remove absolute paths and unsafe error internals', () => {
  const status = mapRunStatus({
    runId: RUN_ID,
    status: 'processing',
    stage: 'purchasing',
    createdAt: GENERATED_AT,
    startedAt: GENERATED_AT,
    source: {
      original_name: '/Users/private/reports/SmartZapas.xlsx',
      size_bytes: 100,
      sha256: 'abc',
    },
  });
  assert.equal(status.source.original_name, 'SmartZapas.xlsx');
  assert.equal(JSON.stringify(status).includes('/Users/private'), false);

  const internal = new Error('/Users/private/secret.xlsx failed');
  internal.cause = new Error('secret');
  const apiError = mapApiError(internal, {
    requestId: 'request-1',
    runId: RUN_ID,
  });
  assert.equal(apiError.code, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(apiError).includes('/Users/private'), false);
  assert.equal('stack' in apiError, false);
  assert.equal('cause' in apiError, false);
});

test('DTO mappers do not mutate domain bundle', () => {
  const snapshot = structuredClone(bundle);
  mapRunSummary(bundle);
  mapPurchasingItems(bundle);
  mapOwnerReview(bundle);
  assert.deepEqual(bundle, snapshot);
});
