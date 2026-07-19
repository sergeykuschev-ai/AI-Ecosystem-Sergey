const assert = require('node:assert/strict');
const { test } = require('node:test');

const { buildWorkingOrder } = require('../services/working_order');
const { buildWorkingOrderReport } = require('../services/working_order_report');

function product(overrides = {}) {
  return {
    rowIdentity: overrides.rowIdentity || 'row:1',
    rowNumber: overrides.rowNumber || 1,
    name: overrides.name || 'Synthetic product',
    article: Object.hasOwn(overrides, 'article') ? overrides.article : 'SYN-1',
    supplier: 'Synthetic Supplier',
    abc: overrides.abc || 'A',
    xyz: overrides.xyz || 'X',
    priceNum: overrides.priceNum ?? 10,
    matchingHints: overrides.matchingHints || {},
    analyzerCalculatedQuantity: overrides.analyzerCalculatedQuantity ?? 2,
    demandCalculatedQuantity: overrides.demandCalculatedQuantity ?? null,
    finalRecommendedQuantity: overrides.finalRecommendedQuantity ?? null,
    freeStock: overrides.freeStock ?? null,
    stockStatus: overrides.freeStock === null || overrides.freeStock === undefined
      ? 'unknown'
      : 'known',
    salesDailyRate: overrides.salesDailyRate ?? 1,
    sales7: overrides.sales7 ?? 7,
    sales14: overrides.sales14 ?? 14,
    sales28: overrides.sales28 ?? 28,
    targetCoverageDays: 35,
    targetStock: overrides.targetStock ?? 35,
    expectedCoverageAfterOrder: null,
    quantityReason: overrides.quantityReason || 'incomplete_critical_data',
  };
}

function decision(rowIdentity, overrides = {}) {
  return {
    rowIdentity,
    decision: overrides.decision || 'manual_review',
    decisionBasis: overrides.decisionBasis || 'phase2_data_incomplete',
    approvedOrderQuantity: Object.hasOwn(overrides, 'approvedOrderQuantity')
      ? overrides.approvedOrderQuantity
      : null,
    reasons: overrides.reasons || ['final_quantity_unavailable'],
    warnings: overrides.warnings || [],
    requiredData: overrides.requiredData || [],
  };
}

test('unknown-stock Phase 1 line remains pending with its analyzer quantity', () => {
  const sourceProduct = product({
    analyzerCalculatedQuantity: 3,
    finalRecommendedQuantity: null,
    freeStock: null,
    priceNum: 20,
  });
  const before = structuredClone(sourceProduct);
  const result = buildWorkingOrder([sourceProduct], [decision(sourceProduct.rowIdentity, {
    requiredData: ['free_stock'],
  })]);
  const line = result.products[0];

  assert.equal(line.workflowStatus, 'pending_manual_review');
  assert.equal(line.provisionalOrderQuantity, 3);
  assert.equal(line.provisionalQuantitySource, 'phase1_analyzer_fallback');
  assert.equal(line.provisionalLineSum, 60);
  assert.equal(line.blockingReason, 'free_stock_unknown');
  assert.equal(line.approvalRequired, true);
  assert.deepEqual(sourceProduct, before);
});

test('sales-spike review line uses the calculated Phase 2 quantity provisionally', () => {
  const sourceProduct = product({
    analyzerCalculatedQuantity: 1,
    finalRecommendedQuantity: 6,
    freeStock: 5,
    priceNum: 100,
  });
  const result = buildWorkingOrder([sourceProduct], [decision(sourceProduct.rowIdentity, {
    decisionBasis: 'phase2_risk_review',
    reasons: ['sales_spike_quantity_requires_review', 'quantity_reason:demand_maximum'],
    warnings: ['short_term_sales_spike'],
  })]);
  const line = result.products[0];

  assert.equal(line.workflowStatus, 'pending_manual_review');
  assert.equal(line.provisionalOrderQuantity, 6);
  assert.equal(line.provisionalQuantitySource, 'phase2_final_recommendation');
  assert.equal(line.provisionalLineSum, 600);
  assert.equal(line.blockingReason, 'sales_spike_quantity_requires_review');
  assert.equal(line.approvedOrderQuantity, null);
});

test('known weak-demand Phase 1 line is confidently excluded', () => {
  const sourceProduct = product({
    analyzerCalculatedQuantity: 2,
    finalRecommendedQuantity: 2,
    freeStock: 4,
    salesDailyRate: 0,
    sales7: 0,
    sales14: 0,
    sales28: 0,
    priceNum: 25,
  });
  const result = buildWorkingOrder([sourceProduct], [decision(sourceProduct.rowIdentity, {
    decision: 'do_not_buy',
    decisionBasis: 'phase2_calculated',
    approvedOrderQuantity: 0,
    reasons: [
      'confirmed_zero_sales_without_mandatory_gap',
      'quantity_reason:analyzer_maximum',
    ],
  })]);
  const line = result.products[0];

  assert.equal(line.workflowStatus, 'confidently_excluded');
  assert.equal(line.provisionalOrderQuantity, null);
  assert.equal(result.summary.confidentlyExcludedLines, 1);
  assert.equal(result.summary.confidentlyExcludedPhase1Value, 50);
});

test('approved totals exclude pending values while working maximum includes them', () => {
  const products = [
    product({
      rowIdentity: 'auto',
      analyzerCalculatedQuantity: 2,
      finalRecommendedQuantity: 2,
      freeStock: 1,
      priceNum: 10,
    }),
    product({
      rowIdentity: 'pending',
      analyzerCalculatedQuantity: 3,
      finalRecommendedQuantity: null,
      freeStock: null,
      priceNum: 20,
    }),
    product({
      rowIdentity: 'postponed',
      analyzerCalculatedQuantity: 1,
      finalRecommendedQuantity: 1,
      freeStock: 1,
      priceNum: 30,
    }),
    product({
      rowIdentity: 'excluded',
      analyzerCalculatedQuantity: 4,
      finalRecommendedQuantity: 4,
      freeStock: 5,
      priceNum: 5,
      salesDailyRate: 0,
      sales7: 0,
      sales14: 0,
      sales28: 0,
    }),
    product({
      rowIdentity: 'addition',
      analyzerCalculatedQuantity: 0,
      finalRecommendedQuantity: 6,
      freeStock: 2,
      priceNum: 2,
    }),
  ];
  const analyzerQuantitiesBefore = products.map(item => item.analyzerCalculatedQuantity);
  const decisions = [
    decision('auto', {
      decision: 'must_buy',
      decisionBasis: 'phase2_calculated',
      approvedOrderQuantity: 2,
      reasons: ['valid_demand_with_abc_xyz_priority:A/X'],
    }),
    decision('pending', { requiredData: ['free_stock'] }),
    decision('postponed', {
      decision: 'postpone',
      decisionBasis: 'phase2_risk_review',
      reasons: ['abc_xyz_risk:C/Y'],
    }),
    decision('excluded', {
      decision: 'do_not_buy',
      decisionBasis: 'phase2_calculated',
      approvedOrderQuantity: 0,
      reasons: ['confirmed_zero_sales_without_mandatory_gap'],
    }),
    decision('addition', {
      decisionBasis: 'phase2_risk_review',
      reasons: ['sales_spike_quantity_requires_review'],
    }),
  ];
  const result = buildWorkingOrder(products, decisions);

  assert.equal(result.summary.autoApprovedLines, 1);
  assert.equal(result.summary.autoApprovedSum, 20);
  assert.equal(result.summary.pendingReviewLines, 2);
  assert.equal(result.summary.pendingReviewProvisionalSum, 72);
  assert.equal(result.summary.workingMaximumLines, 3);
  assert.equal(result.summary.workingMaximumSum, 92);
  assert.equal(result.summary.postponedLines, 1);
  assert.equal(result.summary.postponedProvisionalSum, 30);
  assert.equal(result.summary.phase2AdditionLines, 1);
  assert.equal(result.phase1Reconciliation.totalLines, 4);
  assert.equal(result.phase1Reconciliation.reconciledLines, 4);
  assert.equal(result.phase1Reconciliation.precisePhase1Value, 130);
  assert.equal(result.phase1Reconciliation.reconciledValue, 130);
  assert.equal(result.phase1Reconciliation.reconciledExactly, true);
  assert.deepEqual(
    products.map(item => item.analyzerCalculatedQuantity),
    analyzerQuantitiesBefore
  );
});

test('working-order report uses workflow sections and preliminary wording', () => {
  const sourceProduct = product({
    analyzerCalculatedQuantity: 2,
    finalRecommendedQuantity: null,
    freeStock: null,
    priceNum: 20,
  });
  const result = buildWorkingOrder([sourceProduct], [decision(sourceProduct.rowIdentity, {
    requiredData: ['free_stock'],
  })]);
  const agentJson = {
    order_rows_count: 1,
    preliminary_order_sum: 40,
    workingOrderProducts: result.products,
    phase1Reconciliation: result.phase1Reconciliation,
    ...result.summary,
  };
  const report = buildWorkingOrderReport({ agentJson, sourceName: 'synthetic.xlsx' });

  for (const section of [
    '## A. Automatically approved order',
    '## B. Requires manual review',
    '## C. Postponed',
    '## D. Confidently excluded',
    '## E. Phase 2 additions',
    '## F. Suspicious quantity increases',
  ]) {
    assert.ok(report.includes(section));
  }
  assert.ok(report.includes('not approved and is not ready for automatic submission'));
  assert.ok(!report.toLowerCase().includes('final order'));
});
