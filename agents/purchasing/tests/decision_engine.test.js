const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  buildPurchasingDecisions,
} = require('../services/decision_engine');
const { buildDecisionReport } = require('../services/decision_report');

function product(overrides = {}) {
  return {
    rowIdentity: 'report:test:row:1',
    rowNumber: 1,
    article: 'ARTICLE-1',
    name: 'Synthetic product',
    supplier: 'Synthetic Supplier',
    abc: 'B',
    xyz: 'X',
    freeStock: 5,
    stock: null,
    stockDays: 5,
    orderQty: 2,
    priceNum: 10,
    sumNum: 20,
    strategic: false,
    ...overrides,
  };
}

function decide(rows, diagnostics = {}) {
  return buildPurchasingDecisions({ productRows: rows }, diagnostics);
}

test('known-stock A/X is automatically approved as must buy', () => {
  const result = decide([product({ abc: 'A', xyz: 'X' })]);
  const decision = result.decisions[0];

  assert.equal(decision.decision, 'must_buy');
  assert.equal(decision.confidence, 'high');
  assert.equal(decision.calculatedOrderQuantity, 2);
  assert.equal(decision.approvedOrderQuantity, 2);
  assert.deepEqual(decision.reasons, ['abc_xyz_priority:A/X']);
  assert.equal(decision.decisionScore, 100);
});

test('known-stock A/Y is recommended with its calculated quantity approved', () => {
  const decision = decide([
    product({ abc: 'A', xyz: 'Y' }),
  ]).decisions[0];

  assert.equal(decision.decision, 'recommended');
  assert.equal(decision.confidence, 'high');
  assert.equal(decision.approvedOrderQuantity, 2);
  assert.ok(decision.reasons.includes('abc_xyz_priority:A/Y'));
});

test('unknown-stock A/X remains manual review and cannot be high confidence', () => {
  const decision = decide([
    product({ abc: 'A', xyz: 'X', freeStock: null }),
  ]).decisions[0];

  assert.equal(decision.decision, 'manual_review');
  assert.equal(decision.confidence, 'medium');
  assert.equal(decision.approvedOrderQuantity, null);
  assert.deepEqual(decision.requiredData, ['free_stock']);
  assert.ok(decision.reasons.includes('free_stock_unknown'));
});

test('A/Z is manual review and C/Y is postponed', () => {
  const result = decide([
    product({ rowIdentity: 'row:az', abc: 'A', xyz: 'Z' }),
    product({ rowIdentity: 'row:cy', abc: 'C', xyz: 'Y' }),
  ]);

  assert.equal(result.decisions[0].decision, 'manual_review');
  assert.equal(result.decisions[0].approvedOrderQuantity, null);
  assert.ok(result.decisions[0].reasons.includes('abc_xyz_risk:A/Z'));
  assert.equal(result.decisions[1].decision, 'postpone');
  assert.equal(result.decisions[1].approvedOrderQuantity, null);
  assert.ok(result.decisions[1].reasons.includes('abc_xyz_risk:C/Y'));
});

test('C/Z is low-confidence manual review', () => {
  const decision = decide([
    product({ abc: 'C', xyz: 'Z' }),
  ]).decisions[0];

  assert.equal(decision.decision, 'manual_review');
  assert.equal(decision.confidence, 'low');
  assert.equal(decision.decisionScore, 45);
  assert.ok(decision.reasons.includes('abc_xyz_risk:C/Z'));
});

test('B/Z is not automatically approved', () => {
  const decision = decide([
    product({ abc: 'B', xyz: 'Z' }),
  ]).decisions[0];

  assert.equal(decision.decision, 'manual_review');
  assert.equal(decision.approvedOrderQuantity, null);
  assert.ok(decision.reasons.includes('abc_xyz_risk:B/Z'));
});

test('missing article warns and reduces confidence exactly one level', () => {
  const decision = decide([
    product({ article: '', abc: 'A', xyz: 'X' }),
  ]).decisions[0];

  assert.equal(decision.decision, 'must_buy');
  assert.equal(decision.confidence, 'medium');
  assert.equal(decision.approvedOrderQuantity, 2);
  assert.deepEqual(decision.warnings, ['missing_article']);
  assert.equal(decision.decisionScore, 100);
});

test('duplicate article warns but retains and decides every row independently', () => {
  const rows = [
    product({ rowIdentity: 'row:duplicate:1', rowNumber: 1 }),
    product({ rowIdentity: 'row:duplicate:2', rowNumber: 2, name: 'Other product' }),
  ];
  const result = decide(rows, {
    duplicateIdentifiers: [
      {
        identifierType: 'article',
        rowIdentities: rows.map(row => row.rowIdentity),
      },
    ],
  });

  assert.equal(result.decisions.length, 2);
  assert.ok(result.decisions.every(item => item.warnings.includes('duplicate_article')));
  assert.ok(result.decisions.every(item => item.decision === 'recommended'));
});

test('strategic product increases known-stock priority but never overrides unknown stock', () => {
  const result = decide([
    product({ rowIdentity: 'row:strategic:known', strategic: true }),
    product({
      rowIdentity: 'row:strategic:unknown',
      rowNumber: 2,
      strategic: true,
      freeStock: null,
    }),
  ]);

  assert.equal(result.decisions[0].decision, 'recommended');
  assert.equal(result.decisions[0].confidence, 'high');
  assert.ok(result.decisions[0].reasons.includes('strategic_product_priority'));
  assert.equal(result.decisions[1].decision, 'manual_review');
  assert.equal(result.decisions[1].approvedOrderQuantity, null);
  assert.ok(result.decisions[1].requiredData.includes('free_stock'));
});

test('confirmed numeric zero stock is known while blank stock remains unknown', () => {
  const result = decide([
    product({ rowIdentity: 'row:zero', freeStock: 0 }),
    product({ rowIdentity: 'row:blank', rowNumber: 2, freeStock: null }),
  ]);

  assert.equal(result.decisions[0].decision, 'recommended');
  assert.equal(result.decisions[0].approvedOrderQuantity, 2);
  assert.ok(result.decisions[0].reasons.includes('confirmed_numeric_zero_free_stock'));
  assert.ok(!result.decisions[0].requiredData.includes('free_stock'));
  assert.equal(result.decisions[1].decision, 'manual_review');
  assert.ok(result.decisions[1].requiredData.includes('free_stock'));
});

test('calculated quantity zero is rejected with approved quantity zero', () => {
  const decision = decide([product({ orderQty: 0, sumNum: null })]).decisions[0];

  assert.equal(decision.decision, 'do_not_buy');
  assert.equal(decision.approvedOrderQuantity, 0);
  assert.deepEqual(decision.reasons, ['calculated_order_quantity_not_positive']);
});

test('missing critical fields force manual review and enumerate required data', () => {
  const decision = decide([
    product({ supplier: '', priceNum: null, abc: '', xyz: '' }),
  ]).decisions[0];

  assert.equal(decision.decision, 'manual_review');
  assert.equal(decision.approvedOrderQuantity, null);
  assert.deepEqual(
    decision.requiredData,
    ['supplier', 'purchase_price', 'abc_class', 'xyz_class']
  );
});

test('score is deterministic, explainable, and analysis is not mutated', () => {
  const analysis = { productRows: [product()] };
  const original = structuredClone(analysis);
  const first = buildPurchasingDecisions(analysis);
  const second = buildPurchasingDecisions(analysis);

  assert.equal(first.decisions[0].decisionScore, 75);
  assert.equal(second.decisions[0].decisionScore, 75);
  assert.deepEqual(first, second);
  assert.deepEqual(analysis, original);
});

test('summary separates approved and pending calculated lines and sums', () => {
  const rows = [
    product({ rowIdentity: 'row:approved', abc: 'A', xyz: 'X', sumNum: 20 }),
    product({
      rowIdentity: 'row:pending',
      rowNumber: 2,
      freeStock: null,
      sumNum: 30,
    }),
    product({
      rowIdentity: 'row:none',
      rowNumber: 3,
      orderQty: 0,
      sumNum: null,
    }),
  ];
  const result = decide(rows);

  assert.equal(result.summary.approvedOrderLines, 1);
  assert.equal(result.summary.approvedOrderSum, 20);
  assert.equal(result.summary.pendingReviewLines, 1);
  assert.equal(result.summary.pendingReviewCalculatedSum, 30);
  assert.equal(result.summary.doNotBuyCount, 1);
});

test('decision report includes all required operational sections and quantities', () => {
  const rows = [
    product({ rowIdentity: 'row:approved', abc: 'A', xyz: 'X' }),
    product({
      rowIdentity: 'row:manual',
      rowNumber: 2,
      freeStock: null,
      sumNum: 30,
    }),
    product({
      rowIdentity: 'row:postpone',
      rowNumber: 3,
      abc: 'C',
      xyz: 'Y',
    }),
    product({
      rowIdentity: 'row:rejected',
      rowNumber: 4,
      orderQty: 0,
      sumNum: null,
    }),
  ];
  const result = decide(rows);
  const report = buildDecisionReport({
    agentJson: {
      source_rows_count: 4,
      normalized_product_rows_count: 4,
      product_rows_count: 4,
      order_rows_count: 3,
      preliminary_order_sum: 70,
      decisions: result.decisions,
      ...result.summary,
    },
    productRows: rows,
    sourceName: 'synthetic.xlsx',
  });

  for (const heading of [
    '## Executive summary',
    '## Automatically approved order',
    '## Manual review queue',
    '## Postponed products',
    '## Rejected / no-order products',
    '## Manual-review reasons and missing data',
  ]) {
    assert.match(report, new RegExp(heading.replace(/[/-]/g, '\\$&')));
  }
  assert.match(report, /Calculated quantity/);
  assert.match(report, /Approved quantity/);
  assert.match(report, /free_stock/);
});
