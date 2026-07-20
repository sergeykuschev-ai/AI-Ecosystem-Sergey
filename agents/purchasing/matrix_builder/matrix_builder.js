const path = require('node:path');

const {
  assertUsableAdapterResult,
  readSmartZapasExport,
} = require('../adapters/smartzapas_adapter');
const {
  loadAssortmentMatrix,
  matchAssortmentMatrix,
  normalizedName,
} = require('../services/assortment_matrix_loader');
const {
  runOrderAgentFromAdapterResultWithDemand,
} = require('../order_agent');
const {
  loadMatrixBuilderConfig,
  REASON_EXPLANATIONS,
  validateMatrixDraft,
} = require('./matrix_builder_validator');
const { calculateStockPolicy } = require('./matrix_stock_policy');
const {
  assessDataQuality,
  classifyRole,
  resolveCategoryProfile,
  suggestPriority,
} = require('./matrix_role_classifier');
const { buildMatrixBuilderReport } = require('./matrix_builder_report');

const DEFAULT_MATRIX_BUILDER_CONFIG_PATH = path.resolve(
  __dirname,
  '../../../data/purchasing/miska-matrix-builder-config.json'
);

function finiteNumberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function decisionByIdentity(decisions = []) {
  return new Map(decisions.map(decision => [decision.rowIdentity, decision]));
}

function duplicateIdentityRows(diagnostics = {}) {
  return new Set(
    (diagnostics.duplicateIdentifiers || [])
      .filter(item => ['article', 'barcode', 'internal_product_id'].includes(
        item.identifierType
      ))
      .flatMap(item => item.rowIdentities || [])
  );
}

function ambiguousMatrixRows(matchResult) {
  return new Set(
    (matchResult?.itemResults || [])
      .filter(result => result.status === 'ambiguous')
      .flatMap(result => result.candidateRowIdentities || [])
  );
}

function automaticPolicy(stockPolicy, priority) {
  return {
    priority,
    minimum_shelf_stock: stockPolicy.minimumShelfStock,
    target_stock: stockPolicy.targetStock,
    maximum_stock: stockPolicy.maximumStock,
    safety_stock: stockPolicy.safetyStock,
  };
}

function existingPolicy(match) {
  if (!match) return null;
  return {
    priority: match.item.priority,
    minimum_shelf_stock: match.item.minimum_shelf_stock,
    target_stock: match.item.target_stock,
    allow_zero_stock: match.item.allow_zero_stock,
    policy_status: match.item.policy_status || 'approved',
    match_method: match.matchMethod,
  };
}

function policiesConflict(existing, suggested) {
  if (!existing || (existing.policy_status || 'approved') !== 'approved') return false;
  return policiesDiffer(existing, suggested);
}

function policiesDiffer(existing, suggested) {
  if (!existing) return false;
  if (existing.priority !== suggested.priority) return true;
  if (
    suggested.minimum_shelf_stock !== null &&
    existing.minimum_shelf_stock !== suggested.minimum_shelf_stock
  ) return true;
  return suggested.target_stock !== null &&
    existing.target_stock !== suggested.target_stock;
}

function effectivePolicy(existing, suggested) {
  if (!existing || existing.policy_status !== 'approved') return { ...suggested };
  return {
    priority: existing.priority,
    minimum_shelf_stock: existing.minimum_shelf_stock,
    target_stock: existing.target_stock,
    maximum_stock: suggested.maximum_stock,
    safety_stock: suggested.safety_stock,
  };
}

function uniqueReasonCodes(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function explainReasonCodes(reasonCodes) {
  return reasonCodes
    .map(code => REASON_EXPLANATIONS[code])
    .filter(Boolean)
    .join(' ');
}

function buildDraftItem({
  row,
  phase1Decision,
  phase2Decision,
  existingMatch,
  ambiguousIdentity,
  config,
}) {
  const categoryProfile = resolveCategoryProfile(row, config);
  const stockPolicy = calculateStockPolicy(row, config, categoryProfile);
  const roleResult = classifyRole({
    row,
    stockPolicy,
    existingItem: existingMatch?.item || null,
    config,
    categoryProfile,
  });
  const priorityResult = suggestPriority({
    roleResult,
    existingItem: existingMatch?.item || null,
    config,
  });
  const quality = assessDataQuality({
    row,
    stockPolicy,
    ambiguousIdentity,
    config,
  });
  const suggestedPolicy = automaticPolicy(stockPolicy, priorityResult.priority);
  const preservedPolicy = existingPolicy(existingMatch);
  const approvedPolicyConflict = policiesConflict(preservedPolicy, suggestedPolicy);
  const placeholderDifference = Boolean(
    preservedPolicy?.policy_status === 'placeholder' &&
    policiesDiffer(preservedPolicy, suggestedPolicy)
  );
  const policyRequiresConfirmation = Boolean(
    preservedPolicy?.policy_status === 'requires_confirmation'
  );
  const selectedPolicy = effectivePolicy(preservedPolicy, suggestedPolicy);
  const missingInventory = row.freeStock === null || row.stockDays === null;
  const belowExpectedStock =
    row.freeStock !== null &&
    suggestedPolicy.target_stock !== null &&
    row.freeStock < suggestedPolicy.target_stock;
  const largeSuggestedPolicy =
    suggestedPolicy.maximum_stock !== null &&
    suggestedPolicy.maximum_stock >
      config.stock_policy.large_policy_review_threshold_units;
  const purchasePrice = finiteNumberOrNull(row.priceNum);
  const maximumStockValue = purchasePrice !== null &&
    selectedPolicy.maximum_stock !== null
    ? Math.round(
      (purchasePrice * selectedPolicy.maximum_stock + Number.EPSILON) * 100
    ) / 100
    : null;
  const inventoryValueLevel = maximumStockValue !== null &&
    config.inventory_value_review.enabled
    ? maximumStockValue >= config.inventory_value_review.critical_threshold_rub
      ? 'critical'
      : maximumStockValue >= config.inventory_value_review.review_threshold_rub
        ? 'review'
        : null
    : null;
  const missingPurchasePrice = purchasePrice === null;
  const identityQueue = quality.reasons.some(reason =>
    ['missing_stable_identifier', 'ambiguous_identity'].includes(reason)
  );
  const commercialQueue =
    ['NEW', 'UNCLASSIFIED'].includes(roleResult.role) ||
    roleResult.reasonCodes.includes('strategic_low_demand') ||
    roleResult.reasonCodes.some(reason => reason.startsWith('exit_blocked_')) ||
    stockPolicy.growthCapApplied ||
    policyRequiresConfirmation;
  const insufficientDataQueue =
    stockPolicy.calculationStatus !== 'calculated' ||
    missingInventory ||
    missingPurchasePrice;
  const reviewQueueMemberships = [
    ...(identityQueue ? ['identity_remediation'] : []),
    ...(commercialQueue ? ['commercial_review'] : []),
    ...(roleResult.role === 'EXIT' ? ['exit_review'] : []),
    ...(approvedPolicyConflict ? ['policy_conflict'] : []),
    ...(largeSuggestedPolicy || inventoryValueLevel
      ? ['large_inventory_review']
      : []),
    ...(insufficientDataQueue ? ['insufficient_data'] : []),
  ];
  const reasonCodes = uniqueReasonCodes([
    ...stockPolicy.reasonCodes,
    ...roleResult.reasonCodes,
    ...priorityResult.reasonCodes,
    ...quality.reasons,
    ...(preservedPolicy ? ['existing_matrix_policy'] : []),
    ...(missingInventory ? ['missing_inventory_data'] : []),
    ...(belowExpectedStock ? ['below_expected_stock'] : []),
    ...(approvedPolicyConflict ? ['approved_policy_conflict'] : []),
    ...(placeholderDifference ? ['placeholder_difference'] : []),
    ...(policyRequiresConfirmation
      ? ['policy_requires_confirmation']
      : []),
    ...(largeSuggestedPolicy ? ['large_inventory_units'] : []),
    ...(inventoryValueLevel === 'review' ? ['large_inventory_value'] : []),
    ...(inventoryValueLevel === 'critical' ? ['critical_inventory_value'] : []),
    ...(missingPurchasePrice ? ['missing_purchase_price'] : []),
  ]);
  const manualReviewReasons = uniqueReasonCodes([
    ...(identityQueue ? quality.reasons.filter(reason =>
      ['missing_stable_identifier', 'ambiguous_identity'].includes(reason)
    ) : []),
    ...(approvedPolicyConflict ? ['approved_policy_conflict'] : []),
    ...(policyRequiresConfirmation ? ['policy_requires_confirmation'] : []),
    ...(largeSuggestedPolicy ? ['large_inventory_units'] : []),
    ...(inventoryValueLevel === 'review' ? ['large_inventory_value'] : []),
    ...(inventoryValueLevel === 'critical' ? ['critical_inventory_value'] : []),
    ...(roleResult.role === 'EXIT'
      ? [roleResult.exitEvaluation?.noSalesReason, 'possible_exit_candidate']
      : []),
    ...(commercialQueue ? roleResult.reasonCodes.filter(reason => [
      'possible_new_product',
      'policy_requires_confirmation',
      'strategic_low_demand',
      'short_long_trend_conflict',
      'growth_cap_applied',
      'exit_blocked_current_week_sale',
      'exit_blocked_recent_sale',
      'exit_blocked_supplier_demand',
      'exit_blocked_strategic_policy',
      'exit_blocked_approved_policy',
    ].includes(reason)) : []),
    ...(stockPolicy.calculationStatus !== 'calculated'
      ? ['insufficient_sales_history']
      : []),
    ...(missingInventory ? ['missing_inventory_data'] : []),
    ...(missingPurchasePrice ? ['missing_purchase_price'] : []),
  ]);
  const strategicBrands = Array.from(new Set(
    roleResult.strategicGroups.map(group => group.brand)
  ));
  const inferredBrand = existingMatch?.item?.brand || (
    strategicBrands.length === 1 ? strategicBrands[0] : null
  );
  const strategicCategories = Array.from(new Set(
    roleResult.strategicGroups.map(group => group.category).filter(Boolean)
  ));
  const inferredCategory = existingMatch?.item?.category || (
    strategicCategories.length === 1 ? strategicCategories[0] : null
  );

  return {
    rowIdentity: row.rowIdentity,
    source_row_number: row.rowNumber,
    article: row.article || null,
    barcode: row.barcode || null,
    internal_product_id: row.internalProductId || null,
    name: row.name,
    normalized_name: normalizedName(row.name),
    brand: inferredBrand || null,
    category: inferredCategory,
    suggested_role: roleResult.role,
    suggested_priority: selectedPolicy.priority,
    suggested_minimum_shelf_stock: selectedPolicy.minimum_shelf_stock,
    suggested_target_stock: selectedPolicy.target_stock,
    suggested_maximum_stock: selectedPolicy.maximum_stock,
    suggested_safety_stock: selectedPolicy.safety_stock,
    suggested_allow_zero_stock: preservedPolicy
      ?.policy_status === 'approved'
      ? preservedPolicy.allow_zero_stock
      : roleResult.role === 'EXIT',
    existing_matrix_item: Boolean(existingMatch),
    existing_policy_preserved: preservedPolicy?.policy_status === 'approved',
    existing_policy: preservedPolicy,
    suggested_policy: suggestedPolicy,
    approved_policy_conflict: approvedPolicyConflict,
    placeholder_difference: placeholderDifference,
    policy_requires_confirmation: policyRequiresConfirmation,
    policy_conflict: approvedPolicyConflict,
    maximum_stock_value: maximumStockValue,
    inventory_value_review_level: inventoryValueLevel,
    recommended_action: preservedPolicy?.policy_status === 'approved'
      ? approvedPolicyConflict
        ? 'keep_approved_and_review_difference'
        : 'keep_approved'
      : preservedPolicy
        ? policyRequiresConfirmation
          ? 'review_unconfirmed_policy'
          : 'use_automatic_draft_and_record_placeholder_difference'
      : manualReviewReasons.length > 0
        ? 'owner_review_required'
        : 'consider_for_matrix',
    confidence: quality.confidence,
    manual_review_required: reviewQueueMemberships.length > 0,
    manual_review_reasons: manualReviewReasons,
    review_queue_memberships: reviewQueueMemberships,
    evidence: {
      abc: row.abc || null,
      xyz: row.xyz || null,
      completed_weeks_used: stockPolicy.completedWeeksUsed,
      total_completed_weeks_available: stockPolicy.totalCompletedWeeksAvailable,
      invalid_completed_weeks: stockPolicy.invalidCompletedWeeks,
      weekly_sales: stockPolicy.weeklySales,
      average_weekly_sales: stockPolicy.averageWeeklySales,
      short_average: stockPolicy.shortAverage,
      base_average: stockPolicy.baseAverage,
      preferred_average: stockPolicy.preferredAverage,
      long_term_average: stockPolicy.longTermAverage,
      effective_average: stockPolicy.effectiveAverage,
      growth_cap_applied: stockPolicy.growthCapApplied,
      short_long_ratio: stockPolicy.shortLongRatio,
      weeks_with_sales: stockPolicy.weeksWithSales,
      active_week_ratio: stockPolicy.activeWeekRatio,
      category_profile: stockPolicy.categoryProfile,
      weekly_sales_standard_deviation: stockPolicy.weeklySalesStandardDeviation,
      lead_time_weeks: stockPolicy.leadTimeWeeks,
      safety_stock_formula: stockPolicy.safetyStockFormula,
      safety_stock_data_quality: stockPolicy.safetyStockDataQuality,
      policy_formula: stockPolicy.policyFormula,
      free_stock: finiteNumberOrNull(row.freeStock),
      stock_days: finiteNumberOrNull(row.stockDays),
      excess_stock: finiteNumberOrNull(row.excessStock),
      supplier_recommended_qty: finiteNumberOrNull(row.supplierOrderQty),
      supplier_need_qty: finiteNumberOrNull(row.needQty),
      purchase_price: purchasePrice,
      maximum_stock_value: maximumStockValue,
      inventory_value_review_level: inventoryValueLevel,
      supplier_order_sum: finiteNumberOrNull(row.supplierOrderSum),
      phase1_decision: phase1Decision?.decision || null,
      phase2_decision: phase2Decision?.decision || null,
      phase1_quantity: finiteNumberOrNull(phase1Decision?.calculatedOrderQuantity),
      phase2_quantity: finiteNumberOrNull(phase2Decision?.calculatedOrderQuantity),
      strategic_group_matches: roleResult.strategicGroups.map(group => ({
        id: group.id,
        brand: group.brand,
        required_tokens: group.required_tokens,
        required_token_groups: group.required_token_groups,
      })),
      exit_evaluation: roleResult.exitEvaluation,
    },
    data_quality: {
      confidence: quality.confidence,
      identity_ambiguous: ambiguousIdentity,
      stock_policy_status: stockPolicy.calculationStatus,
      missing_fields: [
        ...(row.freeStock === null ? ['free_stock'] : []),
        ...(row.stockDays === null ? ['stock_days'] : []),
        ...(stockPolicy.completedWeeksUsed < config.stock_policy.minimum_policy_data_weeks
          ? ['completed_weekly_sales']
          : []),
        ...(missingPurchasePrice ? ['purchase_price'] : []),
      ],
    },
    reason_codes: reasonCodes,
    explanation: explainReasonCodes(reasonCodes),
    notes: existingMatch?.item?.notes || '',
    provenance: {
      role: roleResult.provenance,
      priority: priorityResult.provenance,
      stock_policy: stockPolicy.provenance,
      existing_matrix: existingMatch
        ? {
          match_method: existingMatch.matchMethod,
          matrix_item_index: existingMatch.itemIndex,
          policy_status: existingMatch.item.policy_status,
          policy_preserved: existingMatch.item.policy_status === 'approved',
        }
        : null,
      source: {
        report_fingerprint: row.provenance?.reportFingerprint || null,
        worksheet: row.provenance?.worksheet || null,
        source_row_number: row.rowNumber,
        fields: row.provenance?.fields || {},
      },
    },
    validation: { errors: [], warnings: [] },
  };
}

function summarizeDraft(items) {
  const count = predicate => items.filter(predicate).length;
  const countRole = role => count(item => item.suggested_role === role);
  const countPriority = priority => count(item => item.suggested_priority === priority);
  const countConfidence = confidence => count(item => item.confidence === confidence);
  return {
    total_sku: items.length,
    roles: {
      CORE: countRole('CORE'),
      TRAFFIC: countRole('TRAFFIC'),
      PROFIT: countRole('PROFIT'),
      IMAGE: countRole('IMAGE'),
      SEASONAL: countRole('SEASONAL'),
      NEW: countRole('NEW'),
      OPTIONAL: countRole('OPTIONAL'),
      EXIT: countRole('EXIT'),
      UNCLASSIFIED: countRole('UNCLASSIFIED'),
    },
    priorities: {
      critical: countPriority('critical'),
      important: countPriority('important'),
      standard: countPriority('standard'),
      review: countPriority('review'),
    },
    confidence: {
      high: countConfidence('high'),
      medium: countConfidence('medium'),
      low: countConfidence('low'),
    },
    manual_review: count(item => item.manual_review_required),
    existing_matrix_items: count(item => item.existing_matrix_item),
    policy_conflicts: count(item => item.approved_policy_conflict),
    approved_policy_conflicts: count(item => item.approved_policy_conflict),
    placeholder_differences: count(item => item.placeholder_difference),
    policies_requiring_confirmation: count(item =>
      item.policy_requires_confirmation
    ),
    large_inventory_review: count(item =>
      item.review_queue_memberships.includes('large_inventory_review')
    ),
    review_queues: {
      identity_remediation: count(item =>
        item.review_queue_memberships.includes('identity_remediation')
      ),
      commercial_review: count(item =>
        item.review_queue_memberships.includes('commercial_review')
      ),
      exit_review: count(item =>
        item.review_queue_memberships.includes('exit_review')
      ),
      policy_conflict: count(item =>
        item.review_queue_memberships.includes('policy_conflict')
      ),
      large_inventory_review: count(item =>
        item.review_queue_memberships.includes('large_inventory_review')
      ),
      insufficient_data: count(item =>
        item.review_queue_memberships.includes('insufficient_data')
      ),
    },
    products_without_stock_policy: count(item =>
      item.suggested_minimum_shelf_stock === null ||
      item.suggested_target_stock === null ||
      item.suggested_maximum_stock === null
    ),
  };
}

function buildMatrixDraft({
  adapterResult,
  agentJson,
  config,
  generatedAt,
  inputPath,
  existingMatrix = null,
  existingMatrixPath = null,
}) {
  assertUsableAdapterResult(adapterResult);
  const phase1ByIdentity = decisionByIdentity(agentJson.phase1Decisions);
  const phase2ByIdentity = decisionByIdentity(agentJson.decisions);
  const existingMatchResult = existingMatrix
    ? matchAssortmentMatrix(existingMatrix, adapterResult.rows)
    : null;
  const duplicateRows = duplicateIdentityRows(adapterResult.diagnostics);
  const ambiguousRows = ambiguousMatrixRows(existingMatchResult);

  const items = adapterResult.rows.map(row => {
    const existingMatch = existingMatchResult?.matchesByRowIdentity.get(
      row.rowIdentity
    ) || null;
    return buildDraftItem({
      row,
      phase1Decision: phase1ByIdentity.get(row.rowIdentity),
      phase2Decision: phase2ByIdentity.get(row.rowIdentity),
      existingMatch,
      ambiguousIdentity: duplicateRows.has(row.rowIdentity) ||
        ambiguousRows.has(row.rowIdentity),
      config,
    });
  });
  const unmatchedExistingItems = existingMatchResult
    ? existingMatchResult.itemResults
      .filter(result => result.status !== 'matched')
      .map(result => ({
        matrix_item_index: result.itemIndex,
        status: result.status,
        article: existingMatrix.items[result.itemIndex].article,
        name: existingMatrix.items[result.itemIndex].name,
        candidate_row_identities: result.candidateRowIdentities,
      }))
    : [];
  const draftBase = {
    version: 1,
    builder_version: config.version,
    generated_at: generatedAt,
    source: {
      file: path.basename(inputPath || adapterResult.source.filePath || ''),
      report_timestamp: adapterResult.source.reportTimestamp,
      report_timestamp_source: adapterResult.source.reportTimestampSource,
      report_date: adapterResult.source.reportDate,
      report_date_source: adapterResult.source.reportDateSource,
      report_fingerprint: adapterResult.source.reportFingerprint,
      worksheet: adapterResult.source.sheetName,
      sku_count: adapterResult.rows.length,
      structural_row_count: adapterResult.serviceRows.length,
    },
    existing_matrix: existingMatrix
      ? {
        file: path.basename(existingMatrixPath || ''),
        version: existingMatrix.version,
        item_count: existingMatrix.items.length,
        unmatched_or_ambiguous_items: unmatchedExistingItems,
      }
      : null,
    config: {
      version: config.version,
      status: config.status,
      core_policy: config.core_policy,
      exit_policy: config.exit_policy,
      stock_policy: config.stock_policy,
      inventory_value_review: config.inventory_value_review,
    },
    status: 'draft',
    warnings: [
      'Matrix Builder создаёт рекомендации и не изменяет рабочую ассортиментную матрицу.',
      ...(unmatchedExistingItems.length > 0
        ? ['Не все позиции действующей матрицы сопоставлены однозначно.']
        : []),
    ],
    items,
  };
  const validated = validateMatrixDraft(draftBase, config).draft;
  validated.summary = summarizeDraft(validated.items);
  validated.review_queues = Object.fromEntries(
    Object.keys(validated.summary.review_queues).map(queue => [
      queue,
      validated.items
        .filter(item => item.review_queue_memberships.includes(queue))
        .map(item => item.rowIdentity),
    ])
  );
  return validated;
}

function buildManualReviewFile(draft) {
  const items = draft.items.filter(item => item.review_queue_memberships.length > 0);
  const queueNames = [
    'identity_remediation',
    'commercial_review',
    'exit_review',
    'policy_conflict',
    'large_inventory_review',
    'insufficient_data',
  ];
  return {
    version: 1,
    generated_at: draft.generated_at,
    status: 'draft_manual_review_queue',
    source: draft.source,
    item_count: items.length,
    items,
    review_queues: Object.fromEntries(queueNames.map(queue => [
      queue,
      items.filter(item => item.review_queue_memberships.includes(queue)),
    ])),
  };
}

async function buildMatrixDraftFromSmartZapasXlsx(filePath, options = {}) {
  const configResult = loadMatrixBuilderConfig(
    options.configPath || DEFAULT_MATRIX_BUILDER_CONFIG_PATH
  );
  const adapterResult = await readSmartZapasExport(filePath, {
    reportDate: options.reportDate,
    reportTimestamp: options.reportTimestamp,
  });
  const existingResult = options.existingMatrixPath
    ? loadAssortmentMatrix(options.existingMatrixPath)
    : null;
  const agentJson = runOrderAgentFromAdapterResultWithDemand(
    adapterResult,
    { purchasingProfile: 'miska' },
    existingResult
      ? { assortmentMatrixPath: existingResult.sourcePath }
      : {}
  )[0].json;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const draft = buildMatrixDraft({
    adapterResult,
    agentJson,
    config: configResult.config,
    generatedAt,
    inputPath: filePath,
    existingMatrix: existingResult?.matrix || null,
    existingMatrixPath: existingResult?.sourcePath || null,
  });
  const manualReview = buildManualReviewFile(draft);
  const reportText = buildMatrixBuilderReport(draft, manualReview);

  return {
    draft,
    manualReview,
    reportText,
    config: configResult.config,
    configPath: configResult.sourcePath,
    adapterResult,
  };
}

module.exports = {
  DEFAULT_MATRIX_BUILDER_CONFIG_PATH,
  duplicateIdentityRows,
  ambiguousMatrixRows,
  policiesConflict,
  policiesDiffer,
  effectivePolicy,
  buildDraftItem,
  summarizeDraft,
  buildMatrixDraft,
  buildManualReviewFile,
  buildMatrixDraftFromSmartZapasXlsx,
};
