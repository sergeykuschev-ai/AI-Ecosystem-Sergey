const assert = require('node:assert/strict');
const test = require('node:test');

const {
  RECALCULATION_STATUS,
  RECALCULATION_VERSION,
  recalculateFinancialSummary,
} = require('../owner_learning/financial_recalculation');

function previousSummary(overrides = {}) {
  return {
    currency: 'RUB',
    available_after_expenses: 200,
    minimum_reserve: 100,
    warning_reserve_surplus_threshold: 30,
    ...overrides,
  };
}

function line({
  finalRecommendation = 'BUY',
  finalQuantity = 1,
  unitPrice = 10,
} = {}) {
  return {
    finalRecommendation,
    finalQuantity,
    unitPrice,
  };
}

function recalculate(orderLines, summary = previousSummary()) {
  return recalculateFinancialSummary({
    orderLines,
    previousSummary: summary,
  });
}

test('empty order recalculates zero totals safely', () => {
  const result = recalculate([]);

  assert.equal(result.recalculationStatus, RECALCULATION_STATUS.COMPLETE);
  assert.equal(result.totalOrderAmount, 0);
  assert.equal(result.orderedSkuCount, 0);
  assert.equal(result.orderedUnits, 0);
  assert.equal(result.costAfterRules, 0);
  assert.equal(result.availableAfterOrder, 200);
  assert.equal(result.reserveSurplus, 100);
  assert.equal(result.financialStatus, 'APPROVED');
});

test('one BUY recalculates amount, SKU and units', () => {
  const result = recalculate([
    line({ finalQuantity: 2, unitPrice: 12.5 }),
  ]);

  assert.equal(result.totalOrderAmount, 25);
  assert.equal(result.orderedSkuCount, 1);
  assert.equal(result.orderedUnits, 2);
  assert.equal(result.costAfterRules, 25);
  assert.equal(result.availableAfterOrder, 175);
  assert.equal(result.reserveSurplus, 75);
});

test('multiple BUY lines use rounded line amounts', () => {
  const result = recalculate([
    line({ finalQuantity: 3, unitPrice: 10.005 }),
    line({ finalQuantity: 2, unitPrice: 4.335 }),
  ]);

  assert.equal(result.totalOrderAmount, 38.69);
  assert.equal(result.orderedSkuCount, 2);
  assert.equal(result.orderedUnits, 5);
});

test('BUY -> SKIP is ignored after quantity becomes zero', () => {
  const result = recalculate([
    line({
      finalRecommendation: 'SKIP',
      finalQuantity: 0,
      unitPrice: 50,
    }),
    line({ finalQuantity: 2, unitPrice: 10 }),
  ]);

  assert.equal(result.totalOrderAmount, 20);
  assert.equal(result.orderedSkuCount, 1);
  assert.equal(result.orderedUnits, 2);
  assert.equal(result.diagnostics.ignoredZeroQuantityLines, 1);
});

test('BUY -> DEFER is ignored after quantity becomes zero', () => {
  const result = recalculate([
    line({
      finalRecommendation: 'DEFER',
      finalQuantity: 0,
      unitPrice: 50,
    }),
    line({ finalQuantity: 1, unitPrice: 15 }),
  ]);

  assert.equal(result.totalOrderAmount, 15);
  assert.equal(result.orderedSkuCount, 1);
  assert.equal(result.diagnostics.ignoredZeroQuantityLines, 1);
});

test('all excluded items produce a complete zero order', () => {
  const result = recalculate([
    line({
      finalRecommendation: 'SKIP',
      finalQuantity: 0,
      unitPrice: 10,
    }),
    line({
      finalRecommendation: 'DEFER',
      finalQuantity: 0,
      unitPrice: null,
    }),
  ]);

  assert.equal(result.recalculationStatus, RECALCULATION_STATUS.COMPLETE);
  assert.equal(result.totalOrderAmount, 0);
  assert.equal(result.orderedSkuCount, 0);
  assert.equal(result.orderedUnits, 0);
  assert.equal(result.diagnostics.ignoredZeroQuantityLines, 2);
});

test('negative quantity blocks the order without publishing partial totals', () => {
  const result = recalculate([
    line({ finalQuantity: -1 }),
  ]);

  assert.equal(
    result.recalculationStatus,
    RECALCULATION_STATUS.BLOCKED_INVALID_ORDER
  );
  assert.equal(result.totalOrderAmount, null);
  assert.equal(result.financialStatus, null);
  assert.deepEqual(result.invalidLines, [{
    index: 0,
    field: 'finalQuantity',
    reason: 'INVALID_FINAL_QUANTITY',
  }]);
});

test('NaN quantity and price are blocked safely', () => {
  const quantityResult = recalculate([
    line({ finalQuantity: Number.NaN }),
  ]);
  const priceResult = recalculate([
    line({ unitPrice: Number.NaN }),
  ]);

  assert.equal(
    quantityResult.recalculationStatus,
    RECALCULATION_STATUS.BLOCKED_INVALID_ORDER
  );
  assert.equal(
    priceResult.recalculationStatus,
    RECALCULATION_STATUS.BLOCKED_INVALID_ORDER
  );
  assert.equal(quantityResult.totalOrderAmount, null);
  assert.equal(priceResult.totalOrderAmount, null);
});

test('missing price returns a partial result instead of guessing cost', () => {
  const result = recalculate([
    line({ finalQuantity: 2, unitPrice: null }),
  ]);

  assert.equal(
    result.recalculationStatus,
    RECALCULATION_STATUS.PARTIAL
  );
  assert.equal(result.totalOrderAmount, null);
  assert.equal(result.costAfterRules, null);
  assert.equal(result.orderedSkuCount, 1);
  assert.equal(result.orderedUnits, 2);
  assert.equal(result.financialStatus, null);
  assert.deepEqual(result.missingFields, ['orderLines[0].unitPrice']);
});

test('missing quantity makes all order aggregates partial', () => {
  const result = recalculate([{
    finalRecommendation: 'BUY',
    unitPrice: 10,
  }]);

  assert.equal(
    result.recalculationStatus,
    RECALCULATION_STATUS.PARTIAL
  );
  assert.equal(result.totalOrderAmount, null);
  assert.equal(result.orderedSkuCount, null);
  assert.equal(result.orderedUnits, null);
  assert.equal(result.financialStatus, null);
  assert.deepEqual(
    result.missingFields,
    ['orderLines[0].finalQuantity']
  );
});

test('missing financial aggregates retain order totals as partial', () => {
  const result = recalculate([
    line({ finalQuantity: 2, unitPrice: 10 }),
  ], { currency: 'RUB' });

  assert.equal(
    result.recalculationStatus,
    RECALCULATION_STATUS.PARTIAL
  );
  assert.equal(result.totalOrderAmount, 20);
  assert.equal(result.orderedSkuCount, 1);
  assert.equal(result.orderedUnits, 2);
  assert.equal(result.financialStatus, null);
  assert.deepEqual(result.missingFields, [
    'previousSummary.available_after_expenses',
    'previousSummary.minimum_reserve',
  ]);
});

test('financial status is recalculated from final amount', () => {
  const warning = recalculate([
    line({ finalQuantity: 8, unitPrice: 10 }),
  ]);
  const manual = recalculate([
    line({ finalQuantity: 11, unitPrice: 10 }),
  ]);
  const rejected = recalculate([
    line({ finalQuantity: 21, unitPrice: 10 }),
  ]);

  assert.equal(warning.financialStatus, 'APPROVED_WITH_WARNING');
  assert.equal(manual.financialStatus, 'MANUAL_APPROVAL_REQUIRED');
  assert.equal(rejected.financialStatus, 'REJECTED');
  assert.equal(warning.financiallyPermitted, true);
  assert.equal(manual.financiallyPermitted, false);
  assert.equal(rejected.financiallyPermitted, false);
});

test('inputs are not mutated', () => {
  const input = {
    orderLines: [
      line({ finalQuantity: 2, unitPrice: 10 }),
      line({ finalRecommendation: 'SKIP', finalQuantity: 0 }),
    ],
    previousSummary: previousSummary(),
  };
  const snapshot = structuredClone(input);

  recalculateFinancialSummary(input);

  assert.deepEqual(input, snapshot);
});

test('identical input produces a deterministic result', () => {
  const input = {
    orderLines: [line({ finalQuantity: 2, unitPrice: 10 })],
    previousSummary: previousSummary(),
  };

  const first = recalculateFinancialSummary(input);
  const second = recalculateFinancialSummary(structuredClone(input));

  assert.deepEqual(first, second);
  assert.equal(first.recalculationVersion, RECALCULATION_VERSION);
});
