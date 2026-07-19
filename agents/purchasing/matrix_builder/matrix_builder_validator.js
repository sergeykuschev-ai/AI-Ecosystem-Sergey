const fs = require('node:fs');
const path = require('node:path');

const { normalizedArticle, normalizedName } = require(
  '../services/assortment_matrix_loader'
);

const MATRIX_ROLES = Object.freeze([
  'CORE',
  'TRAFFIC',
  'PROFIT',
  'IMAGE',
  'SEASONAL',
  'NEW',
  'OPTIONAL',
  'EXIT',
  'UNCLASSIFIED',
]);
const MATRIX_PRIORITIES = Object.freeze([
  'critical',
  'important',
  'standard',
  'review',
]);
const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);
const REASON_CODES = Object.freeze([
  'existing_matrix_policy',
  'stable_sales',
  'high_abc_rank',
  'stable_xyz_rank',
  'regular_weekly_sales',
  'supplier_recommends_order',
  'below_expected_stock',
  'strategic_brand_group',
  'insufficient_sales_history',
  'missing_inventory_data',
  'missing_stable_identifier',
  'ambiguous_identity',
  'possible_new_product',
  'possible_exit_candidate',
  'excess_stock',
  'irregular_sales',
  'no_completed_week_sales',
  'policy_requires_confirmation',
  'role_requires_margin_data',
  'seasonality_not_confirmed',
]);

const REASON_EXPLANATIONS = Object.freeze({
  existing_matrix_policy: 'Сохранена политика из действующей ассортиментной матрицы.',
  stable_sales: 'Завершённые недели подтверждают устойчивый спрос.',
  high_abc_rank: 'Товар относится к значимому ABC-классу A или B.',
  stable_xyz_rank: 'XYZ-класс X или Y указывает на более предсказуемый спрос.',
  regular_weekly_sales: 'Продажи присутствуют в нескольких завершённых неделях.',
  supplier_recommends_order: 'В SmartZapas указано положительное количество к заказу.',
  below_expected_stock: 'Текущий свободный остаток ниже автоматически рассчитанной цели.',
  strategic_brand_group: 'Товар точно сопоставлен с настроенной стратегической группой.',
  insufficient_sales_history: 'Недостаточно надёжных завершённых недель для полной политики.',
  missing_inventory_data: 'Отсутствуют необходимые складские показатели.',
  missing_stable_identifier: 'Нет стабильного идентификатора для безопасного переноса политики между отчётами.',
  ambiguous_identity: 'Идентификатор товара повторяется или сопоставление неоднозначно.',
  possible_new_product: 'История короткая и товар может быть новинкой; требуется подтверждение.',
  possible_exit_candidate: 'Слабая классификация, отсутствие продаж и запас требуют проверки вывода.',
  excess_stock: 'SmartZapas показывает положительный избыточный остаток.',
  irregular_sales: 'Продажи нерегулярны по завершённым неделям.',
  no_completed_week_sales: 'В надёжных завершённых неделях подтверждены нулевые продажи.',
  policy_requires_confirmation: 'Автоматическое предложение требует подтверждения владельца.',
  role_requires_margin_data: 'Для роли PROFIT нет подтверждённых данных о марже.',
  seasonality_not_confirmed: 'Сезонность не подтверждена настройкой или достаточной историей.',
});

class MatrixBuilderError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MatrixBuilderError';
    this.code = code;
  }
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MatrixBuilderError(
      `${fieldName} должен быть JSON-объектом.`,
      'INVALID_CONFIG'
    );
  }
  return value;
}

function requireNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MatrixBuilderError(
      `${fieldName} должен быть непустой строкой.`,
      'INVALID_CONFIG'
    );
  }
  return value.trim();
}

function requireNonNegativeNumber(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new MatrixBuilderError(
      `${fieldName} должен быть конечным числом не меньше нуля.`,
      'INVALID_CONFIG'
    );
  }
  return value;
}

function requirePositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 1) {
    throw new MatrixBuilderError(
      `${fieldName} должен быть положительным целым числом.`,
      'INVALID_CONFIG'
    );
  }
  return value;
}

function stringArray(value, fieldName) {
  if (!Array.isArray(value) || value.some(item =>
    typeof item !== 'string' || item.trim() === ''
  )) {
    throw new MatrixBuilderError(
      `${fieldName} должен быть массивом непустых строк.`,
      'INVALID_CONFIG'
    );
  }
  return value.map(item => item.trim());
}

function validateMatrixBuilderConfig(value) {
  requireObject(value, 'Конфигурация Matrix Builder');
  const stockPolicy = requireObject(value.stock_policy, 'stock_policy');
  const classification = requireObject(value.classification, 'classification');
  const minimumCompletedWeeks = requirePositiveInteger(
    stockPolicy.minimum_completed_weeks,
    'stock_policy.minimum_completed_weeks'
  );
  const historyWindow = requirePositiveInteger(
    stockPolicy.history_window_completed_weeks,
    'stock_policy.history_window_completed_weeks'
  );
  if (historyWindow < minimumCompletedWeeks) {
    throw new MatrixBuilderError(
      'history_window_completed_weeks не может быть меньше minimum_completed_weeks.',
      'INVALID_CONFIG'
    );
  }
  const minimumCover = requireNonNegativeNumber(
    stockPolicy.minimum_cover_weeks,
    'stock_policy.minimum_cover_weeks'
  );
  const targetCover = requireNonNegativeNumber(
    stockPolicy.target_cover_weeks,
    'stock_policy.target_cover_weeks'
  );
  const maximumCover = requireNonNegativeNumber(
    stockPolicy.maximum_cover_weeks,
    'stock_policy.maximum_cover_weeks'
  );
  if (minimumCover > targetCover || targetCover > maximumCover) {
    throw new MatrixBuilderError(
      'Периоды покрытия должны соблюдать minimum <= target <= maximum.',
      'INVALID_CONFIG'
    );
  }

  const explicitRoleRules = Array.isArray(value.explicit_role_rules)
    ? value.explicit_role_rules.map((rule, index) => {
      requireObject(rule, `explicit_role_rules[${index}]`);
      const role = requireNonEmptyString(rule.role, `explicit_role_rules[${index}].role`);
      if (!MATRIX_ROLES.includes(role)) {
        throw new MatrixBuilderError(
          `Неизвестная роль в explicit_role_rules[${index}]: ${role}.`,
          'INVALID_CONFIG'
        );
      }
      const article = rule.article === null || rule.article === undefined
        ? null
        : requireNonEmptyString(rule.article, `explicit_role_rules[${index}].article`);
      const name = rule.name === null || rule.name === undefined
        ? null
        : requireNonEmptyString(rule.name, `explicit_role_rules[${index}].name`);
      if (!article && !name) {
        throw new MatrixBuilderError(
          `explicit_role_rules[${index}] требует article или name.`,
          'INVALID_CONFIG'
        );
      }
      if (rule.priority && !MATRIX_PRIORITIES.includes(rule.priority)) {
        throw new MatrixBuilderError(
          `Неизвестный приоритет в explicit_role_rules[${index}]: ${rule.priority}.`,
          'INVALID_CONFIG'
        );
      }
      return {
        article,
        name,
        normalized_article: article ? normalizedArticle(article) : null,
        normalized_name: name ? normalizedName(name) : null,
        role,
        priority: rule.priority || null,
        reason: rule.reason || null,
      };
    })
    : [];

  if (!Array.isArray(value.strategic_groups)) {
    throw new MatrixBuilderError(
      'strategic_groups должен быть массивом.',
      'INVALID_CONFIG'
    );
  }
  const strategicGroups = stringArray(
    value.strategic_groups.map(group => group && group.id),
    'strategic_groups[].id'
  ).map((id, index) => {
    const group = requireObject(value.strategic_groups[index], `strategic_groups[${index}]`);
    return {
      id,
      brand: requireNonEmptyString(group.brand, `strategic_groups[${index}].brand`),
      category: group.category || null,
      required_tokens: stringArray(
        group.required_tokens,
        `strategic_groups[${index}].required_tokens`
      ).map(token => normalizedName(token)),
    };
  });

  const strategicCorePriority = requireNonEmptyString(
    classification.strategic_core_priority,
    'classification.strategic_core_priority'
  );
  if (!MATRIX_PRIORITIES.includes(strategicCorePriority)) {
    throw new MatrixBuilderError(
      `Неизвестный strategic_core_priority: ${strategicCorePriority}.`,
      'INVALID_CONFIG'
    );
  }

  return {
    version: requireNonEmptyString(value.version, 'version'),
    status: requireNonEmptyString(value.status, 'status'),
    store: requireNonEmptyString(value.store, 'store'),
    stock_policy: {
      history_window_completed_weeks: historyWindow,
      minimum_completed_weeks: minimumCompletedWeeks,
      minimum_cover_weeks: minimumCover,
      target_cover_weeks: targetCover,
      maximum_cover_weeks: maximumCover,
      safety_stock_factor: requireNonNegativeNumber(
        stockPolicy.safety_stock_factor,
        'stock_policy.safety_stock_factor'
      ),
      large_policy_review_threshold_units: requireNonNegativeNumber(
        stockPolicy.large_policy_review_threshold_units,
        'stock_policy.large_policy_review_threshold_units'
      ),
    },
    classification: {
      core_abc_classes: stringArray(
        classification.core_abc_classes,
        'classification.core_abc_classes'
      ),
      core_xyz_classes: stringArray(
        classification.core_xyz_classes,
        'classification.core_xyz_classes'
      ),
      core_minimum_weeks_with_sales: requirePositiveInteger(
        classification.core_minimum_weeks_with_sales,
        'classification.core_minimum_weeks_with_sales'
      ),
      exit_abc_classes: stringArray(
        classification.exit_abc_classes,
        'classification.exit_abc_classes'
      ),
      exit_xyz_classes: stringArray(
        classification.exit_xyz_classes,
        'classification.exit_xyz_classes'
      ),
      strategic_core_priority: strategicCorePriority,
    },
    explicit_role_rules: explicitRoleRules,
    strategic_groups: strategicGroups,
  };
}

function loadMatrixBuilderConfig(filePath) {
  const resolvedPath = path.resolve(filePath);
  let source;
  try {
    source = fs.readFileSync(resolvedPath, 'utf8');
  } catch (error) {
    throw new MatrixBuilderError(
      `Не удалось загрузить конфигурацию Matrix Builder «${resolvedPath}»: ${error.message}.`,
      'CONFIG_FILE_ERROR',
      error
    );
  }
  try {
    return {
      config: validateMatrixBuilderConfig(JSON.parse(source)),
      sourcePath: resolvedPath,
    };
  } catch (error) {
    if (error instanceof MatrixBuilderError) throw error;
    throw new MatrixBuilderError(
      `Конфигурация Matrix Builder содержит некорректный JSON: ${error.message}.`,
      'INVALID_CONFIG_JSON',
      error
    );
  }
}

function validateDraftItem(item, config) {
  const errors = [];
  const warnings = [];
  const policyFields = [
    'suggested_minimum_shelf_stock',
    'suggested_target_stock',
    'suggested_maximum_stock',
    'suggested_safety_stock',
  ];

  if (typeof item.name !== 'string' || item.name.trim() === '') {
    errors.push('empty_product_name');
  }
  if (!MATRIX_ROLES.includes(item.suggested_role)) errors.push('unknown_role');
  if (!MATRIX_PRIORITIES.includes(item.suggested_priority)) {
    errors.push('unknown_priority');
  }
  for (const field of policyFields) {
    const value = item[field];
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      errors.push(`invalid_${field}`);
    }
  }
  const minimum = item.suggested_minimum_shelf_stock;
  const target = item.suggested_target_stock;
  const maximum = item.suggested_maximum_stock;
  if (minimum !== null && target !== null && minimum > target) {
    errors.push('minimum_exceeds_target');
  }
  if (target !== null && maximum !== null && target > maximum) {
    errors.push('target_exceeds_maximum');
  }
  if (
    item.evidence.completed_weeks_used < config.stock_policy.minimum_completed_weeks &&
    [minimum, target, maximum].some(value => value !== null)
  ) {
    errors.push('policy_without_sufficient_history');
  }
  if (item.policy_conflict) warnings.push('existing_policy_conflict');
  if (item.reason_codes.includes('ambiguous_identity')) warnings.push('ambiguous_identity');
  if (item.evidence.weekly_sales.some(period =>
    (period.quantity !== null && period.quantity < 0) ||
    (typeof period.rawValue === 'number' && period.rawValue < 0)
  )) {
    errors.push('negative_weekly_sales');
  }
  for (const field of ['free_stock', 'stock_days', 'excess_stock']) {
    const value = item.evidence[field];
    if (value !== null && value < 0) errors.push(`negative_${field}`);
  }

  return {
    errors: Array.from(new Set(errors)),
    warnings: Array.from(new Set(warnings)),
  };
}

function validateMatrixDraft(draft, config) {
  if (!draft || draft.status !== 'draft' || !Array.isArray(draft.items)) {
    throw new MatrixBuilderError(
      'Matrix Builder сформировал некорректную структуру черновика.',
      'INVALID_DRAFT'
    );
  }
  let errorCount = 0;
  let warningCount = 0;
  const items = draft.items.map(item => {
    const validation = validateDraftItem(item, config);
    errorCount += validation.errors.length;
    warningCount += validation.warnings.length;
    return {
      ...item,
      validation,
      manual_review_required:
        item.manual_review_required || validation.errors.length > 0,
    };
  });
  return {
    draft: {
      ...draft,
      items,
      validation_summary: { error_count: errorCount, warning_count: warningCount },
    },
    errorCount,
    warningCount,
  };
}

module.exports = {
  MATRIX_ROLES,
  MATRIX_PRIORITIES,
  CONFIDENCE_LEVELS,
  REASON_CODES,
  REASON_EXPLANATIONS,
  MatrixBuilderError,
  validateMatrixBuilderConfig,
  loadMatrixBuilderConfig,
  validateDraftItem,
  validateMatrixDraft,
};
