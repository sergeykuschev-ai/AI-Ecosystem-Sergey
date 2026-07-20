const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  DEFAULT_RECOMMENDATION_EXPLAINER_CONFIG_PATH,
  buildRecommendationExplanations,
  buildRecommendationExplanationsReport,
  loadRecommendationExplainerConfig,
  validateRecommendationExplainerConfig,
} = require('../explanations/recommendation_explainer');

function product(overrides = {}) {
  return {
    rowIdentity: 'row-1',
    article: 'SKU-1',
    barcode: null,
    internalProductId: null,
    name: 'Синтетический товар',
    priceNum: 100,
    freeStock: 2,
    stockStatus: 'known',
    inTransitQuantity: 0,
    availableStock: 2,
    salesDailyRate: 1,
    salesRateSource: 'synthetic_period',
    salesStatus: 'complete',
    salesTrend: 'consistent',
    sales7: 7,
    sales14: 14,
    sales28: 28,
    analyzerCalculatedQuantity: 4,
    demandCalculatedQuantity: 6,
    finalRecommendedQuantity: 6,
    minDisplayStock: 3,
    targetStock: 8,
    warnings: [],
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    rowIdentity: 'row-1',
    decision: 'recommended',
    confidence: 'high',
    calculatedOrderQuantity: 6,
    approvedOrderQuantity: 6,
    reasons: ['valid_demand_with_abc_xyz_priority:A/Y'],
    warnings: [],
    requiredData: [],
    ...overrides,
  };
}

function working(overrides = {}) {
  return {
    rowIdentity: 'row-1',
    article: 'SKU-1',
    name: 'Синтетический товар',
    priceNum: 100,
    approvedOrderQuantity: 6,
    provisionalOrderQuantity: 6,
    approvedLineSum: 600,
    ...overrides,
  };
}

function matrixItem(overrides = {}) {
  return {
    rowIdentity: 'row-1',
    suggested_role: 'OPTIONAL',
    suggested_priority: 'standard',
    suggested_minimum_shelf_stock: 3,
    suggested_target_stock: 8,
    suggested_maximum_stock: 12,
    suggested_safety_stock: 2,
    inventory_value_review_level: null,
    existing_policy: null,
    owner_decision_status: 'none',
    owner_decision_applied: false,
    owner_decision_conflict: false,
    owner_decision_summary: null,
    ...overrides,
  };
}

function agentResult(overrides = {}) {
  const sourceProduct = overrides.product || product();
  const sourceDecision = overrides.decision || decision();
  const sourceWorking = overrides.working || working();
  return [{ json: {
    product_rows_count: 1,
    demandProducts: [sourceProduct],
    decisions: [sourceDecision],
    phase1Decisions: overrides.phase1Decisions || [],
    workingOrderProducts: [sourceWorking],
    financial_assessment: overrides.financial || {
      status: 'APPROVED',
      advisory_only: true,
      financially_permitted: true,
      order_composition_changed: false,
      safe_budget_excess: 0,
      recommendation: 'Заказ укладывается в безопасный бюджет.',
    },
  } }];
}

function explain(overrides = {}) {
  const result = agentResult(overrides);
  const explanations = buildRecommendationExplanations(result, {
    matrixDraft: {
      items: [overrides.matrixItem || matrixItem()],
    },
  });
  return { result, explanations, item: explanations.items[0] };
}

function reasonCodes(item) {
  return item.explanation_reasons.map(reason => reason.code);
}

test('loads and validates transparent confidence configuration', () => {
  const loaded = loadRecommendationExplainerConfig();
  assert.equal(loaded.config.version, 'miska-recommendation-explainer-v0.6');
  assert.equal(loaded.configPath, DEFAULT_RECOMMENDATION_EXPLAINER_CONFIG_PATH);
  assert.deepEqual(loaded.config.confidence_policy.low_if_missing_any, [
    'free_stock', 'sales_period',
  ]);
  const invalid = structuredClone(loaded.config);
  invalid.confidence_policy.low_if_missing_any = ['invented_field'];
  assert.throws(
    () => validateRecommendationExplainerConfig(invalid),
    /поддерживаемых calculation_facts/
  );
});

test('explains a positive order from stock below minimum and target', () => {
  const { item } = explain();
  assert.equal(item.final_recommendation, 'ORDER');
  assert.equal(item.recommended_quantity, 6);
  assert.ok(reasonCodes(item).includes('STOCK_BELOW_MINIMUM'));
  assert.ok(reasonCodes(item).includes('STOCK_BELOW_TARGET'));
  assert.ok(reasonCodes(item).includes('POSITIVE_ORDER_RECOMMENDED'));
  assert.match(item.explanation_summary, /Рекомендуется заказать 6 шт/);
});

test('explains a zero order when free stock is sufficient', () => {
  const { item } = explain({
    product: product({
      freeStock: 10,
      availableStock: 10,
      analyzerCalculatedQuantity: 0,
      demandCalculatedQuantity: 0,
      finalRecommendedQuantity: 0,
    }),
    decision: decision({
      decision: 'do_not_buy',
      approvedOrderQuantity: 0,
      calculatedOrderQuantity: 0,
      reasons: ['final_recommended_quantity_not_positive'],
    }),
    working: working({ approvedOrderQuantity: 0, provisionalOrderQuantity: null, approvedLineSum: 0 }),
  });
  assert.equal(item.recommended_quantity, 0);
  assert.ok(reasonCodes(item).includes('SUFFICIENT_FREE_STOCK'));
  assert.ok(reasonCodes(item).includes('ZERO_ORDER_RECOMMENDED'));
  assert.match(item.explanation_summary, /остаток 10 шт/);
});

test('explains when stock in transit covers the need', () => {
  const { item } = explain({
    product: product({
      freeStock: 1,
      inTransitQuantity: 6,
      availableStock: 7,
      analyzerCalculatedQuantity: 4,
      demandCalculatedQuantity: 0,
      finalRecommendedQuantity: 0,
    }),
    decision: decision({ decision: 'do_not_buy', approvedOrderQuantity: 0 }),
    working: working({ approvedOrderQuantity: 0, provisionalOrderQuantity: null, approvedLineSum: 0 }),
  });
  assert.ok(reasonCodes(item).includes('IN_TRANSIT_COVERS_NEED'));
  assert.match(item.explanation_summary, /товар в пути \(6 шт\.\)/);
});

test('unknown stock produces null fact, risk flag, and low confidence', () => {
  const { item } = explain({
    product: product({
      freeStock: null,
      stockStatus: 'unknown',
      availableStock: null,
      finalRecommendedQuantity: null,
    }),
    decision: decision({
      decision: 'manual_review',
      confidence: 'medium',
      approvedOrderQuantity: null,
      requiredData: ['free_stock'],
    }),
    working: working({ approvedOrderQuantity: null, approvedLineSum: 0 }),
  });
  assert.equal(item.calculation_facts.free_stock, null);
  assert.ok(item.risk_flags.includes('UNKNOWN_STOCK'));
  assert.equal(item.confidence_level, 'low');
});

test('unknown price is never replaced by zero and limits confidence to medium', () => {
  const { item } = explain({
    product: product({ priceNum: null }),
    working: working({ priceNum: null, approvedLineSum: 0 }),
  });
  assert.equal(item.calculation_facts.unit_price, null);
  assert.equal(item.calculation_facts.line_sum, null);
  assert.ok(item.risk_flags.includes('UNKNOWN_PRICE'));
  assert.equal(item.confidence_level, 'medium');
});

test('strong demand, weak demand, and sales spike use only existing signals', () => {
  const strong = explain().item;
  const weak = explain({
    product: product({ salesStatus: 'confirmed_zero', salesDailyRate: 0, sales7: 0, sales14: 0, sales28: 0 }),
    decision: decision({ reasons: ['confirmed_zero_sales_without_mandatory_gap'] }),
  }).item;
  const spike = explain({
    product: product({ salesTrend: 'spike', warnings: ['short_term_sales_spike'] }),
    decision: decision({ decision: 'manual_review', approvedOrderQuantity: null }),
  }).item;
  assert.ok(reasonCodes(strong).includes('STRONG_DEMAND'));
  assert.ok(reasonCodes(weak).includes('WEAK_DEMAND'));
  assert.ok(reasonCodes(spike).includes('SALES_SPIKE'));
});

test('CORE, OPTIONAL, and EXIT influences remain explicit', () => {
  for (const [role, code] of [
    ['CORE', 'MATRIX_CORE'],
    ['OPTIONAL', 'MATRIX_OPTIONAL'],
    ['EXIT', 'MATRIX_EXIT'],
  ]) {
    const { item } = explain({ matrixItem: matrixItem({ suggested_role: role }) });
    assert.equal(item.matrix_role_influence.role, role);
    assert.equal(item.matrix_role_influence.draft_policy.maximum, 12);
    assert.equal(item.calculation_facts.maximum, null);
    assert.ok(reasonCodes(item).includes(code));
  }
});

test('approved and placeholder policies are distinguished', () => {
  const approved = explain({
    matrixItem: matrixItem({ existing_policy: { policy_status: 'approved' } }),
  }).item;
  const placeholder = explain({
    matrixItem: matrixItem({ existing_policy: { policy_status: 'placeholder' } }),
  }).item;
  assert.ok(reasonCodes(approved).includes('APPROVED_POLICY'));
  assert.ok(reasonCodes(placeholder).includes('PLACEHOLDER_POLICY'));
});

test('owner decision application and conflict are visible without changing quantity', () => {
  const applied = explain({
    matrixItem: matrixItem({
      owner_decision_status: 'active',
      owner_decision_applied: true,
      owner_decision_summary: 'KEEP_OPTIONAL: подтверждено',
    }),
  }).item;
  const conflict = explain({
    matrixItem: matrixItem({
      owner_decision_status: 'active',
      owner_decision_conflict: true,
      owner_decision_summary: 'KEEP_CORE: требуется пересмотр',
    }),
  }).item;
  assert.ok(reasonCodes(applied).includes('OWNER_DECISION_APPLIED'));
  assert.ok(reasonCodes(conflict).includes('OWNER_DECISION_CONFLICT'));
  assert.equal(applied.recommended_quantity, 6);
  assert.equal(conflict.recommended_quantity, 6);
});

test('Financial Controller influence is explanatory and preserves the order', () => {
  const { item } = explain({
    financial: {
      status: 'REJECTED',
      advisory_only: true,
      financially_permitted: false,
      order_composition_changed: false,
      safe_budget_excess: 1000,
      recommendation: 'Требуется сократить или перенести заказ.',
    },
  });
  assert.ok(reasonCodes(item).includes('FINANCIAL_LIMIT_APPLIED'));
  assert.equal(item.financial_controller_influence.status, 'REJECTED');
  assert.equal(item.recommended_quantity, 6);
  assert.match(item.explanation_summary, /финансовое согласование/);
});

test('manual review is explained and unavailable facts stay null', () => {
  const { item } = explain({
    product: product({ freeStock: null, sales7: null, sales14: null, sales28: null, salesDailyRate: null, salesStatus: 'missing' }),
    decision: decision({ decision: 'manual_review', approvedOrderQuantity: null }),
    working: working({ approvedOrderQuantity: null, provisionalOrderQuantity: 6, approvedLineSum: 0 }),
    matrixItem: matrixItem({ suggested_maximum_stock: null, suggested_safety_stock: null }),
  });
  assert.equal(item.final_recommendation, 'MANUAL_REVIEW');
  assert.ok(reasonCodes(item).includes('MANUAL_REVIEW_REQUIRED'));
  assert.equal(item.calculation_facts.free_stock, null);
  assert.equal(item.calculation_facts.sales_period, null);
  assert.equal(item.calculation_facts.maximum, null);
  assert.ok(item.source_fields_missing.includes('free_stock'));
});

test('identical input is deterministic and source Purchasing Agent result is not mutated', () => {
  const source = agentResult();
  const before = structuredClone(source);
  const options = { matrixDraft: { items: [matrixItem()] } };
  const first = buildRecommendationExplanations(source, options);
  const second = buildRecommendationExplanations(source, options);
  assert.deepEqual(first, second);
  assert.deepEqual(source, before);
});

test('explainer rejects an incomplete SKU set instead of silently omitting products', () => {
  const source = agentResult();
  source[0].json.product_rows_count = 2;
  assert.throws(
    () => buildRecommendationExplanations(source, {
      matrixDraft: { items: [matrixItem()] },
    }),
    error => error.code === 'EXPLANATION_PRODUCT_COUNT_MISMATCH'
  );
});

test('Markdown report contains all required sections and owner-facing facts', () => {
  const { explanations } = explain();
  const report = buildRecommendationExplanationsReport(explanations);
  for (const heading of [
    'Executive Summary',
    'Recommended to Order',
    'Not Recommended to Order',
    'Manual Review Required',
    'EXIT Explanations',
    'Low Confidence Explanations',
    'Owner Decisions Influence',
    'Financial Controller Influence',
  ]) assert.ok(report.includes(heading), `Отсутствует ${heading}`);
  assert.ok(report.includes('SKU-1'));
  assert.ok(report.endsWith('\n'));
});
