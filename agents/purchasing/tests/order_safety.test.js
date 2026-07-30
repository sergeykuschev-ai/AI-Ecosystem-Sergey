const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  ORDER_SAFETY_CODES,
  applyOrderSafety,
  buildOrderSafetyReview,
  effectiveMin,
  effectiveMax,
  extractPackaging,
  normalizeArticle,
  packagingMismatch,
} = require('../services/order_safety');

function product(overrides = {}) {
  return {
    rowIdentity: 'row:1',
    rowNumber: 1,
    article: ' art-1 ',
    name: 'Товар 1 кг',
    supplier: 'Поставщик',
    freeStock: 1,
    effectiveMin: 2,
    effectiveMax: null,
    mandatoryAssortment: false,
    mandatoryMinimumGap: 0,
    finalRecommendedQuantity: 2,
    ...overrides,
  };
}

function approvedDecision(overrides = {}) {
  return {
    rowIdentity: 'row:1',
    decision: 'recommended',
    decisionBasis: 'phase2_calculated',
    confidence: 'high',
    approvedOrderQuantity: 2,
    reasons: [],
    warnings: [],
    requiredData: [],
    ...overrides,
  };
}

test('effective MIN and MAX prefer valid manual values and never invent data', () => {
  assert.deepEqual(effectiveMin({ manualMin: 3, autoMin: 2 }), {
    value: 3,
    source: 'manual',
  });
  assert.deepEqual(effectiveMin({ manualMin: -1, autoMin: 2 }), {
    value: 2,
    source: 'automatic',
  });
  assert.deepEqual(effectiveMin({ manualMin: null, autoMin: null }), {
    value: null,
    source: null,
  });
  assert.deepEqual(effectiveMax({ manualMax: null, autoMax: 8 }), {
    value: 8,
    source: 'automatic',
  });
  assert.deepEqual(effectiveMax({}), { value: null, source: null });
});

test('normalizes article without removing meaningful punctuation', () => {
  assert.equal(normalizeArticle('  ab - 12/Х  '), 'AB-12/Х');
});

test('free stock equal to or above MIN blocks automatic approval', () => {
  for (const freeStock of [3, 5]) {
    const result = applyOrderSafety(
      product({ freeStock, effectiveMin: 3 }),
      approvedDecision(),
      { highStockWarningThreshold: 100 }
    );
    assert.equal(result.decision, 'manual_review');
    assert.equal(result.approvedOrderQuantity, null);
    assert.ok(result.orderSafetyReasons.includes(
      ORDER_SAFETY_CODES.FREE_STOCK_NOT_BELOW_MIN
    ));
  }
});

test('positive recommendation at high-stock threshold requires owner review', () => {
  const result = applyOrderSafety(
    product({ freeStock: 4, effectiveMin: null }),
    approvedDecision(),
    { highStockWarningThreshold: 4 }
  );

  assert.equal(result.decision, 'manual_review');
  assert.equal(result.approvedOrderQuantity, null);
  assert.ok(result.orderSafetyReasons.includes(
    ORDER_SAFETY_CODES.HIGH_STOCK_ORDER_WARNING
  ));
});

test('confirmed mandatory floor gap is the explicit MIN exception', () => {
  const result = applyOrderSafety(
    product({
      freeStock: 2,
      effectiveMin: 2,
      mandatoryAssortment: true,
      mandatoryMinimumGap: 2,
      finalRecommendedQuantity: 2,
    }),
    approvedDecision({ decision: 'must_buy' }),
    { highStockWarningThreshold: 4 }
  );

  assert.equal(result.decision, 'must_buy');
  assert.equal(result.approvedOrderQuantity, 2);
  assert.deepEqual(result.orderSafetyReasons, [
    ORDER_SAFETY_CODES.MANDATORY_ASSORTMENT_BELOW_FLOOR,
  ]);
});

test('missing or duplicate article blocks even a mandatory item', () => {
  const mandatory = product({
    article: '',
    mandatoryAssortment: true,
    mandatoryMinimumGap: 4,
    freeStock: 0,
  });
  const missing = applyOrderSafety(
    mandatory,
    approvedDecision({ decision: 'must_buy', approvedOrderQuantity: 4 }),
    { highStockWarningThreshold: 4 }
  );
  const duplicate = applyOrderSafety(
    { ...mandatory, article: 'DUP-1' },
    approvedDecision({ decision: 'must_buy', approvedOrderQuantity: 4 }),
    { duplicateArticle: true, highStockWarningThreshold: 4 }
  );

  assert.equal(missing.decision, 'manual_review');
  assert.deepEqual(missing.orderSafetyReasons, [
    ORDER_SAFETY_CODES.ARTICLE_REQUIRED,
  ]);
  assert.equal(duplicate.decision, 'manual_review');
  assert.deepEqual(duplicate.orderSafetyReasons, [
    ORDER_SAFETY_CODES.DUPLICATE_ARTICLE,
  ]);
});

test('packaging comparison normalizes units and detects a different pack', () => {
  assert.deepEqual(
    extractPackaging('Корм 1,5 кг'),
    extractPackaging('Корм 1500 г')
  );
  assert.equal(packagingMismatch('Корм 1,5 кг', 'Корм 1500 г'), false);
  assert.equal(packagingMismatch('Корм 1,5 кг', 'Корм 400 г'), true);
  assert.equal(packagingMismatch('Корм без указанной фасовки', 'Корм 400 г'), false);
});

test('machine safety review preserves reasons and owner-review status', () => {
  const review = buildOrderSafetyReview([{
    ...product(),
    workflowStatus: 'pending_manual_review',
    provisionalOrderQuantity: 3,
    orderSafetyReasons: [ORDER_SAFETY_CODES.HIGH_STOCK_ORDER_WARNING],
    orderSafetyReviewRequired: true,
  }], { highStockWarningThreshold: 4 });

  assert.equal(review.version, 'order-safety-v1');
  assert.equal(review.highStockWarningThreshold, 4);
  assert.equal(review.itemCount, 1);
  assert.equal(review.ownerReviewRequiredCount, 1);
  assert.equal(
    review.items[0].reasons[0],
    ORDER_SAFETY_CODES.HIGH_STOCK_ORDER_WARNING
  );
});
