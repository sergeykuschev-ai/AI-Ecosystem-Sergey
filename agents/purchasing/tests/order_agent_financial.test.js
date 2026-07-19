const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  adaptSmartZapasMatrix,
} = require('../adapters/smartzapas_adapter');
const {
  runOrderAgent,
  runOrderAgentFromAdapterResult,
} = require('../order_agent');

function legacyOrderItems({ price = 10, quantity = 2 } = {}) {
  return [{
    json: {
      Наименование: 'Synthetic financial-control product',
      Артикул: 'FIN-1',
      'Основной поставщик': 'Synthetic Supplier',
      Цена: price,
      'Заказать у поставщика': quantity,
      'Свободный остаток': 0,
    },
  }];
}

function financialDataForStatus(status) {
  const totalCashByStatus = {
    APPROVED: 40000,
    APPROVED_WITH_WARNING: 130,
    MANUAL_APPROVAL_REQUIRED: 110,
    REJECTED: 10,
  };
  return {
    cash_balance: totalCashByStatus[status],
    bank_balance: 0,
    expected_revenue: 0,
    fixed_expenses: 0,
    acquiring_rate: 0,
    supplier_debt: 0,
    committed_supplier_payments: 0,
    minimum_reserve: 100,
  };
}

test('agent remains usable without financial data and returns PRELIMINARY', () => {
  const json = runOrderAgent(legacyOrderItems())[0].json;
  const assessment = json.financial_assessment;

  assert.equal(json.order_rows_count, 1);
  assert.equal(json.preliminary_order_sum, 20);
  assert.equal(assessment.status, 'PRELIMINARY');
  assert.equal(assessment.proposed_order_amount, 20);
  assert.equal(assessment.total_available_cash, null);
  assert.equal(assessment.minimum_reserve, null);
  assert.deepEqual(assessment.missing_fields, [
    'cash_balance',
    'bank_balance',
    'expected_revenue',
    'fixed_expenses',
    'acquiring_rate',
    'supplier_debt',
    'committed_supplier_payments',
    'minimum_reserve',
  ]);
  assert.ok(json.minmax_text.includes('## ФИНАНСОВАЯ ПРОВЕРКА ЗАКАЗА'));
  assert.ok(json.minmax_text.includes(
    'Товарный расчёт выполнен, но финансовое решение не подтверждено.'
  ));
});

for (const status of [
  'APPROVED',
  'APPROVED_WITH_WARNING',
  'MANUAL_APPROVAL_REQUIRED',
  'REJECTED',
]) {
  test(`agent exposes ${status} as an advisory financial status`, () => {
    const json = runOrderAgent(legacyOrderItems(), {
      financialData: financialDataForStatus(status),
    })[0].json;

    assert.equal(json.financial_assessment.status, status);
    assert.equal(json.financial_assessment.proposed_order_amount, 20);
    assert.equal(json.financial_assessment.aggressive_mode, false);
    assert.equal(json.financial_assessment.order_composition_changed, false);
  });
}

test('manual and rejected assessments expose safe-budget excess guidance', () => {
  for (const status of ['MANUAL_APPROVAL_REQUIRED', 'REJECTED']) {
    const assessment = runOrderAgent(legacyOrderItems(), {
      financialData: financialDataForStatus(status),
    })[0].json.financial_assessment;

    assert.ok(assessment.safe_budget_excess > 0);
    assert.ok(assessment.recommendation.includes(
      'Для соблюдения установленного резерва заказ необходимо сократить минимум на'
    ));
    assert.ok(assessment.recommendation.includes('либо согласовать вручную'));
  }
});

test('Miska example order produces the expected warning and reserve surplus', () => {
  const json = runOrderAgent(legacyOrderItems({
    price: 103389.40,
    quantity: 1,
  }), {
    financialData: {
      cash_balance: 118000,
      bank_balance: 300000,
      expected_revenue: 685899.16,
      fixed_expenses: 174750,
      acquiring_rate: 0.025,
      supplier_debt: 0,
      committed_supplier_payments: 0,
      minimum_reserve: 100000,
      proposed_order_amount: 1,
    },
  })[0].json;
  const assessment = json.financial_assessment;

  assert.equal(assessment.status, 'APPROVED_WITH_WARNING');
  assert.equal(assessment.proposed_order_amount, 103389.40);
  assert.equal(assessment.total_available_cash, 418000);
  assert.equal(assessment.total_mandatory_expenses, 191897.48);
  assert.equal(assessment.available_after_order, 122713.12);
  assert.equal(assessment.reserve_surplus, 22713.12);
  assert.equal(assessment.maximum_safe_order_amount, 126102.52);
  assert.ok(json.minmax_text.includes('Статус проверки: **APPROVED_WITH_WARNING**'));
  assert.match(json.minmax_text, /Запас сверх резерва: 22\s713,12 RUB/);
});

test('financial rejection does not change product quantities or Phase 1 decisions', () => {
  const fixturePath = path.resolve(
    __dirname,
    '../../../tests/fixtures/SmartZapas_sanitized.json'
  );
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const adapterResult = adaptSmartZapasMatrix(fixture.matrix, {
    sheetName: fixture.sheetName,
  });
  const preliminary = runOrderAgentFromAdapterResult(adapterResult)[0].json;
  const rejected = runOrderAgentFromAdapterResult(adapterResult, {
    financialData: financialDataForStatus('REJECTED'),
  })[0].json;

  assert.equal(rejected.financial_assessment.status, 'REJECTED');
  assert.equal(rejected.order_rows_count, preliminary.order_rows_count);
  assert.equal(rejected.preliminary_order_sum, preliminary.preliminary_order_sum);
  assert.deepEqual(rejected.decisions, preliminary.decisions);
  assert.equal(rejected.mustBuyCount, preliminary.mustBuyCount);
  assert.equal(rejected.recommendedCount, preliminary.recommendedCount);
  assert.equal(rejected.manualReviewCount, preliminary.manualReviewCount);
  assert.equal(rejected.postponeCount, preliminary.postponeCount);
  assert.equal(rejected.doNotBuyCount, preliminary.doNotBuyCount);
});
