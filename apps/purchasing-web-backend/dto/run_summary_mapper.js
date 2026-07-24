const { safePublicText } = require('./api_error_mapper');

function agentJson(bundle) {
  return Array.isArray(bundle.agentResult)
    ? bundle.agentResult[0]?.json || {}
    : {};
}

function roundCurrency(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : null;
}

function sumCurrency(items, field) {
  if (!Array.isArray(items)) return null;
  return roundCurrency(items.reduce((sum, item) => {
    const value = item?.[field];
    return sum + (
      typeof value === 'number' && Number.isFinite(value) ? value : 0
    );
  }, 0));
}

function decisionSummary(summary = {}) {
  return {
    must_buy: summary.mustBuyCount ?? 0,
    recommended: summary.recommendedCount ?? 0,
    manual_review: summary.manualReviewCount ?? 0,
    postpone: summary.postponeCount ?? 0,
    do_not_buy: summary.doNotBuyCount ?? 0,
  };
}

function diagnosticCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function collectWarnings(agent, applicationWarnings = []) {
  const assessment = agent.financial_assessment || {};
  const values = [
    ...(agent.reportWarnings || []),
    ...(assessment.financial_data_warnings || []),
    ...(assessment.financial_data_errors || []),
    ...(Array.isArray(applicationWarnings)
      ? applicationWarnings.map(warning => warning?.code || warning)
      : []),
  ];
  return Array.from(new Set(values.map(value => safePublicText(
    value,
    'Диагностическое предупреждение скрыто.'
  ))));
}

function appliedWorkingOrderFinancial(bundle) {
  const applications = bundle.approvedRuleApplications;
  const assessment =
    applications?.appliedWorkingOrderFinancialAssessment;
  if (
    !assessment ||
    typeof assessment !== 'object' ||
    (applications.applied ?? 0) <= 0
  ) return null;
  return {
    amount_before: roundCurrency(assessment.amountBefore),
    amount_after: roundCurrency(assessment.amountAfter),
    sku_before: assessment.skuBefore ?? null,
    sku_after: assessment.skuAfter ?? null,
    units_before: assessment.unitsBefore ?? null,
    units_after: assessment.unitsAfter ?? null,
    available_after_order:
      roundCurrency(assessment.availableAfterOrder),
    reserve_surplus: roundCurrency(assessment.reserveSurplus),
    maximum_safe_order_amount:
      roundCurrency(assessment.maximumSafeOrderAmount),
    financial_status: assessment.financialStatus || null,
    financially_permitted:
      assessment.financiallyPermitted ?? null,
    recalculation_status: assessment.recalculationStatus || null,
  };
}

function mapRunSummary(bundle) {
  const agent = agentJson(bundle);
  const assessment = agent.financial_assessment || {};
  const matrix = bundle.matrixDraft?.summary || {};
  const ownerReview = bundle.ownerReview?.summary || {};
  const diagnostics = agent.adapter_diagnostics || {};
  const analyzerOrderSum = sumCurrency(
    agent.workingOrderProducts,
    'phase1LineSum'
  );

  return {
    run_id: bundle.run_id,
    sku_count: agent.product_rows_count ?? null,
    source_rows_count: agent.source_rows_count ?? null,
    structural_rows_count:
      Number.isInteger(agent.source_rows_count) &&
      Number.isInteger(agent.product_rows_count)
        ? agent.source_rows_count - agent.product_rows_count
        : null,
    currency: assessment.currency || null,
    amounts: {
      analyzer_order_sum: analyzerOrderSum,
      auto_approved_sum: roundCurrency(agent.autoApprovedSum),
      pending_review_sum: roundCurrency(
        agent.pendingReviewProvisionalSum
      ),
      working_maximum_sum: roundCurrency(agent.workingMaximumSum),
      financially_assessed_sum: roundCurrency(
        assessment.proposed_order_amount
      ),
    },
    financial: {
      status: assessment.status || null,
      reserve_surplus: roundCurrency(assessment.reserve_surplus),
      recommendation: assessment.recommendation || null,
      advisory_only: assessment.advisory_only === true,
    },
    applied_working_order_financial:
      appliedWorkingOrderFinancial(bundle),
    phase1: decisionSummary(agent.phase1DecisionSummary),
    phase2: decisionSummary({
      mustBuyCount: agent.mustBuyCount,
      recommendedCount: agent.recommendedCount,
      manualReviewCount: agent.manualReviewCount,
      postponeCount: agent.postponeCount,
      doNotBuyCount: agent.doNotBuyCount,
    }),
    matrix: {
      roles: structuredClone(matrix.roles || {}),
      approved_conflicts: matrix.approved_policy_conflicts ?? 0,
      placeholder_differences: matrix.placeholder_differences ?? 0,
      manual_review: matrix.manual_review ?? 0,
      large_inventory_review: matrix.large_inventory_review ?? 0,
    },
    owner_review: {
      action_required: ownerReview.owner_action_required_total ?? 0,
      top_priority: ownerReview.owner_action_displayed ?? 0,
      exit_approval: ownerReview.exit_approval ?? 0,
      commercial_review: ownerReview.commercial_review ?? 0,
    },
    diagnostics: {
      missing_required_columns: diagnosticCount(
        diagnostics.missingRequiredColumns
      ),
      ambiguous_columns: diagnosticCount(diagnostics.ambiguousColumns),
      ambiguous_rows: diagnosticCount(
        diagnostics.ambiguousRowClassifications
      ),
      duplicate_identifier_warnings: diagnosticCount(
        diagnostics.duplicateIdentifiers
      ),
      report_date_warnings: diagnosticCount(
        diagnostics.reportDateWarnings
      ),
    },
    warnings: collectWarnings(agent, bundle.approvedRuleWarnings),
  };
}

module.exports = {
  agentJson,
  collectWarnings,
  decisionSummary,
  mapRunSummary,
  roundCurrency,
  sumCurrency,
};
