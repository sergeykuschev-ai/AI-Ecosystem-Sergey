const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  MISKA_FINANCIAL_CONTROLLER_CONFIG,
} = require('../config');
const {
  evaluateFinancialPurchase,
  buildMiskaFinancialInput,
  evaluateMiskaPurchase,
  buildFinancialPurchaseReport,
} = require('../services/financial_controller');

function completeInput(overrides = {}) {
  return {
    cash_balance: 118000,
    bank_balance: 300000,
    expected_revenue: 685899,
    fixed_expenses: {
      rent: 60000,
      payroll: 75000,
      taxes: 39750,
    },
    acquiring_rate: 0.025,
    supplier_debt: 0,
    committed_supplier_payments: 0,
    minimum_reserve: 100000,
    proposed_order_amount: 80000,
    ...overrides,
  };
}

test('Miska defaults contain the approved financial parameters', () => {
  const config = MISKA_FINANCIAL_CONTROLLER_CONFIG;

  assert.equal(config.defaults.cash_balance, 118000);
  assert.equal(config.defaults.bank_balance, 300000);
  assert.equal(config.defaults.expected_revenue, 685899);
  assert.deepEqual(config.defaults.fixed_expenses, {
    rent: 60000,
    payroll: 75000,
    taxes: 39750,
  });
  assert.equal(config.defaults.acquiring_rate, 0.025);
  assert.equal(config.defaults.supplier_debt, 0);
  assert.equal(config.defaults.committed_supplier_payments, 0);
  assert.equal(config.defaults.minimum_reserve, 100000);
  assert.equal(config.warning_reserve_surplus, 30000);
  assert.equal(config.historical_reference.average_revenue, 685899);
  assert.equal(config.historical_reference.median_revenue, 675759);
  assert.equal(config.historical_reference.average_purchasing_spend, 347444);
  assert.equal(config.historical_reference.median_purchasing_spend, 362179);
  assert.deepEqual(config.historical_reference.working_purchasing_range, {
    minimum: 362000,
    maximum: 379000,
  });
});

test('APPROVED preserves reserve with at least 30000 RUB surplus', () => {
  const result = evaluateFinancialPurchase(completeInput({
    proposed_order_amount: 90000,
  }));

  assert.equal(result.status, 'APPROVED');
  assert.equal(result.financially_permitted, true);
  assert.equal(result.manual_approval_required, false);
  assert.equal(result.reserve_surplus, 36102.53);
});

test('APPROVED_WITH_WARNING covers the 103389.40 RUB Miska order', () => {
  const result = evaluateMiskaPurchase(103389.40);

  assert.equal(result.status, 'APPROVED_WITH_WARNING');
  assert.equal(result.total_available_cash, 418000);
  assert.equal(result.fixed_expenses_total, 174750);
  assert.equal(result.estimated_acquiring, 17147.48);
  assert.equal(result.total_mandatory_expenses, 191897.48);
  assert.equal(result.available_after_expenses, 226102.53);
  assert.equal(result.available_after_order, 122713.13);
  assert.equal(result.reserve_surplus, 22713.13);
  assert.equal(result.maximum_safe_order_amount, 126102.53);
  assert.equal(result.financially_permitted, true);
  assert.deepEqual(result.warnings, ['LOW_RESERVE_SURPLUS']);
});

test('MANUAL_APPROVAL_REQUIRED is used for positive liquidity below reserve', () => {
  const result = evaluateFinancialPurchase(completeInput({
    proposed_order_amount: 130000,
  }));

  assert.equal(result.status, 'MANUAL_APPROVAL_REQUIRED');
  assert.equal(result.available_after_order, 96102.53);
  assert.equal(result.reserve_surplus, -3897.48);
  assert.equal(result.financially_permitted, false);
  assert.equal(result.manual_approval_required, true);
});

test('REJECTED is used when the order creates negative liquidity', () => {
  const result = evaluateFinancialPurchase(completeInput({
    proposed_order_amount: 230000,
  }));

  assert.equal(result.status, 'REJECTED');
  assert.equal(result.available_after_order, -3897.48);
  assert.equal(result.reserve_surplus, -103897.48);
  assert.equal(result.financially_permitted, false);
});

test('decision boundaries distinguish warning, manual review, and rejection', () => {
  assert.equal(
    evaluateFinancialPurchase(completeInput({
      proposed_order_amount: 96102.525,
    })).status,
    'APPROVED'
  );
  assert.equal(
    evaluateFinancialPurchase(completeInput({
      proposed_order_amount: 96102.535,
    })).status,
    'APPROVED_WITH_WARNING'
  );
  assert.equal(
    evaluateFinancialPurchase(completeInput({
      proposed_order_amount: 126102.535,
    })).status,
    'MANUAL_APPROVAL_REQUIRED'
  );
  assert.equal(
    evaluateFinancialPurchase(completeInput({
      proposed_order_amount: 226102.535,
    })).status,
    'REJECTED'
  );
});

test('PRELIMINARY preserves missing critical data as null', () => {
  const result = evaluateFinancialPurchase(completeInput({
    bank_balance: null,
    expected_revenue: null,
  }));

  assert.equal(result.status, 'PRELIMINARY');
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing_critical_fields, [
    'bank_balance',
    'expected_revenue',
  ]);
  assert.equal(result.inputs.bank_balance, null);
  assert.equal(result.inputs.expected_revenue, null);
  assert.equal(result.total_available_cash, null);
  assert.equal(result.estimated_acquiring, null);
  assert.equal(result.total_mandatory_expenses, null);
  assert.equal(result.available_after_order, null);
  assert.equal(result.maximum_safe_order_amount, null);
  assert.equal(result.financially_permitted, false);
});

test('fixed expenses support named array items and all values round to cents', () => {
  const result = evaluateFinancialPurchase(completeInput({
    fixed_expenses: [
      { name: 'rent', amount: 60000.004 },
      { name: 'payroll', amount: 75000.005 },
      { name: 'taxes', amount: 39750.006 },
    ],
    proposed_order_amount: 103389.404,
  }));

  assert.deepEqual(result.inputs.fixed_expenses, [
    { name: 'rent', amount: 60000 },
    { name: 'payroll', amount: 75000.01 },
    { name: 'taxes', amount: 39750.01 },
  ]);
  assert.equal(result.inputs.proposed_order_amount, 103389.4);
  for (const field of [
    'total_available_cash',
    'estimated_acquiring',
    'total_mandatory_expenses',
    'available_after_expenses',
    'available_after_order',
    'reserve_surplus',
    'maximum_safe_order_amount',
  ]) {
    assert.equal(result[field], Math.round(result[field] * 100) / 100);
  }
});

test('rejects invalid present values instead of fabricating a result', () => {
  assert.throws(
    () => evaluateFinancialPurchase(completeInput({ cash_balance: -1 })),
    /cash_balance must be a finite non-negative number/
  );
  assert.throws(
    () => evaluateFinancialPurchase(completeInput({ acquiring_rate: 2.5 })),
    /acquiring_rate must be a fraction between 0 and 1/
  );
  assert.throws(
    () => evaluateFinancialPurchase(completeInput({
      fixed_expenses: { rent: Number.NaN },
    })),
    /fixed_expenses\.rent must be a finite non-negative number/
  );
});

test('controller does not mutate input or enable aggressive mode', () => {
  const input = completeInput();
  const before = structuredClone(input);
  const result = evaluateFinancialPurchase(input);

  assert.deepEqual(input, before);
  assert.equal(result.automatic_aggressive_mode_allowed, false);
  assert.equal(result.order_composition_changed, false);
});

test('Miska input builder accepts explicit null without replacing it by a default', () => {
  const input = buildMiskaFinancialInput(103389.40, { bank_balance: null });
  const result = evaluateFinancialPurchase(input);

  assert.equal(input.bank_balance, null);
  assert.equal(result.status, 'PRELIMINARY');
  assert.deepEqual(result.missing_critical_fields, ['bank_balance']);
});

test('Russian report shows the complete approved-with-warning calculation', () => {
  const result = evaluateMiskaPurchase(103389.40);
  const report = buildFinancialPurchaseReport(result);

  assert.ok(report.includes('# Финансовый контроль закупки магазина «Миска»'));
  assert.ok(report.includes('Статус: **APPROVED_WITH_WARNING**'));
  assert.ok(report.includes('Общая доступная ликвидность'));
  assert.ok(report.includes('Оценка эквайринга'));
  assert.ok(report.includes('Запас сверх минимального резерва'));
  assert.match(report, /После оплаты заказа: 122\s713,13 RUB/);
  assert.match(report, /Максимальная безопасная сумма заказа: 126\s102,53 RUB/);
  assert.ok(report.includes('Состав и количество товаров не изменялись'));
  assert.ok(report.includes('Агрессивный режим автоматически не включается'));
});

test('Russian preliminary report lists missing fields without fake amounts', () => {
  const result = evaluateFinancialPurchase(completeInput({
    cash_balance: null,
  }));
  const report = buildFinancialPurchaseReport(result);

  assert.ok(report.includes('Статус: **PRELIMINARY**'));
  assert.ok(report.includes('Недостающие критические данные: cash_balance'));
  assert.ok(report.includes('Наличные: нет данных'));
  assert.ok(report.includes('Общая доступная ликвидность: нет данных'));
});
