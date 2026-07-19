const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const salesFixture = require('../../../tests/fixtures/purchasing_sales_sanitized.json');
const assortmentFixture = require('../../../tests/fixtures/purchasing_assortment_sanitized.json');
const inTransitFixture = require('../../../tests/fixtures/purchasing_in_transit_sanitized.json');
const {
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
  const result = runOrderAgentFromAdapterResultWithDemand(adapterResult, {});
  const json = result[0].json;
  const report = buildDemandReport({ agentJson: json, sourceName: 'synthetic.xlsx' });

  assert.equal(json.product_rows_count, 6);
  assert.equal(json.preliminary_order_sum, 91);
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
    '## Missing input datasets',
    '## Automatically approved order',
    '## Mandatory assortment gaps',
    '## Manual review queue',
    '## Postponed products',
    '## Provisional no-action products',
    '## Quantity comparison',
    '## Coverage',
  ]) {
    assert.ok(report.includes(heading));
  }
});
