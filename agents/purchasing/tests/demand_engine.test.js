const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const salesFixture = require('../../../tests/fixtures/purchasing_sales_sanitized.json');
const assortmentFixture = require('../../../tests/fixtures/purchasing_assortment_sanitized.json');
const inTransitFixture = require('../../../tests/fixtures/purchasing_in_transit_sanitized.json');
const {
  calculateSmartZapasWeeklySalesRate,
  calculateWeightedSalesRate,
  buildDemandPlan,
} = require('../services/demand_engine');
const {
  buildPhase2PurchasingDecisions,
} = require('../services/decision_engine');
const { buildDemandReport } = require('../services/demand_report');
const {
  matchProductInputs,
} = require('../services/product_input_matcher');
const {
  readSmartZapasExport,
} = require('../adapters/smartzapas_adapter');
const {
  runOrderAgentFromAdapterResult,
  runOrderAgentFromAdapterResultWithDemand,
} = require('../order_agent');

function product(overrides = {}) {
  const value = (field, fallback) =>
    Object.hasOwn(overrides, field) ? overrides[field] : fallback;
  const rowNumber = overrides.rowNumber || 4;
  const supplier = value('supplier', 'Synthetic Supplier');
  const article = value('article', 'SYNTH-A-001');
  const name = value('name', 'Synthetic product one 100 g');
  const barcode = value('barcode', 'SYNTH-BC-001');
  const internalProductId = value('internalProductId', null);

  return {
    rowIdentity: overrides.rowIdentity || `synthetic:row:${rowNumber}`,
    rowNumber,
    name,
    article,
    supplier,
    abc: value('abc', 'B'),
    xyz: value('xyz', 'X'),
    freeStock: value('freeStock', 0),
    inTransit: value('inTransit', null),
    orderQty: value('orderQty', 2),
    priceNum: value('priceNum', 10),
    reportedSalesQuantity: value('reportedSalesQuantity', null),
    reportedSalesPeriodDays: value('reportedSalesPeriodDays', null),
    reportedDailySalesRate: value('reportedDailySalesRate', null),
    reportedSalesRateSource: value('reportedSalesRateSource', null),
    reportedSalesRateConfidence: value('reportedSalesRateConfidence', null),
    reportedSalesWarnings: value('reportedSalesWarnings', []),
    sales7: value('weeklySales7', null),
    sales14: value('weeklySales14', null),
    sales28: value('weeklySales28', null),
    weeklySalesHistory: value('weeklySalesHistory', []),
    weeklyPeriodsUsed: value('weeklyPeriodsUsed', {
      sales7: [],
      sales14: [],
      sales28: [],
    }),
    excludedPartialWeek: value('excludedPartialWeek', null),
    salesPeriodSource: value('salesPeriodSource', null),
    salesPeriodConfidence: value('salesPeriodConfidence', null),
    sourceTokens: {
      reportedSalesQuantity: value('originalSmartZapasSalesValue', null),
      reportedSalesVelocity: value('originalSmartZapasVelocityValue', null),
    },
    matchingHints: {
      barcode,
      internalProductId,
      supplier,
      article,
      normalizedName: name.toLowerCase(),
      packageAttributes: {},
    },
  };
}

function source(version, products) {
  return { version, products };
}

function exactInputs(row, overrides = {}) {
  const match = {
    matchType: 'barcode',
    matchKey: row.matchingHints.barcode,
  };
  return {
    supplierDeliveryCycleDays: {
      'synthetic supplier': 14,
    },
    salesData: source('sales-test-v1', [{
      ...match,
      sales7: 7,
      sales14: 14,
      sales30: 30,
      ...overrides.sales,
    }]),
    assortmentMatrix: source('assortment-test-v1', [{
      ...match,
      mandatory: false,
      minDisplayStock: 0,
      assortmentPriority: 'normal',
      strategicSku: false,
      strategicBrand: false,
      ...overrides.assortment,
    }]),
    inTransitData: source('transit-test-v1', [{
      ...match,
      inTransitQuantity: 0,
      ...overrides.inTransit,
    }]),
  };
}

function demandFor(row, overrides = {}) {
  return buildDemandPlan(
    { productRows: [row] },
    exactInputs(row, overrides)
  );
}

test('calculates weighted 7/14/30 daily sales rate', () => {
  const metrics = calculateWeightedSalesRate({
    sales7: 14,
    sales14: 14,
    sales30: 30,
  });

  assert.equal(metrics.dailyRates.sales7, 2);
  assert.equal(metrics.dailyRates.sales14, 1);
  assert.equal(metrics.dailyRates.sales30, 1);
  assert.equal(metrics.salesDailyRate, 1.5);
});

test('renormalizes weights when a sales period is missing', () => {
  const metrics = calculateWeightedSalesRate({
    sales7: null,
    sales14: 28,
    sales30: 30,
  });

  assert.equal(metrics.salesDailyRate, 1.6);
  assert.deepEqual(metrics.missingFields, ['sales7']);
});

test('distinguishes all missing sales from confirmed zero sales', () => {
  const missing = calculateWeightedSalesRate({
    sales7: null,
    sales14: null,
    sales30: null,
  });
  const zero = calculateWeightedSalesRate({ sales7: 0, sales14: 0, sales30: 0 });

  assert.equal(missing.salesDailyRate, null);
  assert.equal(missing.allMissing, true);
  assert.equal(zero.salesDailyRate, 0);
  assert.equal(zero.allConfirmedZero, true);
});

test('calculates weighted SmartZapas 7/14/28 daily sales rate', () => {
  const metrics = calculateSmartZapasWeeklySalesRate({
    sales7: 14,
    sales14: 14,
    sales28: 28,
  });

  assert.equal(metrics.dailyRates.sales7, 2);
  assert.equal(metrics.dailyRates.sales14, 1);
  assert.equal(metrics.dailyRates.sales28, 1);
  assert.equal(metrics.salesDailyRate, 1.5);
});

test('renormalizes SmartZapas weekly weights when one rolling period is missing', () => {
  const metrics = calculateSmartZapasWeeklySalesRate({
    sales7: 14,
    sales14: null,
    sales28: 28,
  });

  assert.equal(metrics.salesDailyRate, 1.714286);
  assert.deepEqual(metrics.missingFields, ['sales14']);
});

test('auto prefers SmartZapas weekly history over external and cumulative sales', () => {
  const row = product({
    weeklySales7: 7,
    weeklySales14: 14,
    weeklySales28: 28,
    weeklySalesHistory: [{ periodStart: '2026-07-13', quantity: 7 }],
    weeklyPeriodsUsed: {
      sales7: ['2026-07-13'],
      sales14: ['2026-07-06', '2026-07-13'],
      sales28: ['2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13'],
    },
    salesPeriodSource: 'smartzapas_weekly_history',
    salesPeriodConfidence: 'high',
    reportedDailySalesRate: 0.5,
    reportedSalesRateSource: 'smartzapas_period_sales_explicit_days',
    reportedSalesRateConfidence: 'high',
  });
  const demand = demandFor(row, {
    sales: { sales7: 70, sales14: 140, sales30: 300 },
  }).products[0];

  assert.equal(demand.salesDailyRate, 1);
  assert.equal(demand.salesRateSource, 'smartzapas_weekly_weighted');
  assert.equal(demand.sales28, 28);
  assert.deepEqual(demand.weeklyPeriodsUsed.sales7, ['2026-07-13']);
});

test('auto sales input prefers weighted period sales over reported rate', () => {
  const row = product({
    reportedDailySalesRate: 9,
    reportedSalesRateConfidence: 'high',
  });
  const demand = demandFor(row).products[0];

  assert.equal(demand.salesDailyRate, 1);
  assert.equal(demand.salesRateSource, 'external_period_sales_weighted');
});

test('auto sales input falls back to SmartZapas cumulative period rate', () => {
  const row = product({
    reportedDailySalesRate: 0.5,
    reportedSalesRateSource: 'smartzapas_period_sales_explicit_days',
    reportedSalesRateConfidence: 'high',
    originalSmartZapasSalesValue: 94.5,
    originalSmartZapasVelocityValue: 15.2,
  });
  const inputs = exactInputs(row);
  delete inputs.salesData;
  const demand = buildDemandPlan({ productRows: [row] }, inputs).products[0];

  assert.equal(demand.salesDailyRate, 0.5);
  assert.equal(demand.salesRateSource, 'smartzapas_cumulative_period');
  assert.equal(demand.salesRateConfidence, 'high');
  assert.equal(demand.originalSmartZapasSalesValue, 94.5);
  assert.equal(demand.originalSmartZapasVelocityValue, 15.2);
});

test('period_sales mode ignores reported SmartZapas rate', () => {
  const row = product({
    reportedDailySalesRate: 0.5,
    reportedSalesRateConfidence: 'high',
  });
  const inputs = exactInputs(row);
  delete inputs.salesData;
  inputs.salesInputMode = 'period_sales';
  const demand = buildDemandPlan({ productRows: [row] }, inputs).products[0];

  assert.equal(demand.salesDailyRate, null);
  assert.equal(demand.salesRateSource, null);
});

test('reported_daily_rate mode ignores weighted period sales', () => {
  const row = product({
    reportedDailySalesRate: 0.5,
    reportedSalesRateSource: 'smartzapas_confirmed_daily_rate',
    reportedSalesRateConfidence: 'high',
  });
  const inputs = exactInputs(row);
  inputs.salesInputMode = 'reported_daily_rate';
  const demand = buildDemandPlan({ productRows: [row] }, inputs).products[0];

  assert.equal(demand.salesDailyRate, 0.5);
  assert.equal(demand.salesRateSource, 'smartzapas_reported_daily_rate');
});

test('ambiguous reported rate unit blocks automatic approval', () => {
  const row = product({
    abc: 'A',
    xyz: 'X',
    reportedDailySalesRate: 0.5,
    reportedSalesRateConfidence: 'low',
  });
  const inputs = exactInputs(row);
  delete inputs.salesData;
  const result = buildDemandPlan({ productRows: [row] }, inputs);
  const decision = buildPhase2PurchasingDecisions(result).decisions[0];

  assert.equal(result.products[0].finalRecommendedQuantity, 18);
  assert.ok(result.products[0].warnings.includes('ambiguous_reported_sales_rate_unit'));
  assert.equal(decision.decision, 'manual_review');
  assert.equal(decision.confidence, 'low');
  assert.equal(decision.decisionBasis, 'phase2_data_quality_review');
});

test('invalid reported daily rates are rejected', () => {
  const row = product({
    reportedDailySalesRate: -0.5,
    reportedSalesRateConfidence: 'high',
  });
  const inputs = exactInputs(row);
  inputs.salesInputMode = 'reported_daily_rate';
  const demand = buildDemandPlan({ productRows: [row] }, inputs).products[0];

  assert.equal(demand.salesDailyRate, null);
  assert.equal(demand.salesRateSource, null);
  assert.ok(demand.warnings.includes('invalid_reported_daily_sales_rate'));
  assert.ok(demand.requiredData.includes('reported_daily_sales_rate'));
});

test('rejects negative sales as invalid source data', () => {
  const metrics = calculateWeightedSalesRate({ sales7: -1, sales14: 14, sales30: 30 });

  assert.equal(metrics.salesDailyRate, null);
  assert.deepEqual(metrics.invalidFields, ['sales7']);
});

test('known zero stock participates in deterministic demand calculation', () => {
  const row = product({ freeStock: 0, orderQty: 2 });
  const result = demandFor(row);
  const demand = result.products[0];

  assert.equal(demand.stockStatus, 'confirmed_zero');
  assert.equal(demand.targetCoverageDays, 28);
  assert.equal(demand.targetStock, 28);
  assert.equal(demand.demandCalculatedQuantity, 28);
  assert.equal(demand.finalRecommendedQuantity, 28);
});

test('unknown stock prevents final quantity and automatic approval', () => {
  const row = product({ freeStock: null });
  const demand = demandFor(row);
  const decision = buildPhase2PurchasingDecisions(demand).decisions[0];

  assert.equal(demand.products[0].stockStatus, 'unknown');
  assert.equal(demand.products[0].finalRecommendedQuantity, null);
  assert.ok(demand.products[0].requiredData.includes('free_stock'));
  assert.equal(decision.decision, 'manual_review');
  assert.equal(decision.approvedOrderQuantity, null);
});

test('confirmed in-transit stock is subtracted from demand', () => {
  const row = product({ freeStock: 2, orderQty: 1 });
  const withoutTransit = demandFor(row).products[0];
  const withTransit = demandFor(row, {
    inTransit: { inTransitQuantity: 5 },
  }).products[0];

  assert.equal(withoutTransit.demandCalculatedQuantity, 26);
  assert.equal(withTransit.availableStock, 7);
  assert.equal(withTransit.demandCalculatedQuantity, 21);
});

test('mandatory minimum display stock creates a quantity floor', () => {
  const row = product({ freeStock: 0, orderQty: 1 });
  const demand = demandFor(row, {
    sales: { sales7: 0, sales14: 0, sales30: 0 },
    assortment: {
      mandatory: true,
      minDisplayStock: 8,
      assortmentPriority: 'critical',
    },
  }).products[0];

  assert.equal(demand.demandCalculatedQuantity, 0);
  assert.equal(demand.mandatoryMinimumGap, 8);
  assert.equal(demand.finalRecommendedQuantity, 8);
});

test('mandatory assortment never overrides unknown stock', () => {
  const row = product({ freeStock: null });
  const demandResult = demandFor(row, {
    assortment: {
      mandatory: true,
      minDisplayStock: 8,
      assortmentPriority: 'critical',
    },
  });
  const decision = buildPhase2PurchasingDecisions(demandResult).decisions[0];

  assert.equal(demandResult.products[0].mandatoryMinimumGap, null);
  assert.equal(demandResult.products[0].finalRecommendedQuantity, null);
  assert.equal(decision.decision, 'manual_review');
});

test('optional assortment matrix absence does not block demand calculation', () => {
  const row = product({ freeStock: 0, orderQty: 2 });
  const inputs = exactInputs(row);
  delete inputs.assortmentMatrix;
  const result = buildDemandPlan({ productRows: [row] }, inputs);
  const demand = result.products[0];

  assert.equal(result.inputStatus.assortmentMatrixStatus, 'not_provided');
  assert.equal(demand.mandatoryAssortment, null);
  assert.equal(demand.mandatoryMinimumGap, 0);
  assert.equal(demand.demandCalculatedQuantity, 28);
  assert.equal(demand.finalRecommendedQuantity, 28);
  assert.ok(!demand.requiredData.includes('assortment_matrix'));
});

test('required assortment matrix absence blocks final quantity and approval', () => {
  const row = product({ freeStock: 0, orderQty: 2 });
  const inputs = exactInputs(row);
  delete inputs.assortmentMatrix;
  inputs.assortmentMatrixMode = 'required';
  const result = buildDemandPlan({ productRows: [row] }, inputs);
  const decision = buildPhase2PurchasingDecisions(result).decisions[0];

  assert.equal(result.inputStatus.assortmentMatrixStatus, 'required_not_provided');
  assert.equal(result.products[0].mandatoryMinimumGap, null);
  assert.equal(result.products[0].finalRecommendedQuantity, null);
  assert.equal(decision.decision, 'manual_review');
  assert.equal(decision.approvedOrderQuantity, null);
});

test('disabled assortment mode ignores supplied mandatory rules', () => {
  const row = product({ freeStock: 0, orderQty: 2 });
  const inputs = exactInputs(row, {
    assortment: {
      mandatory: true,
      minDisplayStock: 100,
      assortmentPriority: 'critical',
    },
  });
  inputs.assortmentMatrixMode = 'disabled';
  const result = buildDemandPlan({ productRows: [row] }, inputs);

  assert.equal(result.inputStatus.assortmentMatrixStatus, 'disabled');
  assert.equal(result.products[0].mandatoryAssortment, null);
  assert.equal(result.products[0].mandatoryMinimumGap, 0);
  assert.equal(result.products[0].finalRecommendedQuantity, 28);
  assert.equal(result.diagnostics.assortmentMatches.length, 0);
});

test('distinguishes missing in-transit source from confirmed zero and unknown quantity', () => {
  const row = product({ freeStock: 0 });
  const missingInputs = exactInputs(row);
  delete missingInputs.inTransitData;
  const missing = buildDemandPlan({ productRows: [row] }, missingInputs).products[0];
  const confirmedZero = demandFor(row).products[0];
  const unknownInputs = exactInputs(row);
  unknownInputs.inTransitData = source('transit-test-v1', []);
  const unknown = buildDemandPlan({ productRows: [row] }, unknownInputs).products[0];

  assert.equal(missing.inTransitStatus, 'source_not_provided');
  assert.equal(missing.inTransitQuantity, null);
  assert.equal(confirmedZero.inTransitStatus, 'confirmed_zero');
  assert.equal(confirmedZero.inTransitQuantity, 0);
  assert.equal(unknown.inTransitStatus, 'quantity_unknown');
  assert.equal(unknown.inTransitQuantity, null);
});

test('Miska included-in-source-stock mode calculates without an external transit source', () => {
  const row = product({ freeStock: 2, orderQty: 1 });
  const inputs = exactInputs(row);
  delete inputs.inTransitData;
  delete inputs.assortmentMatrix;
  inputs.purchasingProfile = 'miska';
  const result = buildDemandPlan({ productRows: [row] }, inputs);
  const demand = result.products[0];
  const decision = buildPhase2PurchasingDecisions(result).decisions[0];

  assert.equal(result.inputStatus.purchasingProfile, 'miska');
  assert.equal(result.inputStatus.inTransitMode, 'included_in_source_stock');
  assert.equal(result.inputStatus.inTransitSourceStatus, 'included_in_source_stock');
  assert.equal(
    result.inputStatus.inTransitDecisionBasis,
    'previous_order_registered_as_expected_receipt'
  );
  assert.equal(result.inputStatus.sourceStockIncludesExpectedReceipts, 'assumed');
  assert.equal(result.inputStatus.phase2ResultStatus, 'preliminary');
  assert.equal(demand.inTransitQuantity, 0);
  assert.equal(demand.inTransitStatus, 'included_in_source_stock');
  assert.equal(demand.availableStock, 2);
  assert.equal(demand.demandCalculatedQuantity, 26);
  assert.equal(demand.finalRecommendedQuantity, 26);
  assert.ok(!demand.requiredData.includes('in_transit_quantity'));
  assert.equal(decision.decision, 'recommended');
  assert.deepEqual(result.reportWarnings, [
    'Verify that SmartZapas free stock or analyzer recommendation reflects expected receipts',
  ]);
  assert.ok(!result.missingInputDatasets.some(dataset =>
    dataset.dataset === 'in_transit_data'
  ));
});

test('Miska included-in-source-stock mode ignores supplied invoice data', () => {
  const row = product({ freeStock: 2, orderQty: 1 });
  const inputs = exactInputs(row, {
    inTransit: { inTransitQuantity: 100 },
  });
  inputs.purchasingProfile = 'miska';
  const result = buildDemandPlan({ productRows: [row] }, inputs);
  const demand = result.products[0];

  assert.equal(demand.inTransitQuantity, 0);
  assert.equal(demand.availableStock, 2);
  assert.equal(demand.demandCalculatedQuantity, 26);
  assert.equal(result.diagnostics.inTransitMatches.length, 0);
  assert.equal(result.diagnostics.suppliedInTransitDataIgnored, true);
});

test('required in-transit mode still blocks without transit data', () => {
  const row = product({ freeStock: 2, orderQty: 1 });
  const inputs = exactInputs(row);
  delete inputs.inTransitData;
  inputs.purchasingProfile = 'miska';
  inputs.inTransitMode = 'required';
  const result = buildDemandPlan({ productRows: [row] }, inputs);
  const decision = buildPhase2PurchasingDecisions(result).decisions[0];

  assert.equal(result.inputStatus.purchasingProfile, 'miska');
  assert.equal(result.inputStatus.inTransitMode, 'required');
  assert.equal(result.products[0].inTransitQuantity, null);
  assert.equal(result.products[0].finalRecommendedQuantity, null);
  assert.equal(decision.decision, 'manual_review');
  assert.ok(result.missingInputDatasets.some(dataset =>
    dataset.dataset === 'in_transit_data' && dataset.blocking === true
  ));
});

test('unknown purchasing profiles use the safe generic required transit mode', () => {
  const row = product({ freeStock: 2, orderQty: 1 });
  const inputs = exactInputs(row);
  delete inputs.inTransitData;
  inputs.purchasingProfile = 'unknown-profile';
  const result = buildDemandPlan({ productRows: [row] }, inputs);

  assert.equal(result.inputStatus.purchasingProfile, 'generic');
  assert.equal(result.inputStatus.inTransitMode, 'required');
  assert.equal(result.products[0].finalRecommendedQuantity, null);
});

test('optional in-transit mode calculates with one report-level warning', () => {
  const row = product({ freeStock: 2, orderQty: 1 });
  const inputs = exactInputs(row);
  delete inputs.inTransitData;
  inputs.inTransitMode = 'optional';
  const result = buildDemandPlan({ productRows: [row] }, inputs);
  const demand = result.products[0];

  assert.equal(result.inputStatus.inTransitSourceStatus, 'not_provided_optional');
  assert.equal(demand.inTransitQuantity, 0);
  assert.equal(demand.inTransitStatus, 'source_not_provided');
  assert.equal(demand.availableStock, 2);
  assert.equal(demand.finalRecommendedQuantity, 26);
  assert.deepEqual(result.reportWarnings, [
    'Optional in-transit source was not provided; separate in-transit quantity is assumed zero',
  ]);
  assert.ok(result.missingInputDatasets.some(dataset =>
    dataset.dataset === 'in_transit_data' && dataset.blocking === false
  ));
});

test('disabled in-transit mode ignores supplied quantities', () => {
  const row = product({ freeStock: 2, orderQty: 1 });
  const inputs = exactInputs(row, {
    inTransit: { inTransitQuantity: 100 },
  });
  inputs.inTransitMode = 'disabled';
  const result = buildDemandPlan({ productRows: [row] }, inputs);
  const demand = result.products[0];

  assert.equal(result.inputStatus.inTransitSourceStatus, 'disabled');
  assert.equal(demand.inTransitQuantity, 0);
  assert.equal(demand.availableStock, 2);
  assert.equal(demand.finalRecommendedQuantity, 26);
  assert.equal(result.diagnostics.inTransitMatches.length, 0);
  assert.equal(result.diagnostics.suppliedInTransitDataIgnored, true);
});

test('transit mode does not change SmartZapas weekly sales calculations', () => {
  const row = product({
    freeStock: 2,
    weeklySales7: 7,
    weeklySales14: 14,
    weeklySales28: 28,
    weeklySalesHistory: [{ periodStart: '2026-07-06', quantity: 7 }],
    salesPeriodSource: 'smartzapas_weekly_history',
    salesPeriodConfidence: 'high',
  });
  const requiredInputs = exactInputs(row);
  const miskaInputs = exactInputs(row);
  miskaInputs.purchasingProfile = 'miska';
  const required = buildDemandPlan({ productRows: [row] }, requiredInputs).products[0];
  const miska = buildDemandPlan({ productRows: [row] }, miskaInputs).products[0];

  assert.equal(required.salesDailyRate, 1);
  assert.equal(miska.salesDailyRate, required.salesDailyRate);
  assert.equal(miska.salesRateSource, required.salesRateSource);
  assert.deepEqual(
    [miska.sales7, miska.sales14, miska.sales28],
    [required.sales7, required.sales14, required.sales28]
  );
});

test('analyzer zero with missing Phase 2 datasets is provisional no-action', () => {
  const row = product({ orderQty: 0 });
  const demand = buildDemandPlan({ productRows: [row] }, {});
  const decision = buildPhase2PurchasingDecisions(demand).decisions[0];

  assert.equal(decision.decision, 'do_not_buy');
  assert.equal(decision.approvedOrderQuantity, 0);
  assert.equal(decision.confidence, 'low');
  assert.equal(decision.decisionBasis, 'provisional_phase1_no_order');
  assert.ok(decision.reasons.includes('phase1_no_order'));
  assert.ok(decision.warnings.includes('phase2_data_unavailable'));
});

test('positive analyzer quantity with missing Phase 2 datasets remains manual review', () => {
  const row = product({ orderQty: 2 });
  const demand = buildDemandPlan({ productRows: [row] }, {});
  const decision = buildPhase2PurchasingDecisions(demand).decisions[0];

  assert.equal(decision.decision, 'manual_review');
  assert.equal(decision.approvedOrderQuantity, null);
  assert.equal(decision.decisionBasis, 'phase2_data_incomplete');
});

test('matches supplier plus article only when unique', () => {
  const rows = [
    product({ barcode: null }),
    product({
      rowIdentity: 'synthetic:row:5',
      rowNumber: 5,
      barcode: null,
      article: 'SYNTH-A-002',
    }),
  ];
  const result = matchProductInputs(rows, [{
    matchType: 'supplier_article',
    matchKey: { supplier: 'Synthetic Supplier', article: 'SYNTH-A-002' },
  }]);

  assert.equal(result.recordResults[0].status, 'matched');
  assert.equal(result.recordResults[0].matchedRowIdentities[0], 'synthetic:row:5');
});

test('does not automatically match duplicate supplier articles', () => {
  const rows = [
    product({ barcode: null }),
    product({ rowIdentity: 'synthetic:row:5', rowNumber: 5, barcode: null }),
  ];
  const result = matchProductInputs(rows, [{
    matchType: 'supplier_article',
    matchKey: { supplier: 'Synthetic Supplier', article: 'SYNTH-A-001' },
  }]);

  assert.equal(result.recordResults[0].status, 'ambiguous');
  assert.equal(result.matchesByRowIdentity.size, 0);
});

test('ambiguous assortment match keeps mandatory status unknown and requires review', () => {
  const rows = [
    product({ barcode: null, inTransit: 0 }),
    product({
      rowIdentity: 'synthetic:row:5',
      rowNumber: 5,
      barcode: null,
      inTransit: 0,
      name: 'Synthetic duplicate article product',
    }),
  ];
  const salesData = source('sales-test-v1', rows.map(row => ({
    matchType: 'normalized_name',
    matchKey: { supplier: row.supplier, name: row.name },
    sales7: 7,
    sales14: 14,
    sales30: 30,
  })));
  const assortmentMatrix = source('assortment-test-v1', [{
    matchType: 'supplier_article',
    matchKey: { supplier: 'Synthetic Supplier', article: 'SYNTH-A-001' },
    mandatory: true,
    minDisplayStock: 5,
    assortmentPriority: 'critical',
  }]);
  const result = buildDemandPlan(
    { productRows: rows },
    { salesData, assortmentMatrix }
  );
  const decisions = buildPhase2PurchasingDecisions(result).decisions;

  assert.ok(result.products.every(item => item.mandatoryAssortment === null));
  assert.ok(result.products.every(item => item.finalRecommendedQuantity === null));
  assert.ok(result.products.every(item =>
    item.requiredData.includes('assortment_match_review')
  ));
  assert.ok(decisions.every(item => item.decision === 'manual_review'));
});

test('supports exact normalized-name fallback without fuzzy matching', () => {
  const row = product({ barcode: null, article: null });
  const result = matchProductInputs([row], [{
    matchType: 'normalized_name',
    matchKey: {
      supplier: 'Synthetic Supplier',
      name: 'Synthetic product one 100 g',
    },
  }]);

  assert.equal(result.recordResults[0].status, 'matched');
  assert.equal(result.matchesByRowIdentity.get(row.rowIdentity).method, 'normalized_name');
});

test('flags a short-term sales spike and reviews large quantities', () => {
  const row = product({ freeStock: 0, abc: 'A', xyz: 'X', priceNum: 300 });
  const demandResult = demandFor(row, {
    sales: { sales7: 35, sales14: 28, sales30: 30 },
  });
  const demand = demandResult.products[0];
  const decision = buildPhase2PurchasingDecisions(demandResult).decisions[0];

  assert.equal(demand.salesTrend, 'spike');
  assert.ok(demand.warnings.includes('short_term_sales_spike'));
  assert.ok(demand.finalRecommendedQuantity >= 20);
  assert.equal(decision.decision, 'manual_review');
});

test('flags declining sales and lowers decision confidence', () => {
  const row = product({ freeStock: 0, abc: 'A', xyz: 'X' });
  const consistentResult = demandFor(row, {
    sales: { sales7: 7, sales14: 14, sales30: 30 },
  });
  const decliningResult = demandFor(row, {
    sales: { sales7: 1, sales14: 14, sales30: 60 },
  });
  const consistentDecision = buildPhase2PurchasingDecisions(consistentResult).decisions[0];
  const decliningDecision = buildPhase2PurchasingDecisions(decliningResult).decisions[0];

  assert.ok(decliningResult.products[0].warnings.includes('declining_sales'));
  assert.equal(consistentDecision.confidence, 'high');
  assert.equal(decliningDecision.confidence, 'medium');
});

test('keeps analyzer quantity when it is higher than demand', () => {
  const row = product({ freeStock: 100, orderQty: 12 });
  const demand = demandFor(row).products[0];

  assert.equal(demand.demandCalculatedQuantity, 0);
  assert.equal(demand.finalRecommendedQuantity, 12);
  assert.equal(demand.quantityReason, 'analyzer_maximum');
});

test('uses demand quantity when it is higher than analyzer quantity', () => {
  const row = product({ freeStock: 0, orderQty: 2 });
  const demand = demandFor(row).products[0];

  assert.equal(demand.demandCalculatedQuantity, 28);
  assert.equal(demand.finalRecommendedQuantity, 28);
  assert.equal(demand.quantityReason, 'demand_maximum');
});

test('uses mandatory gap when it is higher than analyzer and demand', () => {
  const row = product({ freeStock: 0, orderQty: 2 });
  const demand = demandFor(row, {
    sales: { sales7: 0, sales14: 0, sales30: 0 },
    assortment: { mandatory: true, minDisplayStock: 15 },
  }).products[0];

  assert.equal(demand.demandCalculatedQuantity, 0);
  assert.equal(demand.mandatoryMinimumGap, 15);
  assert.equal(demand.finalRecommendedQuantity, 15);
  assert.equal(demand.quantityReason, 'mandatory_gap_maximum');
});

test('produces deterministic demand products and final quantities', () => {
  const row = product({ freeStock: 3, orderQty: 4 });
  const inputs = exactInputs(row);
  const first = buildDemandPlan({ productRows: [row] }, inputs);
  const second = buildDemandPlan({ productRows: [structuredClone(row)] }, inputs);

  assert.deepEqual(first, second);
  assert.equal(first.products[0].finalRecommendedQuantity, 25);
});

test('validated sanitized fixtures exercise exact matching and totals', () => {
  const rows = [
    product({ freeStock: 1, abc: 'A', xyz: 'X' }),
    product({
      rowIdentity: 'synthetic:row:5',
      rowNumber: 5,
      barcode: null,
      article: 'SYNTH-A-002',
      name: 'Synthetic product two 200 ml',
      freeStock: 5,
      orderQty: 4,
      priceNum: 20,
    }),
    product({
      rowIdentity: 'synthetic:row:6',
      rowNumber: 6,
      barcode: null,
      article: null,
      name: 'Synthetic product three 100 g',
      abc: 'C',
      xyz: 'X',
      freeStock: 0,
      orderQty: 0,
      priceNum: 30,
    }),
  ];
  const result = buildDemandPlan(
    { productRows: rows },
    {
      supplierDeliveryCycleDays: {
        'synthetic supplier': 14,
      },
      salesData: salesFixture,
      assortmentMatrix: assortmentFixture,
      inTransitData: inTransitFixture,
    }
  );

  assert.equal(result.summary.productsWithSalesData, 3);
  assert.equal(result.summary.productsMissingAllSales, 0);
  assert.equal(result.summary.mandatoryProductsMatched, 2);
  assert.equal(result.summary.mandatoryProductsMissing, 1);
  assert.equal(result.summary.mandatoryZeroStockCount, 1);
  assert.equal(result.summary.demandOrderLines, 2);
  assert.equal(result.summary.demandOrderSum, 1010);
  assert.equal(result.summary.analyzerVsFinalQuantityDelta, 72);
  assert.equal(result.summary.analyzerVsFinalSumDelta, 1000);
  assert.equal(result.products[0].assortmentMatch.method, 'barcode');
  assert.equal(result.products[1].assortmentMatch.method, 'supplier_article');
  assert.equal(result.products[2].assortmentMatch.method, 'normalized_name');
  assert.deepEqual(
    result.products.map(item => item.finalRecommendedQuantity),
    [49, 26, 3]
  );
  assert.ok(result.products.every(item => item.finalRecommendedQuantity !== null));
});

test('Phase 2 entry point preserves analyzer fields and report contract', async () => {
  const fixturePath = path.resolve('tests/fixtures/SmartZapas_synthetic.xlsx');
  const adapterResult = await readSmartZapasExport(fixturePath);
  const phase1Json = runOrderAgentFromAdapterResult(adapterResult)[0].json;
  const result = runOrderAgentFromAdapterResultWithDemand(adapterResult, {});
  const json = result[0].json;
  const report = buildDemandReport({ agentJson: json, sourceName: 'synthetic.xlsx' });

  assert.equal(json.product_rows_count, 6);
  assert.equal(json.preliminary_order_sum, 91);
  assert.equal(json.order_rows_count, phase1Json.order_rows_count);
  assert.equal(json.preliminary_order_sum, phase1Json.preliminary_order_sum);
  assert.deepEqual(
    json.demandProducts.map(product => product.analyzerCalculatedQuantity),
    adapterResult.rows.map(row => row.orderQty)
  );
  assert.equal(json.phase1Decisions.length, 6);
  assert.equal(json.demandProducts.length, 6);
  assert.equal(json.decisions.length, 6);
  assert.equal(json.decisionVersion, 'v2-phase-2');
  assert.equal(json.assortmentMatrixStatus, 'not_provided');
  assert.equal(json.inTransitSourceStatus, 'not_provided');
  assert.equal(json.provisionalNoActionCount, json.demandProducts.filter(
    product => product.analyzerCalculatedQuantity === 0
  ).length);
  assert.equal(json.positiveAnalyzerLinesAwaitingData, json.demandProducts.filter(
    product => product.analyzerCalculatedQuantity > 0
  ).length);
  assert.equal(json.demandOrderLines, null);
  assert.equal(json.finalApprovedLines, null);
  assert.equal(json.finalApprovedSum, null);
  for (const heading of [
    '## Executive summary',
    '## Report-level warnings',
    '## Missing input datasets',
    '## Automatically approved order',
    '## Mandatory assortment gaps',
    '## Requires manual review',
    '## Postponed products',
    '## Provisional no-action products',
    '## Quantity comparison',
    '## Coverage',
  ]) {
    assert.ok(report.includes(heading));
  }
  for (const label of [
    'Sales rate source',
    'Sales rate confidence',
    'Original SmartZapas sales',
    'Original SmartZapas velocity',
    'Products using SmartZapas rate',
    'Products missing usable sales input',
    'Sales 28 days',
    'Weekly periods used',
    'Products with weekly history',
    'Products using weekly weighted rate',
    'Products using cumulative fallback',
    'Products with partial latest week excluded',
    'Products with sales7',
    'Products with sales14',
    'Products with sales28',
    'Blank weekly cells interpreted as zero',
    'Weekly-to-cumulative exact matches',
    'Weekly-to-cumulative mismatches',
    'Excluded partial week',
    'Purchasing profile',
    'In-transit mode',
    'In-transit decision basis',
    'Source stock includes expected receipts',
    'Demand quantities calculated',
    'Final quantities calculated',
    'Automatically approved portion lines',
    'Pending manual-review lines',
    'Pending-review provisional sum',
    'Working maximum lines',
    'Working maximum sum',
  ]) {
    assert.ok(report.includes(label));
  }
});

test('Miska report labels the result preliminary and emits the verification warning once', async () => {
  const fixturePath = path.resolve('tests/fixtures/SmartZapas_synthetic.xlsx');
  const adapterResult = await readSmartZapasExport(fixturePath);
  const json = runOrderAgentFromAdapterResultWithDemand(
    adapterResult,
    { purchasingProfile: 'miska' }
  )[0].json;
  const report = buildDemandReport({ agentJson: json, sourceName: 'synthetic.xlsx' });
  const warning =
    'Verify that SmartZapas free stock or analyzer recommendation reflects expected receipts';

  assert.equal(json.phase2ResultStatus, 'preliminary');
  assert.ok(report.includes('# Purchasing Agent v2 — Phase 2 Demand Report (PRELIMINARY)'));
  assert.ok(report.includes(
    'This Phase 2 result is preliminary until SmartZapas expected-receipt semantics are confirmed.'
  ));
  assert.equal(report.split(warning).length - 1, 1);
});
