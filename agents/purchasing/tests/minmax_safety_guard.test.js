const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  applyMinMaxSafetyGuard,
  shouldInferConfirmedZero,
} = require('../services/minmax_safety_guard');

function row(overrides = {}) {
  return {
    rowIdentity: 'smartzapas:test:1',
    rowNumber: 100,
    article: '2548375',
    name: 'Сухой корм Ферма кота Федора 650 г',
    supplier: 'АО "ВАЛТА ПЕТ ПРОДАКТС"',
    abc: 'A',
    xyz: 'X',
    freeStock: null,
    stockDays: 0,
    orderQty: 0,
    reportedSalesQuantity: 12,
    sales7: 1,
    sales14: 2,
    sales28: 4,
    sourceTokens: { freeStock: null },
    weeklySalesHistory: [],
    ...overrides,
  };
}

function adapter(rows) {
  return {
    rows,
    source: { sourceRowsCount: rows.length },
    diagnostics: {},
  };
}

test('infers confirmed zero when SmartZapas leaves free stock blank but stock days are zero and sales are positive', () => {
  assert.equal(shouldInferConfirmedZero(row()), true);

  const result = applyMinMaxSafetyGuard(adapter([row()]));

  assert.equal(result.rows[0].freeStock, 0);
  assert.equal(result.rows[0].stockInference.status, 'confirmed_zero_inferred');
  assert.deepEqual(result.rows[0].safetyWarnings, ['FREE_STOCK_BLANK_INFERRED_ZERO']);
  assert.equal(result.diagnostics.minMaxSafety.inferredZeroStockCount, 1);
  assert.equal(
    result.diagnostics.minMaxSafety.zeroStockWithSalesButNoSourceOrderCount,
    1
  );
});

test('does not infer zero when stock days do not confirm zero', () => {
  const source = row({ stockDays: 12 });
  const result = applyMinMaxSafetyGuard(adapter([source]));

  assert.strictEqual(result.rows[0], source);
  assert.equal(result.diagnostics.minMaxSafety.inferredZeroStockCount, 0);
});

test('does not infer zero without positive sales evidence', () => {
  const source = row({
    reportedSalesQuantity: 0,
    sales7: 0,
    sales14: 0,
    sales28: 0,
  });
  const result = applyMinMaxSafetyGuard(adapter([source]));

  assert.strictEqual(result.rows[0], source);
  assert.equal(result.diagnostics.minMaxSafety.inferredZeroStockCount, 0);
});

test('preserves an explicit free-stock value', () => {
  const source = row({ freeStock: 5, stockDays: 12, sourceTokens: { freeStock: 5 } });
  const result = applyMinMaxSafetyGuard(adapter([source]));

  assert.strictEqual(result.rows[0], source);
  assert.equal(result.diagnostics.minMaxSafety.inferredZeroStockCount, 0);
});

test('flags source order zero so downstream demand calculation cannot silently trust it', () => {
  const result = applyMinMaxSafetyGuard(adapter([row({ orderQty: null })]));
  const diagnostic = result.diagnostics.minMaxSafety.zeroStockWithSalesButNoSourceOrder[0];

  assert.equal(diagnostic.warning, 'ZERO_STOCK_WITH_SALES_BUT_NO_SOURCE_ORDER');
  assert.match(diagnostic.action, /recalculate_with_demand_engine/);
});
