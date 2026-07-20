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
  'core_insufficient_history',
  'core_below_average_threshold',
  'core_below_active_week_ratio',
  'short_long_trend_conflict',
  'growth_cap_applied',
  'strategic_low_demand',
  'exit_no_sales_8_weeks',
  'exit_no_sales_12_weeks',
  'exit_no_sales_26_weeks',
  'exit_blocked_current_week_sale',
  'exit_blocked_recent_sale',
  'exit_blocked_supplier_demand',
  'exit_blocked_strategic_policy',
  'exit_blocked_approved_policy',
  'exit_insufficient_history',
  'missing_purchase_price',
  'large_inventory_value',
  'critical_inventory_value',
  'large_inventory_units',
  'approved_policy_conflict',
  'placeholder_difference',
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
  core_insufficient_history: 'Для автоматического CORE недостаточно длинной истории.',
  core_below_average_threshold: 'Длинная средняя скорость ниже порога автоматического CORE.',
  core_below_active_week_ratio: 'Доля недель с продажами ниже порога автоматического CORE.',
  short_long_trend_conflict: 'Короткая и длинная средние существенно расходятся.',
  growth_cap_applied: 'Короткий рост ограничен относительно длинной средней.',
  strategic_low_demand: 'Стратегическая позиция имеет слабый спрос и требует коммерческой проверки.',
  exit_no_sales_8_weeks: 'Продажи отсутствуют восемь завершённых недель.',
  exit_no_sales_12_weeks: 'Продажи отсутствуют двенадцать завершённых недель.',
  exit_no_sales_26_weeks: 'Продажи отсутствуют двадцать шесть завершённых недель.',
  exit_blocked_current_week_sale: 'Продажа в текущей неполной неделе блокирует EXIT.',
  exit_blocked_recent_sale: 'Недавняя завершённая неделя с продажей блокирует EXIT.',
  exit_blocked_supplier_demand: 'Потребность или заказ поставщика блокирует EXIT.',
  exit_blocked_strategic_policy: 'Стратегическая защита блокирует EXIT.',
  exit_blocked_approved_policy: 'Утверждённая critical/important политика блокирует EXIT.',
  exit_insufficient_history: 'Наблюдаемой истории недостаточно для EXIT.',
  missing_purchase_price: 'Нет закупочной цены для оценки стоимости максимального запаса.',
  large_inventory_value: 'Стоимость максимального запаса превышает порог проверки.',
  critical_inventory_value: 'Стоимость максимального запаса превышает критический порог.',
  large_inventory_units: 'Максимальный запас превышает порог в единицах.',
  approved_policy_conflict: 'Автоматическое предложение отличается от утверждённой политики.',
  placeholder_difference: 'Автоматическое предложение отличается от временной заглушки матрицы.',
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

function requireBoolean(value, fieldName) {
  if (typeof value !== 'boolean') {
    throw new MatrixBuilderError(
      `${fieldName} должен быть boolean.`,
      'INVALID_CONFIG'
    );
  }
  return value;
}

function requirePositiveNumber(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new MatrixBuilderError(
      `${fieldName} должен быть конечным числом больше нуля.`,
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
  const corePolicy = requireObject(value.core_policy, 'core_policy');
  const exitPolicy = requireObject(value.exit_policy, 'exit_policy');
  const stockPolicy = requireObject(value.stock_policy, 'stock_policy');
  const inventoryValueReview = requireObject(
    value.inventory_value_review,
    'inventory_value_review'
  );
  const classification = requireObject(value.classification, 'classification');
  const coreMinimumWeeks = requirePositiveInteger(
    corePolicy.minimum_completed_weeks,
    'core_policy.minimum_completed_weeks'
  );
  const corePreferredWeeks = requirePositiveInteger(
    corePolicy.preferred_completed_weeks,
    'core_policy.preferred_completed_weeks'
  );
  if (corePreferredWeeks < coreMinimumWeeks) {
    throw new MatrixBuilderError(
      'core_policy.preferred_completed_weeks не может быть меньше minimum_completed_weeks.',
      'INVALID_CONFIG'
    );
  }
  const activeWeekRatio = requireNonNegativeNumber(
    corePolicy.minimum_active_week_ratio,
    'core_policy.minimum_active_week_ratio'
  );
  if (activeWeekRatio > 1) {
    throw new MatrixBuilderError(
      'core_policy.minimum_active_week_ratio не может быть больше 1.',
      'INVALID_CONFIG'
    );
  }
  const baseWeeks = requirePositiveInteger(
    stockPolicy.base_weeks,
    'stock_policy.base_weeks'
  );
  const preferredWeeks = requirePositiveInteger(
    stockPolicy.preferred_weeks,
    'stock_policy.preferred_weeks'
  );
  const shortWindowWeeks = requirePositiveInteger(
    stockPolicy.short_window_weeks,
    'stock_policy.short_window_weeks'
  );
  const minimumPolicyWeeks = requirePositiveInteger(
    stockPolicy.minimum_policy_data_weeks,
    'stock_policy.minimum_policy_data_weeks'
  );
  if (
    preferredWeeks < baseWeeks ||
    baseWeeks < minimumPolicyWeeks ||
    shortWindowWeeks > baseWeeks
  ) {
    throw new MatrixBuilderError(
      'stock_policy должен соблюдать short_window <= minimum_policy_data <= base <= preferred.',
      'INVALID_CONFIG'
    );
  }
  const targetCover = requireNonNegativeNumber(
    stockPolicy.target_cover_weeks,
    'stock_policy.target_cover_weeks'
  );
  const maximumCover = requireNonNegativeNumber(
    stockPolicy.maximum_cover_weeks,
    'stock_policy.maximum_cover_weeks'
  );
  if (targetCover > maximumCover) {
    throw new MatrixBuilderError(
      'Периоды покрытия должны соблюдать target <= maximum.',
      'INVALID_CONFIG'
    );
  }
  const reviewThresholdRub = requirePositiveNumber(
    inventoryValueReview.review_threshold_rub,
    'inventory_value_review.review_threshold_rub'
  );
  const criticalThresholdRub = requirePositiveNumber(
    inventoryValueReview.critical_threshold_rub,
    'inventory_value_review.critical_threshold_rub'
  );
  if (criticalThresholdRub < reviewThresholdRub) {
    throw new MatrixBuilderError(
      'critical_threshold_rub не может быть меньше review_threshold_rub.',
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
      exact_articles: Array.isArray(group.exact_articles)
        ? stringArray(group.exact_articles, `strategic_groups[${index}].exact_articles`)
          .map(normalizedArticle)
        : [],
      required_tokens: stringArray(
        group.required_tokens,
        `strategic_groups[${index}].required_tokens`
      ).map(token => normalizedName(token)),
      required_token_groups: Array.isArray(group.required_token_groups)
        ? group.required_token_groups.map((tokens, groupIndex) => stringArray(
          tokens,
          `strategic_groups[${index}].required_token_groups[${groupIndex}]`
        ).map(token => normalizedName(token)))
        : [],
    };
  });

  if (!Array.isArray(value.category_profiles) || value.category_profiles.length === 0) {
    throw new MatrixBuilderError(
      'category_profiles должен быть непустым массивом.',
      'INVALID_CONFIG'
    );
  }
  const categoryProfiles = value.category_profiles.map((profile, index) => {
    requireObject(profile, `category_profiles[${index}]`);
    return {
      id: requireNonEmptyString(profile.id, `category_profiles[${index}].id`),
      default: profile.default === true,
      exit_zero_sales_weeks: requirePositiveInteger(
        profile.exit_zero_sales_weeks,
        `category_profiles[${index}].exit_zero_sales_weeks`
      ),
      match_any_tokens: stringArray(
        profile.match_any_tokens,
        `category_profiles[${index}].match_any_tokens`
      ).map(token => normalizedName(token)),
      minimum_shelf_units: requireNonNegativeNumber(
        profile.minimum_shelf_units,
        `category_profiles[${index}].minimum_shelf_units`
      ),
      minimum_cover_weeks: requireNonNegativeNumber(
        profile.minimum_cover_weeks,
        `category_profiles[${index}].minimum_cover_weeks`
      ),
      lead_time_weeks: requirePositiveNumber(
        profile.lead_time_weeks,
        `category_profiles[${index}].lead_time_weeks`
      ),
    };
  });
  if (categoryProfiles.filter(profile => profile.default).length !== 1) {
    throw new MatrixBuilderError(
      'category_profiles должен содержать ровно один default-профиль.',
      'INVALID_CONFIG'
    );
  }

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
    core_policy: {
      minimum_completed_weeks: coreMinimumWeeks,
      preferred_completed_weeks: corePreferredWeeks,
      minimum_active_week_ratio: activeWeekRatio,
      minimum_average_weekly_sales: requireNonNegativeNumber(
        corePolicy.minimum_average_weekly_sales,
        'core_policy.minimum_average_weekly_sales'
      ),
      short_term_growth_cap: requirePositiveNumber(
        corePolicy.short_term_growth_cap,
        'core_policy.short_term_growth_cap'
      ),
    },
    exit_policy: {
      consumables_zero_sales_weeks: requirePositiveInteger(
        exitPolicy.consumables_zero_sales_weeks,
        'exit_policy.consumables_zero_sales_weeks'
      ),
      slow_moving_zero_sales_weeks: requirePositiveInteger(
        exitPolicy.slow_moving_zero_sales_weeks,
        'exit_policy.slow_moving_zero_sales_weeks'
      ),
      durable_zero_sales_weeks: requirePositiveInteger(
        exitPolicy.durable_zero_sales_weeks,
        'exit_policy.durable_zero_sales_weeks'
      ),
      require_no_current_week_sales: requireBoolean(
        exitPolicy.require_no_current_week_sales,
        'exit_policy.require_no_current_week_sales'
      ),
      require_no_supplier_demand: requireBoolean(
        exitPolicy.require_no_supplier_demand,
        'exit_policy.require_no_supplier_demand'
      ),
      protect_strategic_items: requireBoolean(
        exitPolicy.protect_strategic_items,
        'exit_policy.protect_strategic_items'
      ),
      require_sufficient_history: requireBoolean(
        exitPolicy.require_sufficient_history,
        'exit_policy.require_sufficient_history'
      ),
    },
    stock_policy: {
      base_weeks: baseWeeks,
      preferred_weeks: preferredWeeks,
      short_window_weeks: shortWindowWeeks,
      long_term_growth_cap: requirePositiveNumber(
        stockPolicy.long_term_growth_cap,
        'stock_policy.long_term_growth_cap'
      ),
      target_cover_weeks: targetCover,
      maximum_cover_weeks: maximumCover,
      minimum_policy_data_weeks: minimumPolicyWeeks,
      large_policy_review_threshold_units: requireNonNegativeNumber(
        stockPolicy.large_policy_review_threshold_units,
        'stock_policy.large_policy_review_threshold_units'
      ),
    },
    inventory_value_review: {
      enabled: requireBoolean(
        inventoryValueReview.enabled,
        'inventory_value_review.enabled'
      ),
      review_threshold_rub: reviewThresholdRub,
      critical_threshold_rub: criticalThresholdRub,
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
    category_profiles: categoryProfiles,
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
    const reviewQueueMemberships = Array.isArray(item.review_queue_memberships)
      ? [...item.review_queue_memberships]
      : [];
    if (
      validation.errors.length > 0 &&
      !reviewQueueMemberships.includes('insufficient_data')
    ) reviewQueueMemberships.push('insufficient_data');
    return {
      ...item,
      validation,
      review_queue_memberships: reviewQueueMemberships,
      manual_review_required:
        reviewQueueMemberships.length > 0 || validation.errors.length > 0,
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
