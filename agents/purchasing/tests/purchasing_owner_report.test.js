const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  buildPurchasingOwnerReport,
  formatMoney,
} = require('../../../shared/reporting/purchasing_owner_report');

function agentJson(overrides = {}) {
  return {
    product_rows_count: 17,
    preliminary_order_sum: 999,
    mustBuyCount: 1,
    recommendedCount: 2,
    manualReviewCount: 3,
    postponeCount: 4,
    doNotBuyCount: 7,
    minmax_text: '# ИСХОДНЫЙ ОТЧЁТ\nСодержимое Min/Max.\n',
    financial_assessment: {
      proposed_order_amount: 1234.5,
      status: 'PRELIMINARY',
      recommendation: 'Требуется решение владельца',
      financial_data_errors: ['Нет актуального остатка денежных средств'],
      missing_fields: ['cash_balance'],
    },
    adapter_diagnostics: {
      missingRequiredColumns: ['stock'],
    },
    ...overrides,
  };
}

test('builds the purchasing owner report with required run and issue data', () => {
  const report = buildPurchasingOwnerReport({
    agentJson: agentJson(),
    store: 'Миска Тест',
    runDate: '2026-07-28',
    inputFileName: 'smart-zapas.xlsx',
    warnings: ['Неоднозначный столбец продаж'],
  });

  assert.ok(report.includes('ОТЧЁТ ВЛАДЕЛЬЦУ — МАГАЗИН «Миска Тест»'));
  assert.ok(report.includes('Дата запуска: 2026-07-28'));
  assert.ok(report.includes('Входной файл: smart-zapas.xlsx'));
  assert.ok(report.includes('Итоговая сумма заказа: 1\u00a0234,50 RUB'));
  assert.ok(report.includes('Товарных строк: 17'));
  assert.ok(report.includes('Статус финансовой оценки: PRELIMINARY'));
  assert.ok(report.includes('- Неоднозначный столбец продаж'));
  assert.ok(report.includes('- Нет актуального остатка денежных средств'));
  assert.ok(report.includes(
    '- Финансовое решение не подтверждено; отсутствуют поля: cash_balance'
  ));
  assert.ok(report.includes('- Отсутствуют обязательные столбцы: 1'));
});

test('reports no warnings and no critical problems when both are absent', () => {
  const report = buildPurchasingOwnerReport({
    agentJson: agentJson({
      financial_assessment: {
        proposed_order_amount: 1234.5,
        status: 'APPROVED',
        recommendation: 'Можно закупать',
      },
      adapter_diagnostics: {},
    }),
    store: 'Миска',
    runDate: '2026-07-28',
    inputFileName: 'smart-zapas.xlsx',
    warnings: [],
  });

  assert.ok(report.includes(
    'Предупреждения:\n- нет\n\nКритические проблемы:\n- нет'
  ));
});

test('formats money exactly as the existing purchasing report', () => {
  assert.equal(formatMoney(1234567.8), '1\u00a0234\u00a0567,80 RUB');
  assert.equal(formatMoney(null), 'нет данных');
});
