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
  return config.strategic_groups.filter(group =>
    group.required_tokens.every(token => tokens.has(token))
  );
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

function classifyRole({ row, stockPolicy, existingItem, config }) {
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
  const regularSales =
    stockPolicy.completedWeeksUsed >= config.stock_policy.minimum_completed_weeks &&
    stockPolicy.weeksWithSales >=
      config.classification.core_minimum_weeks_with_sales &&
    stockPolicy.averageWeeklySales > 0;
  const positiveSupplierOrder =
    typeof row.supplierOrderQty === 'number' && row.supplierOrderQty > 0;
  const positiveExcess =
    typeof row.excessStock === 'number' && row.excessStock > 0;

  if (highAbc) reasonCodes.push('high_abc_rank');
  if (stableXyz) reasonCodes.push('stable_xyz_rank');
  if (regularSales) {
    reasonCodes.push('stable_sales', 'regular_weekly_sales');
  }
  if (positiveSupplierOrder) reasonCodes.push('supplier_recommends_order');
  if (positiveExcess) reasonCodes.push('excess_stock');
  if (strategicGroups.length > 0) reasonCodes.push('strategic_brand_group');

  if (highAbc && stableXyz && regularSales && !positiveExcess) {
    return {
      role: 'CORE',
      reasonCodes,
      strategicGroups,
      explicitRule: null,
      provenance: {
        method: 'deterministic_core_signals',
        sourceFields: ['abc', 'xyz', 'weeklySalesHistory', 'excessStock'],
      },
    };
  }

  const enoughHistory =
    stockPolicy.completedWeeksUsed >= config.stock_policy.minimum_completed_weeks;
  const allReliableWeeksZero =
    enoughHistory &&
    stockPolicy.averageWeeklySales === 0 &&
    stockPolicy.weeksWithSales === 0;
  const hasConfirmedInventory =
    (typeof row.freeStock === 'number' && row.freeStock > 0) || positiveExcess;
  const hasStableIdentifier = Boolean(
    row.barcode || row.internalProductId || row.article
  );
  const exitClasses =
    config.classification.exit_abc_classes.includes(abc) &&
    config.classification.exit_xyz_classes.includes(xyz);

  if (
    !existingItem &&
    exitClasses &&
    allReliableWeeksZero &&
    hasConfirmedInventory &&
    hasStableIdentifier
  ) {
    return {
      role: 'EXIT',
      reasonCodes: Array.from(new Set([
        ...reasonCodes,
        'no_completed_week_sales',
        'possible_exit_candidate',
      ])),
      strategicGroups,
      explicitRule: null,
      provenance: {
        method: 'deterministic_exit_candidate_signals',
        sourceFields: ['abc', 'xyz', 'weeklySalesHistory', 'freeStock', 'excessStock'],
      },
    };
  }

  if (
    !existingItem &&
    !enoughHistory &&
    row.reportedSalesQuantity === null
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
      provenance: {
        method: 'possible_new_short_history',
        sourceFields: ['weeklySalesHistory', 'reportedSalesQuantity'],
      },
    };
  }

  const lowSignificance = ['C', 'D'].includes(abc) || ['Z', 'ZZ'].includes(xyz);
  const irregular =
    stockPolicy.weeksWithSales > 0 &&
    stockPolicy.weeksWithSales < stockPolicy.completedWeeksUsed;
  if (lowSignificance || irregular || positiveExcess) {
    return {
      role: 'OPTIONAL',
      reasonCodes: Array.from(new Set([
        ...reasonCodes,
        ...(irregular ? ['irregular_sales'] : []),
      ])),
      strategicGroups,
      explicitRule: null,
      provenance: {
        method: 'deterministic_optional_signals',
        sourceFields: ['abc', 'xyz', 'weeklySalesHistory', 'excessStock'],
      },
    };
  }

  return {
    role: 'UNCLASSIFIED',
    reasonCodes: Array.from(new Set([
      ...reasonCodes,
      ...(enoughHistory ? [] : ['insufficient_sales_history']),
      'policy_requires_confirmation',
    ])),
    strategicGroups,
    explicitRule: null,
    provenance: {
      method: 'insufficient_or_conflicting_signals',
      sourceFields: ['abc', 'xyz', 'weeklySalesHistory'],
    },
  };
}

function suggestPriority({ roleResult, existingItem, config }) {
  if (existingItem?.priority === 'critical') {
    return {
      priority: 'critical',
      reasonCodes: ['existing_matrix_policy'],
      provenance: { method: 'existing_critical_policy' },
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
      priority: roleResult.strategicGroups.length > 0
        ? config.classification.strategic_core_priority
        : 'important',
      reasonCodes: roleResult.strategicGroups.length > 0
        ? ['stable_sales', 'strategic_brand_group']
        : ['stable_sales'],
      provenance: {
        method: roleResult.strategicGroups.length > 0
          ? 'stable_core_with_strategic_group'
          : 'stable_core',
      },
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

function assessDataQuality({ row, stockPolicy, ambiguousIdentity }) {
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

  if (
    ambiguousIdentity ||
    !hasStableIdentity ||
    stockPolicy.completedWeeksUsed < 2 ||
    invalidNumericData ||
    !row.name
  ) {
    return {
      confidence: 'low',
      reasons: [
        ...(ambiguousIdentity ? ['ambiguous_identity'] : []),
        ...(!hasStableIdentity ? ['missing_stable_identifier'] : []),
        ...(stockPolicy.completedWeeksUsed < 2 ? ['insufficient_sales_history'] : []),
        ...(invalidNumericData ? ['missing_inventory_data'] : []),
      ],
    };
  }
  if (
    stockPolicy.completedWeeksUsed >= 4 &&
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
  matchExplicitRoleRule,
  classifyRole,
  suggestPriority,
  assessDataQuality,
};
