const {
  MISKA_FINANCIAL_CONTROLLER_CONFIG,
} = require('../config');

const FINANCIAL_DECISION_STATUSES = Object.freeze([
  'PRELIMINARY',
  'APPROVED',
  'APPROVED_WITH_WARNING',
  'MANUAL_APPROVAL_REQUIRED',
  'REJECTED',
]);

const CRITICAL_INPUT_FIELDS = Object.freeze([
  'cash_balance',
  'bank_balance',
  'expected_revenue',
  'fixed_expenses',
  'acquiring_rate',
  'supplier_debt',
  'committed_supplier_payments',
  'minimum_reserve',
  'proposed_order_amount',
]);

function roundMoney(value) {
  if (value === null || value === undefined) return null;
  const sign = Math.sign(value) || 1;
  const absoluteShifted = Math.abs(value) * 100;
  const floatingPointTolerance = Number.EPSILON * absoluteShifted * 4;
  return sign * (Math.round(absoluteShifted + floatingPointTolerance) / 100);
}

function isMissing(value) {
  return value === null || value === undefined;
}

function assertNonNegativeFinite(field, value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a finite non-negative number.`);
  }
}

function normalizeFixedExpenses(fixedExpenses) {
  if (typeof fixedExpenses === 'number') {
    assertNonNegativeFinite('fixed_expenses', fixedExpenses);
    return [{ name: 'total', amount: fixedExpenses }];
  }

  if (Array.isArray(fixedExpenses)) {
    return fixedExpenses.map((expense, index) => {
      if (!expense || typeof expense !== 'object' || Array.isArray(expense)) {
        throw new TypeError(
          `fixed_expenses[${index}] must be an object with name and amount.`
        );
      }
      const name = String(expense.name || '').trim();
      if (!name) {
        throw new TypeError(`fixed_expenses[${index}].name is required.`);
      }
      assertNonNegativeFinite(`fixed_expenses[${index}].amount`, expense.amount);
      return { name, amount: expense.amount };
    });
  }

  if (typeof fixedExpenses === 'object' && fixedExpenses !== null) {
    return Object.entries(fixedExpenses).map(([name, amount]) => {
      const normalizedName = String(name).trim();
      if (!normalizedName) {
        throw new TypeError('fixed_expenses contains an empty expense name.');
      }
      assertNonNegativeFinite(`fixed_expenses.${normalizedName}`, amount);
      return { name: normalizedName, amount };
    });
  }

  throw new TypeError(
    'fixed_expenses must be a non-negative number, an object, or an array of { name, amount }.'
  );
}

function validateKnownInputs(input, missingFields) {
  const numericFields = CRITICAL_INPUT_FIELDS.filter(
    field => field !== 'fixed_expenses'
  );
  for (const field of numericFields) {
    if (!missingFields.includes(field)) {
      assertNonNegativeFinite(field, input[field]);
    }
  }

  if (!missingFields.includes('acquiring_rate') && input.acquiring_rate > 1) {
    throw new TypeError('acquiring_rate must be a fraction between 0 and 1.');
  }
}

function calculateFinancialValues(input, fixedExpenses) {
  const totalAvailableCash = !isMissing(input.cash_balance) &&
    !isMissing(input.bank_balance)
    ? input.cash_balance + input.bank_balance
    : null;
  const estimatedAcquiring = !isMissing(input.expected_revenue) &&
    !isMissing(input.acquiring_rate)
    ? input.expected_revenue * input.acquiring_rate
    : null;
  const fixedExpensesTotal = fixedExpenses
    ? fixedExpenses.reduce((sum, expense) => sum + expense.amount, 0)
    : null;
  const totalMandatoryExpenses = fixedExpensesTotal !== null &&
    estimatedAcquiring !== null
    ? fixedExpensesTotal + estimatedAcquiring
    : null;
  const availableAfterExpenses = totalAvailableCash !== null &&
    totalMandatoryExpenses !== null &&
    !isMissing(input.supplier_debt) &&
    !isMissing(input.committed_supplier_payments)
    ? totalAvailableCash - totalMandatoryExpenses - input.supplier_debt -
      input.committed_supplier_payments
    : null;
  const availableAfterOrder = availableAfterExpenses !== null &&
    !isMissing(input.proposed_order_amount)
    ? availableAfterExpenses - input.proposed_order_amount
    : null;
  const reserveSurplus = availableAfterOrder !== null &&
    !isMissing(input.minimum_reserve)
    ? availableAfterOrder - input.minimum_reserve
    : null;
  const maximumSafeOrderAmount = availableAfterExpenses !== null &&
    !isMissing(input.minimum_reserve)
    ? availableAfterExpenses - input.minimum_reserve
    : null;

  return {
    total_available_cash: roundMoney(totalAvailableCash),
    fixed_expenses_total: roundMoney(fixedExpensesTotal),
    estimated_acquiring: roundMoney(estimatedAcquiring),
    total_mandatory_expenses: roundMoney(totalMandatoryExpenses),
    available_after_expenses: roundMoney(availableAfterExpenses),
    available_after_order: roundMoney(availableAfterOrder),
    reserve_surplus: roundMoney(reserveSurplus),
    maximum_safe_order_amount: roundMoney(maximumSafeOrderAmount),
  };
}

function financialDecision(values, warningThreshold) {
  if (values.available_after_order < 0) {
    return {
      status: 'REJECTED',
      decision_reason: 'negative_liquidity_after_order',
      warnings: ['NEGATIVE_LIQUIDITY_AFTER_ORDER'],
    };
  }

  if (values.reserve_surplus < 0) {
    return {
      status: 'MANUAL_APPROVAL_REQUIRED',
      decision_reason: 'minimum_reserve_breached_with_non_negative_liquidity',
      warnings: ['MINIMUM_RESERVE_BREACH'],
    };
  }

  if (values.reserve_surplus < warningThreshold) {
    return {
      status: 'APPROVED_WITH_WARNING',
      decision_reason: 'minimum_reserve_preserved_with_low_surplus',
      warnings: ['LOW_RESERVE_SURPLUS'],
    };
  }

  return {
    status: 'APPROVED',
    decision_reason: 'minimum_reserve_preserved',
    warnings: [],
  };
}

function evaluateFinancialPurchase(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Financial controller input must be an object.');
  }

  const missingCriticalFields = CRITICAL_INPUT_FIELDS.filter(field =>
    isMissing(input[field])
  );
  validateKnownInputs(input, missingCriticalFields);

  const fixedExpenses = missingCriticalFields.includes('fixed_expenses')
    ? null
    : normalizeFixedExpenses(input.fixed_expenses);
  const warningThreshold = options.warning_reserve_surplus ??
    MISKA_FINANCIAL_CONTROLLER_CONFIG.warning_reserve_surplus;
  assertNonNegativeFinite('warning_reserve_surplus', warningThreshold);
  const values = calculateFinancialValues(input, fixedExpenses);

  const decision = missingCriticalFields.length > 0
    ? {
      status: 'PRELIMINARY',
      decision_reason: 'critical_financial_data_missing',
      warnings: ['MISSING_CRITICAL_FINANCIAL_DATA'],
    }
    : financialDecision(values, warningThreshold);
  const financiallyPermitted = [
    'APPROVED',
    'APPROVED_WITH_WARNING',
  ].includes(decision.status);

  return {
    schema_version: 'purchasing-financial-controller-result-v1',
    controller_version: MISKA_FINANCIAL_CONTROLLER_CONFIG.version,
    currency: options.currency || MISKA_FINANCIAL_CONTROLLER_CONFIG.currency,
    status: decision.status,
    decision_reason: decision.decision_reason,
    complete: missingCriticalFields.length === 0,
    financially_permitted: financiallyPermitted,
    manual_approval_required: decision.status === 'MANUAL_APPROVAL_REQUIRED',
    automatic_aggressive_mode_allowed: false,
    order_composition_changed: false,
    missing_critical_fields: missingCriticalFields,
    warnings: decision.warnings,
    inputs: {
      cash_balance: isMissing(input.cash_balance) ? null : roundMoney(input.cash_balance),
      bank_balance: isMissing(input.bank_balance) ? null : roundMoney(input.bank_balance),
      expected_revenue: isMissing(input.expected_revenue)
        ? null
        : roundMoney(input.expected_revenue),
      fixed_expenses: fixedExpenses
        ? fixedExpenses.map(expense => ({
          name: expense.name,
          amount: roundMoney(expense.amount),
        }))
        : null,
      acquiring_rate: isMissing(input.acquiring_rate) ? null : input.acquiring_rate,
      supplier_debt: isMissing(input.supplier_debt)
        ? null
        : roundMoney(input.supplier_debt),
      committed_supplier_payments: isMissing(input.committed_supplier_payments)
        ? null
        : roundMoney(input.committed_supplier_payments),
      minimum_reserve: isMissing(input.minimum_reserve)
        ? null
        : roundMoney(input.minimum_reserve),
      proposed_order_amount: isMissing(input.proposed_order_amount)
        ? null
        : roundMoney(input.proposed_order_amount),
    },
    warning_reserve_surplus_threshold: roundMoney(warningThreshold),
    ...values,
  };
}

function buildMiskaFinancialInput(proposedOrderAmount, overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('Miska financial overrides must be an object.');
  }
  const defaults = MISKA_FINANCIAL_CONTROLLER_CONFIG.defaults;
  return {
    ...defaults,
    ...overrides,
    fixed_expenses: Object.hasOwn(overrides, 'fixed_expenses')
      ? overrides.fixed_expenses
      : { ...defaults.fixed_expenses },
    proposed_order_amount: proposedOrderAmount,
  };
}

function evaluateMiskaPurchase(proposedOrderAmount, overrides = {}) {
  return evaluateFinancialPurchase(
    buildMiskaFinancialInput(proposedOrderAmount, overrides),
    {
      currency: MISKA_FINANCIAL_CONTROLLER_CONFIG.currency,
      warning_reserve_surplus:
        MISKA_FINANCIAL_CONTROLLER_CONFIG.warning_reserve_surplus,
    }
  );
}

function formatMoneyRu(value) {
  if (value === null || value === undefined) return 'нет данных';
  return `${new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} RUB`;
}

function statusText(result) {
  const messages = {
    PRELIMINARY: 'Предварительный результат: не хватает критических данных.',
    APPROVED: 'Заказ разрешён: минимальный резерв сохранён.',
    APPROVED_WITH_WARNING:
      `Заказ разрешён с предупреждением: резерв сохранён, но запас над ним меньше ${formatMoneyRu(
        result.warning_reserve_surplus_threshold
      )}.`,
    MANUAL_APPROVAL_REQUIRED:
      'Требуется ручное согласование: ликвидность остаётся положительной, но минимальный резерв нарушен.',
    REJECTED: 'Заказ отклонён: после оплаты возникает отрицательная ликвидность.',
  };
  return messages[result.status];
}

function expenseNameRu(name) {
  const names = {
    rent: 'Аренда',
    payroll: 'Заработная плата',
    taxes: 'Налоги',
  };
  return names[name] || name;
}

function buildFinancialPurchaseReport(result) {
  if (!result || typeof result !== 'object' ||
      !FINANCIAL_DECISION_STATUSES.includes(result.status)) {
    throw new TypeError('Financial report requires a controller result.');
  }

  const fixedExpenseLines = result.inputs.fixed_expenses
    ? result.inputs.fixed_expenses.map(expense =>
      `- ${expenseNameRu(expense.name)}: ${formatMoneyRu(expense.amount)}`
    )
    : ['- постоянные расходы: нет данных'];
  const missingLine = result.missing_critical_fields.length > 0
    ? `\nНедостающие критические данные: ${result.missing_critical_fields.join(', ')}.\n`
    : '';

  return [
    '# Финансовый контроль закупки магазина «Миска»',
    '',
    `Статус: **${result.status}**`,
    '',
    statusText(result),
    missingLine,
    '## Исходные данные',
    '',
    `- Наличные: ${formatMoneyRu(result.inputs.cash_balance)}`,
    `- Банковский счёт: ${formatMoneyRu(result.inputs.bank_balance)}`,
    `- Ожидаемая выручка: ${formatMoneyRu(result.inputs.expected_revenue)}`,
    `- Эквайринг: ${result.inputs.acquiring_rate === null
      ? 'нет данных'
      : `${(result.inputs.acquiring_rate * 100).toFixed(2).replace('.', ',')}%`}`,
    ...fixedExpenseLines,
    `- Долг поставщикам: ${formatMoneyRu(result.inputs.supplier_debt)}`,
    `- Уже согласованные платежи поставщикам: ${formatMoneyRu(
      result.inputs.committed_supplier_payments
    )}`,
    `- Минимальный резерв: ${formatMoneyRu(result.inputs.minimum_reserve)}`,
    `- Сумма заказа: ${formatMoneyRu(result.inputs.proposed_order_amount)}`,
    '',
    '## Расчёт',
    '',
    `- Общая доступная ликвидность: ${formatMoneyRu(result.total_available_cash)}`,
    `- Постоянные расходы: ${formatMoneyRu(result.fixed_expenses_total)}`,
    `- Оценка эквайринга: ${formatMoneyRu(result.estimated_acquiring)}`,
    `- Все обязательные расходы: ${formatMoneyRu(result.total_mandatory_expenses)}`,
    `- После расходов и обязательств поставщикам: ${formatMoneyRu(
      result.available_after_expenses
    )}`,
    `- После оплаты заказа: ${formatMoneyRu(result.available_after_order)}`,
    `- Запас сверх минимального резерва: ${formatMoneyRu(result.reserve_surplus)}`,
    `- Максимальная безопасная сумма заказа: ${formatMoneyRu(
      result.maximum_safe_order_amount
    )}`,
    '',
    '## Ограничения',
    '',
    '- Состав и количество товаров не изменялись.',
    '- Агрессивный режим автоматически не включается.',
    '- Контролёр не создаёт и не отправляет заказ поставщику.',
  ].join('\n');
}

function financialRecommendation(result) {
  if (result.status === 'PRELIMINARY') {
    return 'Товарный расчёт выполнен, но финансовое решение не подтверждено.';
  }
  if (result.status === 'APPROVED') {
    return 'Заказ укладывается в безопасный бюджет и сохраняет установленный резерв.';
  }
  if (result.status === 'APPROVED_WITH_WARNING') {
    return 'Заказ разрешён, но запас сверх минимального резерва меньше 30 000 RUB.';
  }

  const budgetExcess = roundMoney(Math.max(
    0,
    result.inputs.proposed_order_amount - result.maximum_safe_order_amount
  ));
  const ownerAction = `Для соблюдения установленного резерва заказ необходимо сократить минимум на ${formatMoneyRu(
    budgetExcess
  )} либо согласовать вручную`;
  return result.status === 'REJECTED'
    ? `После оплаты заказа ликвидность становится отрицательной. ${ownerAction}.`
    : `Минимальный резерв нарушается. ${ownerAction}.`;
}

function buildAgentFinancialSection(assessment) {
  const missingFields = assessment.missing_fields.length > 0
    ? assessment.missing_fields.join(', ')
    : 'нет';

  return [
    '## ФИНАНСОВАЯ ПРОВЕРКА ЗАКАЗА',
    '',
    `- Сумма заказа: ${formatMoneyRu(assessment.proposed_order_amount)}`,
    `- Статус проверки: **${assessment.status}**`,
    `- Доступная ликвидность: ${formatMoneyRu(assessment.total_available_cash)}`,
    `- Обязательные расходы: ${formatMoneyRu(assessment.total_mandatory_expenses)}`,
    `- Остаток после расходов: ${formatMoneyRu(assessment.available_after_expenses)}`,
    `- Остаток после заказа: ${formatMoneyRu(assessment.available_after_order)}`,
    `- Минимальный резерв: ${formatMoneyRu(assessment.minimum_reserve)}`,
    `- Запас сверх резерва: ${formatMoneyRu(assessment.reserve_surplus)}`,
    `- Максимальный безопасный заказ: ${formatMoneyRu(
      assessment.maximum_safe_order_amount
    )}`,
    `- Недостающие финансовые данные: ${missingFields}`,
    '- Агрессивный режим: отключён',
    '',
    `Решение для владельца: ${assessment.recommendation}`,
    '',
    'Финансовая проверка носит рекомендательный характер и не меняет состав или количество товаров в заказе.',
  ].join('\n');
}

function buildPurchasingFinancialAssessment(proposedOrderAmount, financialData = null) {
  if (financialData !== null &&
      (typeof financialData !== 'object' || Array.isArray(financialData))) {
    throw new TypeError('financialData must be an object or null.');
  }

  const financialInput = Object.fromEntries(
    CRITICAL_INPUT_FIELDS.map(field => [field, null])
  );
  if (financialData) Object.assign(financialInput, financialData);

  // The order total is authoritative and cannot be overridden by financial input.
  financialInput.proposed_order_amount = proposedOrderAmount;

  const result = evaluateFinancialPurchase(financialInput, {
    currency: MISKA_FINANCIAL_CONTROLLER_CONFIG.currency,
    warning_reserve_surplus:
      MISKA_FINANCIAL_CONTROLLER_CONFIG.warning_reserve_surplus,
  });
  const budgetExcess = result.maximum_safe_order_amount === null
    ? null
    : roundMoney(Math.max(
      0,
      result.inputs.proposed_order_amount - result.maximum_safe_order_amount
    ));
  const assessment = {
    schema_version: 'purchasing-financial-assessment-v1',
    controller_version: result.controller_version,
    store_profile: MISKA_FINANCIAL_CONTROLLER_CONFIG.store_profile,
    currency: result.currency,
    advisory_only: true,
    status: result.status,
    proposed_order_amount: result.inputs.proposed_order_amount,
    total_available_cash: result.total_available_cash,
    total_mandatory_expenses: result.total_mandatory_expenses,
    available_after_expenses: result.available_after_expenses,
    available_after_order: result.available_after_order,
    minimum_reserve: result.inputs.minimum_reserve,
    reserve_surplus: result.reserve_surplus,
    maximum_safe_order_amount: result.maximum_safe_order_amount,
    safe_budget_excess: budgetExcess,
    missing_fields: result.missing_critical_fields,
    aggressive_mode: false,
    financially_permitted: result.financially_permitted,
    order_composition_changed: false,
    recommendation: financialRecommendation(result),
  };

  return {
    ...assessment,
    report_text: buildAgentFinancialSection(assessment),
  };
}

module.exports = {
  FINANCIAL_DECISION_STATUSES,
  CRITICAL_INPUT_FIELDS,
  roundMoney,
  evaluateFinancialPurchase,
  buildMiskaFinancialInput,
  evaluateMiskaPurchase,
  buildFinancialPurchaseReport,
  buildPurchasingFinancialAssessment,
  buildAgentFinancialSection,
};
