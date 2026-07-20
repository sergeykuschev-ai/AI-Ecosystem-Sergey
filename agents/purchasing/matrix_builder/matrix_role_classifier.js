const { normalizeClass } = require('../rules/abc_xyz_rules');
const {
  normalizedArticle,
  normalizedName,
} = require('../services/assortment_matrix_loader');

function productTokens(name) {
  return new Set(normalizedName(name).split(' ').filter(Boolean));
}

function matchStrategicGroups(row, config) {
  const tokens = productTokens(row.name);
  const article = normalizedArticle(row.article);
  return config.strategic_groups.filter(group => {
    const articleMatch = article && group.exact_articles.includes(article);
    const tokenMatch =
      group.required_tokens.every(token => tokens.has(token)) &&
      group.required_token_groups.every(alternatives =>
        alternatives.some(token => tokens.has(token))
      );
    return articleMatch || tokenMatch;
  });
}

function resolveCategoryProfile(row, config) {
  const tokens = productTokens(row.name);
  const matched = config.category_profiles.find(profile =>
    !profile.default && profile.match_any_tokens.some(token => tokens.has(token))
  );
  return matched || config.category_profiles.find(profile => profile.default);
}

function matchExplicitRoleRule(row, config) {
  const article = normalizedArticle(row.article);
  const name = normalizedName(row.name);
  const matches = config.explicit_role_rules.filter(rule =>
    (rule.normalized_article && rule.normalized_article === article) ||
    (rule.normalized_name && rule.normalized_name === name)
  );
  return matches.length === 1 ? matches[0] : null;
}

function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function completedExitHistory(row, horizon) {
  const completed = (Array.isArray(row.weeklySalesHistory)
    ? row.weeklySalesHistory
    : [])
    .filter(period => period && period.completionStatus === 'completed')
    .sort((left, right) => left.periodStart.localeCompare(right.periodStart))
    .slice(-horizon);
  const reliable = completed.filter(period =>
    typeof period.quantity === 'number' &&
    Number.isFinite(period.quantity) &&
    period.quantity >= 0
  );
  return {
    completed,
    reliable,
    sufficient: reliable.length >= horizon,
    hasSales: reliable.some(period => period.quantity > 0),
  };
}

function exitNoSalesReason(horizon) {
  if (horizon >= 26) return 'exit_no_sales_26_weeks';
  if (horizon >= 12) return 'exit_no_sales_12_weeks';
  return 'exit_no_sales_8_weeks';
}

function evaluateExit({
  row,
  existingItem,
  strategicGroups,
  categoryProfile,
  config,
}) {
  const horizon = categoryProfile.exit_zero_sales_weeks;
  const history = completedExitHistory(row, horizon);
  const currentWeekSale = (Array.isArray(row.weeklySalesHistory)
    ? row.weeklySalesHistory
    : []).some(period =>
    period?.completionStatus === 'partial' && positiveNumber(period.quantity)
  );
  const supplierDemand = positiveNumber(row.needQty) ||
    positiveNumber(row.supplierOrderQty);
  const availabilityWindow = Array.isArray(row.weeklyAvailabilityHistory)
    ? row.weeklyAvailabilityHistory
      .filter(period => period?.completionStatus === 'completed')
      .sort((left, right) => left.periodStart.localeCompare(right.periodStart))
      .slice(-horizon)
    : [];
  const reliableAvailability = availabilityWindow.filter(period =>
    typeof period.available === 'boolean' ||
    (typeof period.availableStock === 'number' &&
      Number.isFinite(period.availableStock) && period.availableStock >= 0)
  );
  const historicalAvailabilityPresent = availabilityWindow.length > 0;
  const historicallyAvailable = reliableAvailability.some(period =>
    period.available === true || period.availableStock > 0
  );
  const strategicProtected =
    config.exit_policy.protect_strategic_items && strategicGroups.length > 0;
  const approvedProtected = existingItem &&
    (existingItem.policy_status || 'approved') === 'approved' &&
    ['critical', 'important'].includes(existingItem.priority);
  const blockers = [];

  if (!history.sufficient && config.exit_policy.require_sufficient_history) {
    blockers.push('exit_insufficient_history');
  }
  if (history.sufficient && history.hasSales) {
    blockers.push('exit_blocked_recent_sale');
  }
  if (currentWeekSale && config.exit_policy.require_no_current_week_sales) {
    blockers.push('exit_blocked_current_week_sale');
  }
  if (supplierDemand && config.exit_policy.require_no_supplier_demand) {
    blockers.push('exit_blocked_supplier_demand');
  }
  if (strategicProtected) blockers.push('exit_blocked_strategic_policy');
  if (approvedProtected) blockers.push('exit_blocked_approved_policy');
  if (
    historicalAvailabilityPresent &&
    (reliableAvailability.length < horizon || !historicallyAvailable)
  ) blockers.push('exit_insufficient_history');

  return {
    horizonWeeks: horizon,
    completedWeeksObserved: history.reliable.length,
    noSalesInHorizon: history.sufficient && !history.hasSales,
    currentWeekSale,
    supplierDemand,
    strategicProtected,
    approvedProtected,
    blockers,
    eligible: history.sufficient && !history.hasSales && blockers.length === 0,
    noSalesReason: history.sufficient && !history.hasSales
      ? exitNoSalesReason(horizon)
      : null,
    historicalAvailabilityStatus: !historicalAvailabilityPresent
      ? 'not_available'
      : historicallyAvailable && reliableAvailability.length >= horizon
        ? 'confirmed_available_in_horizon'
        : 'insufficient_or_unavailable_in_horizon',
  };
}

function classifyRole({
  row,
  stockPolicy,
  existingItem,
  config,
  categoryProfile = resolveCategoryProfile(row, config),
}) {
  const abc = normalizeClass(row.abc);
  const xyz = normalizeClass(row.xyz);
  const strategicGroups = matchStrategicGroups(row, config);
  const explicitRule = matchExplicitRoleRule(row, config);
  const reasonCodes = [];

  if (explicitRule) {
    return {
      role: explicitRule.role,
      reasonCodes: ['policy_requires_confirmation'],
      strategicGroups,
      explicitRule,
      categoryProfile,
      exitEvaluation: null,
      provenance: {
        method: 'exact_config_rule',
        rule: {
          article: explicitRule.article,
          name: explicitRule.name,
          role: explicitRule.role,
        },
      },
    };
  }

  const highAbc = config.classification.core_abc_classes.includes(abc);
  const stableXyz = config.classification.core_xyz_classes.includes(xyz);
  const longEnough =
    stockPolicy.completedWeeksUsed >= config.core_policy.minimum_completed_weeks;
  const averageStrong =
    stockPolicy.longTermAverage !== null &&
    stockPolicy.longTermAverage >= config.core_policy.minimum_average_weekly_sales;
  const activeEnough =
    stockPolicy.activeWeekRatio !== null &&
    stockPolicy.activeWeekRatio >= config.core_policy.minimum_active_week_ratio;
  const positiveSupplierOrder = positiveNumber(row.supplierOrderQty);
  const positiveExcess = positiveNumber(row.excessStock);

  if (highAbc) reasonCodes.push('high_abc_rank');
  if (stableXyz) reasonCodes.push('stable_xyz_rank');
  if (longEnough && averageStrong && activeEnough) {
    reasonCodes.push('stable_sales', 'regular_weekly_sales');
  }
  if (!longEnough) reasonCodes.push('core_insufficient_history');
  if (longEnough && !averageStrong) reasonCodes.push('core_below_average_threshold');
  if (longEnough && !activeEnough) reasonCodes.push('core_below_active_week_ratio');
  if (stockPolicy.growthCapApplied) {
    reasonCodes.push('short_long_trend_conflict', 'growth_cap_applied');
  }
  if (positiveSupplierOrder) reasonCodes.push('supplier_recommends_order');
  if (positiveExcess) reasonCodes.push('excess_stock');
  if (strategicGroups.length > 0) reasonCodes.push('strategic_brand_group');
  if (strategicGroups.length > 0 && !(averageStrong && activeEnough)) {
    reasonCodes.push('strategic_low_demand');
  }

  if (
    highAbc &&
    stableXyz &&
    longEnough &&
    averageStrong &&
    activeEnough &&
    !positiveExcess
  ) {
    return {
      role: 'CORE',
      reasonCodes: Array.from(new Set(reasonCodes)),
      strategicGroups,
      explicitRule: null,
      categoryProfile,
      exitEvaluation: null,
      provenance: {
        method: 'long_horizon_core_signals',
        sourceFields: ['abc', 'xyz', 'weeklySalesHistory', 'excessStock'],
        minimumCompletedWeeks: config.core_policy.minimum_completed_weeks,
        minimumActiveWeekRatio: config.core_policy.minimum_active_week_ratio,
        minimumAverageWeeklySales:
          config.core_policy.minimum_average_weekly_sales,
      },
    };
  }

  const exitEvaluation = evaluateExit({
    row,
    existingItem,
    strategicGroups,
    categoryProfile,
    config,
  });
  const hasConfirmedInventory = positiveNumber(row.freeStock) || positiveExcess;
  const hasStableIdentifier = Boolean(
    row.barcode || row.internalProductId || row.article
  );
  const exitClasses =
    config.classification.exit_abc_classes.includes(abc) &&
    config.classification.exit_xyz_classes.includes(xyz);
  const possibleNew =
    stockPolicy.totalCompletedWeeksAvailable < config.core_policy.minimum_completed_weeks &&
    row.reportedSalesQuantity === null;

  if (
    !existingItem &&
    possibleNew
  ) {
    return {
      role: 'NEW',
      reasonCodes: Array.from(new Set([
        ...reasonCodes,
        'insufficient_sales_history',
        'possible_new_product',
      ])),
      strategicGroups,
      explicitRule: null,
      categoryProfile,
      exitEvaluation,
      provenance: {
        method: 'possible_new_short_history',
        sourceFields: ['weeklySalesHistory', 'reportedSalesQuantity'],
      },
    };
  }

  if (
    exitClasses &&
    exitEvaluation.eligible &&
    hasConfirmedInventory &&
    hasStableIdentifier
  ) {
    return {
      role: 'EXIT',
      reasonCodes: Array.from(new Set([
        ...reasonCodes,
        exitEvaluation.noSalesReason,
        'possible_exit_candidate',
      ])),
      strategicGroups,
      explicitRule: null,
      categoryProfile,
      exitEvaluation,
      provenance: {
        method: 'category_horizon_exit_candidate_signals',
        sourceFields: [
          'abc',
          'xyz',
          'weeklySalesHistory',
          'freeStock',
          'excessStock',
          'needQty',
          'supplierOrderQty',
        ],
        horizonWeeks: exitEvaluation.horizonWeeks,
      },
    };
  }

  if (exitClasses) reasonCodes.push(...exitEvaluation.blockers);
  const lowSignificance = ['C', 'D'].includes(abc) || ['Z', 'ZZ'].includes(xyz);
  const irregular =
    stockPolicy.weeksWithSales > 0 &&
    stockPolicy.weeksWithSales < stockPolicy.completedWeeksUsed;
  if (lowSignificance || irregular || positiveExcess || strategicGroups.length > 0) {
    return {
      role: 'OPTIONAL',
      reasonCodes: Array.from(new Set([
        ...reasonCodes,
        ...(irregular ? ['irregular_sales'] : []),
      ])),
      strategicGroups,
      explicitRule: null,
      categoryProfile,
      exitEvaluation,
      provenance: {
        method: strategicGroups.length > 0 && !lowSignificance
          ? 'strategic_low_demand_optional'
          : 'deterministic_optional_signals',
        sourceFields: ['abc', 'xyz', 'weeklySalesHistory', 'excessStock'],
      },
    };
  }

  return {
    role: 'UNCLASSIFIED',
    reasonCodes: Array.from(new Set([
      ...reasonCodes,
      ...(stockPolicy.calculationStatus === 'calculated'
        ? []
        : ['insufficient_sales_history']),
      'policy_requires_confirmation',
    ])),
    strategicGroups,
    explicitRule: null,
    categoryProfile,
    exitEvaluation,
    provenance: {
      method: 'insufficient_or_conflicting_signals',
      sourceFields: ['abc', 'xyz', 'weeklySalesHistory'],
    },
  };
}

function suggestPriority({ roleResult, existingItem, config }) {
  if (existingItem && (existingItem.policy_status || 'approved') === 'approved') {
    return {
      priority: existingItem.priority,
      reasonCodes: ['existing_matrix_policy'],
      provenance: { method: 'approved_existing_policy' },
    };
  }
  if (roleResult.explicitRule?.priority) {
    return {
      priority: roleResult.explicitRule.priority,
      reasonCodes: ['policy_requires_confirmation'],
      provenance: { method: 'exact_config_rule' },
    };
  }
  if (roleResult.role === 'CORE') {
    return {
      priority: 'important',
      reasonCodes: ['stable_sales'],
      provenance: { method: 'long_horizon_core' },
    };
  }
  if (roleResult.strategicGroups.length > 0) {
    return {
      priority: config.classification.strategic_core_priority,
      reasonCodes: ['strategic_brand_group'],
      provenance: { method: 'strategic_group_without_core_promotion' },
    };
  }
  if (['NEW', 'EXIT', 'UNCLASSIFIED'].includes(roleResult.role)) {
    return {
      priority: 'review',
      reasonCodes: ['policy_requires_confirmation'],
      provenance: { method: 'role_requires_owner_review' },
    };
  }
  return {
    priority: 'standard',
    reasonCodes: [],
    provenance: { method: 'ordinary_supported_assortment' },
  };
}

function assessDataQuality({ row, stockPolicy, ambiguousIdentity, config }) {
  const hasStableIdentity = Boolean(
    row.barcode || row.internalProductId || row.article
  );
  const abc = normalizeClass(row.abc);
  const xyz = normalizeClass(row.xyz);
  const validInventory =
    typeof row.freeStock === 'number' &&
    Number.isFinite(row.freeStock) &&
    row.freeStock >= 0 &&
    typeof row.stockDays === 'number' &&
    Number.isFinite(row.stockDays) &&
    row.stockDays >= 0;
  const invalidNumericData = [row.freeStock, row.stockDays, row.excessStock]
    .some(value => typeof value === 'number' && (!Number.isFinite(value) || value < 0));
  const insufficientHistory =
    stockPolicy.completedWeeksUsed < config.stock_policy.minimum_policy_data_weeks;

  if (
    ambiguousIdentity ||
    !hasStableIdentity ||
    insufficientHistory ||
    invalidNumericData ||
    !row.name
  ) {
    return {
      confidence: 'low',
      reasons: [
        ...(ambiguousIdentity ? ['ambiguous_identity'] : []),
        ...(!hasStableIdentity ? ['missing_stable_identifier'] : []),
        ...(insufficientHistory ? ['insufficient_sales_history'] : []),
        ...(invalidNumericData ? ['missing_inventory_data'] : []),
      ],
    };
  }
  if (
    stockPolicy.completedWeeksUsed >= config.stock_policy.preferred_weeks &&
    abc &&
    xyz &&
    validInventory &&
    stockPolicy.invalidCompletedWeeks === 0
  ) {
    return { confidence: 'high', reasons: [] };
  }
  return {
    confidence: 'medium',
    reasons: [
      ...(!validInventory ? ['missing_inventory_data'] : []),
      ...(!abc || !xyz ? ['policy_requires_confirmation'] : []),
    ],
  };
}

module.exports = {
  productTokens,
  matchStrategicGroups,
  resolveCategoryProfile,
  matchExplicitRoleRule,
  completedExitHistory,
  evaluateExit,
  classifyRole,
  suggestPriority,
  assessDataQuality,
};
