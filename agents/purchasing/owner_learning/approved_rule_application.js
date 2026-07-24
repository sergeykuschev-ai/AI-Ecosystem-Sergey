const {
  MISKA_FINANCIAL_CONTROLLER_CONFIG,
} = require('../config');
const {
  roundMoney,
} = require('../services/financial_controller');
const {
  buildStableItemKey,
  stableKeyContext,
} = require('./owner_learning_history');
const {
  normalizeAgentRecommendation,
} = require('./owner_learning_report');
const {
  buildApprovedRulePreview,
  buildApprovedRulePreviewMarkdown,
  unavailableApprovedRulePreview,
  unavailableApprovedRulePreviewMarkdown,
} = require('./approved_rule_preview');
const {
  APPLICATION_STATUS,
  applyApprovedRule,
} = require('./rule_application_engine');
const {
  RECALCULATION_STATUS,
  recalculateFinancialSummary,
} = require('./financial_recalculation');

const APPROVED_RULE_MODES = Object.freeze([
  'OFF',
  'PREVIEW',
  'APPLY_SAFE',
]);
const DEFAULT_APPROVED_RULE_MODE = 'PREVIEW';
const APPLICATION_REPORT_VERSION =
  'approved-rule-applications-v0.6.3';

function optionalString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function normalizeApprovedRuleMode(value) {
  const requestedMode = optionalString(value)?.toUpperCase() || null;
  if (requestedMode === null) {
    return {
      requestedMode: null,
      mode: DEFAULT_APPROVED_RULE_MODE,
      warnings: [],
    };
  }
  if (APPROVED_RULE_MODES.includes(requestedMode)) {
    return { requestedMode, mode: requestedMode, warnings: [] };
  }
  return {
    requestedMode,
    mode: DEFAULT_APPROVED_RULE_MODE,
    warnings: [{
      code: 'UNKNOWN_APPROVED_RULE_MODE',
      message:
        'Неизвестный режим Approved Rules заменён безопасным PREVIEW.',
    }],
  };
}

function agentJsonFromResult(agentResult) {
  const agentJson = Array.isArray(agentResult)
    ? agentResult[0]?.json
    : null;
  if (!agentJson || typeof agentJson !== 'object') {
    throw new TypeError(
      'Approved Rule Application требует результат Purchasing Agent.'
    );
  }
  return agentJson;
}

function productsFromAgent(agentJson) {
  return Array.isArray(agentJson.workingOrderProducts)
    ? agentJson.workingOrderProducts
    : [];
}

function itemForStableKey(product) {
  return {
    sku: product.article || product.sku || null,
    barcode: product.barcode || product.matchingHints?.barcode || null,
    rowId: product.rowIdentity || product.rowId || null,
    itemId: product.rowIdentity || product.rowId || null,
    name: product.name || null,
    brand: product.brand || null,
  };
}

function indexProducts(agentJson) {
  const products = productsFromAgent(agentJson);
  const stableItems = products.map(itemForStableKey);
  const context = stableKeyContext(stableItems);
  const byStableItemKey = new Map();
  const stableItemKeys = [];
  products.forEach((product, index) => {
    const stableItemKey = buildStableItemKey(stableItems[index], context);
    stableItemKeys.push(stableItemKey);
    byStableItemKey.set(stableItemKey, {
      product,
      index,
      stableItemKey,
    });
  });
  return { products, byStableItemKey, stableItemKeys };
}

function finiteNonNegative(value) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0;
}

function agentQuantity(product) {
  return finiteNonNegative(product.approvedOrderQuantity)
    ? product.approvedOrderQuantity
    : 0;
}

function agentRecommendation(product, decisionsByIdentity) {
  const decision = decisionsByIdentity.get(product.rowIdentity);
  return normalizeAgentRecommendation(
    decision?.decision || product.phase2Decision || product.workflowStatus
  ) || 'UNKNOWN';
}

function orderLine(product, application, decisionsByIdentity) {
  return {
    finalRecommendation: application?.finalRecommendation ||
      agentRecommendation(product, decisionsByIdentity),
    finalQuantity: application?.finalQuantity ?? agentQuantity(product),
    unitPrice: product.priceNum ?? null,
  };
}

function previousFinancialSummary(agentJson) {
  const assessment = agentJson.financial_assessment || {};
  return {
    currency: assessment.currency || null,
    available_after_expenses: assessment.available_after_expenses,
    minimum_reserve: assessment.minimum_reserve,
    warning_reserve_surplus_threshold:
      MISKA_FINANCIAL_CONTROLLER_CONFIG.warning_reserve_surplus,
  };
}

function emptyApplicationReport(mode, status, errorCode = null) {
  return {
    reportVersion: APPLICATION_REPORT_VERSION,
    mode,
    status,
    errorCode,
    activeRules: null,
    matches: null,
    applied: 0,
    unchanged: 0,
    manualReview: 0,
    blockedConflicts: 0,
    blockedInvalid: 0,
    amountBefore: null,
    amountAfter: null,
    skuBefore: null,
    skuAfter: null,
    unitsBefore: null,
    unitsAfter: null,
    financialStatusBefore: null,
    financialStatusAfter: null,
    appliedWorkingOrderFinancialAssessment: null,
    applications: [],
  };
}

function fallbackApplicationReport(mode, errorCode, preview = null) {
  return {
    ...emptyApplicationReport(
      mode,
      'FALLBACK_TO_BASELINE',
      errorCode
    ),
    activeRules: preview?.activeRulesCount ?? null,
    matches: preview?.matchedRulesCount ?? null,
    blockedConflicts: preview?.conflictingRulesCount ?? 0,
    blockedInvalid: preview?.ignoredInvalidRulesCount ?? 0,
  };
}

function errorCode(error, fallback) {
  return optionalString(error?.code) || fallback;
}

function safeWarning(code) {
  return {
    code,
    message:
      'Approved Rules временно недоступны; сохранён исходный расчёт.',
  };
}

function applicationRecord(entry, previewMatch, result) {
  return {
    rowIdentity: entry.product.rowIdentity || null,
    name: previewMatch.name || entry.product.name || null,
    brand: previewMatch.brand || entry.product.brand || null,
    agentRecommendation: result.agentRecommendation,
    agentQuantity: result.agentQuantity,
    finalRecommendation: result.finalRecommendation,
    finalQuantity: result.finalQuantity,
    applicationStatus: result.applicationStatus,
    ruleApplied: result.ruleApplied,
    ruleId: result.ruleId,
    stableItemKey: result.stableItemKey,
    applicationReason: result.reason,
    diagnostics: structuredClone(result.diagnostics),
  };
}

function applyPreviewMatches({
  preview,
  productIndex,
  decisionsByIdentity,
  ruleApplication,
}) {
  const applications = [];
  const applicationByStableItemKey = new Map();
  const candidates = [
    ...(preview.matches || []),
    ...(preview.conflicts || []).map(conflict => ({
      ...conflict,
      conflict: true,
    })),
  ];

  for (const previewMatch of candidates) {
    const entry = productIndex.byStableItemKey.get(
      previewMatch.stableItemKey
    );
    if (!entry) continue;
    const result = ruleApplication({
      agentRecommendation: agentRecommendation(
        entry.product,
        decisionsByIdentity
      ),
      agentQuantity: agentQuantity(entry.product),
      previewMatch,
    });
    const record = applicationRecord(entry, previewMatch, result);
    applications.push(record);
    applicationByStableItemKey.set(entry.stableItemKey, record);
  }

  return { applications, applicationByStableItemKey };
}

function lineSum(quantity, price) {
  if (quantity === 0) return 0;
  if (!finiteNonNegative(quantity) || !finiteNonNegative(price)) return null;
  return roundMoney(quantity * price);
}

function sumPositiveProducts(products, quantityFor) {
  let sum = 0;
  for (const product of products) {
    const quantity = quantityFor(product);
    if (!finiteNonNegative(quantity) || quantity === 0) continue;
    const value = lineSum(quantity, product.priceNum);
    if (value === null) return null;
    sum = roundMoney(sum + value);
  }
  return sum;
}

function finalApplicationByRow(applications) {
  return new Map(applications.map(application => [
    application.rowIdentity,
    application,
  ]));
}

function publishAppliedResult({
  agentResult,
  applications,
}) {
  const nextResult = structuredClone(agentResult);
  const agentJson = agentJsonFromResult(nextResult);
  const byRow = finalApplicationByRow(applications);

  agentJson.workingOrderProducts = productsFromAgent(agentJson).map(
    product => {
      const application = byRow.get(product.rowIdentity);
      if (!application) return product;
      const nextProduct = {
        ...product,
        approvedRuleApplication: structuredClone(application),
      };
      if (application.ruleApplied) {
        nextProduct.approvedOrderQuantity = application.finalQuantity;
        nextProduct.approvedLineSum = lineSum(
          application.finalQuantity,
          product.priceNum
        );
      }
      return nextProduct;
    }
  );
  agentJson.decisions = (agentJson.decisions || []).map(decision => {
    const application = byRow.get(decision.rowIdentity);
    if (!application) return decision;
    const nextDecision = {
      ...decision,
      approvedRuleApplication: structuredClone(application),
    };
    if (application.ruleApplied) {
      nextDecision.approvedOrderQuantity = application.finalQuantity;
    }
    return nextDecision;
  });

  const autoApproved = agentJson.workingOrderProducts.filter(product =>
    product.workflowStatus === 'auto_approved' &&
    finiteNonNegative(product.approvedOrderQuantity) &&
    product.approvedOrderQuantity > 0
  );
  const workingMaximum = agentJson.workingOrderProducts.filter(product => {
    if (product.workflowStatus === 'auto_approved') {
      return finiteNonNegative(product.approvedOrderQuantity) &&
        product.approvedOrderQuantity > 0;
    }
    return product.workflowStatus === 'pending_manual_review' &&
      finiteNonNegative(product.provisionalOrderQuantity) &&
      product.provisionalOrderQuantity > 0;
  });
  agentJson.autoApprovedLines = autoApproved.length;
  agentJson.autoApprovedSum = sumPositiveProducts(
    autoApproved,
    product => product.approvedOrderQuantity
  );
  agentJson.workingMaximumLines = workingMaximum.length;
  agentJson.workingMaximumSum = sumPositiveProducts(
    workingMaximum,
    product => product.workflowStatus === 'auto_approved'
      ? product.approvedOrderQuantity
      : product.provisionalOrderQuantity
  );
  return nextResult;
}

function appliedWorkingOrderFinancialAssessment(
  baselineRecalculation,
  finalRecalculation
) {
  return {
    amountBefore: baselineRecalculation.totalOrderAmount,
    amountAfter: finalRecalculation.totalOrderAmount,
    skuBefore: baselineRecalculation.orderedSkuCount,
    skuAfter: finalRecalculation.orderedSkuCount,
    unitsBefore: baselineRecalculation.orderedUnits,
    unitsAfter: finalRecalculation.orderedUnits,
    availableAfterOrder: finalRecalculation.availableAfterOrder,
    reserveSurplus: finalRecalculation.reserveSurplus,
    maximumSafeOrderAmount:
      finalRecalculation.maximumSafeOrderAmount,
    financialStatus: finalRecalculation.financialStatus,
    financiallyPermitted: finalRecalculation.financiallyPermitted,
    recalculationStatus: finalRecalculation.recalculationStatus,
  };
}

function reportFrom({
  preview,
  applications,
  baselineRecalculation,
  finalRecalculation,
}) {
  const count = status => applications.filter(
    application => application.applicationStatus === status
  ).length;
  const blockedInvalidStatuses = new Set([
    APPLICATION_STATUS.BLOCKED_INVALID_RULE,
    APPLICATION_STATUS.BLOCKED_UNKNOWN_RECOMMENDATION,
    APPLICATION_STATUS.BLOCKED_INVALID_QUANTITY,
  ]);
  return {
    reportVersion: APPLICATION_REPORT_VERSION,
    mode: 'APPLY_SAFE',
    status: 'APPLIED',
    errorCode: null,
    activeRules: preview.activeRulesCount,
    matches: preview.matchedRulesCount,
    applied: count(APPLICATION_STATUS.APPLIED),
    unchanged: count(APPLICATION_STATUS.UNCHANGED),
    manualReview: count(APPLICATION_STATUS.MANUAL_REVIEW),
    blockedConflicts: count(APPLICATION_STATUS.BLOCKED_CONFLICT),
    blockedInvalid:
      (preview.ignoredInvalidRulesCount || 0) +
      applications.filter(application =>
        blockedInvalidStatuses.has(application.applicationStatus)
      ).length,
    amountBefore: baselineRecalculation.totalOrderAmount,
    amountAfter: finalRecalculation.totalOrderAmount,
    skuBefore: baselineRecalculation.orderedSkuCount,
    skuAfter: finalRecalculation.orderedSkuCount,
    unitsBefore: baselineRecalculation.orderedUnits,
    unitsAfter: finalRecalculation.orderedUnits,
    financialStatusBefore: baselineRecalculation.financialStatus,
    financialStatusAfter: finalRecalculation.financialStatus,
    appliedWorkingOrderFinancialAssessment:
      appliedWorkingOrderFinancialAssessment(
        baselineRecalculation,
        finalRecalculation
      ),
    applications: structuredClone(applications),
  };
}

function processApprovedRules(input = {}, dependencyOverrides = {}) {
  const modeState = normalizeApprovedRuleMode(input.approvedRuleMode);
  const base = {
    agentResult: input.agentResult,
    requestedMode: modeState.requestedMode,
    mode: modeState.mode,
    warnings: [...modeState.warnings],
    approvedRulePreview: null,
    approvedRulePreviewReport: null,
    approvedRulePreviewError: null,
    approvedRuleApplications: null,
  };
  if (modeState.mode === 'OFF') return base;

  const dependencies = {
    loadApprovedRules: input.loadApprovedRules,
    buildPreview: buildApprovedRulePreview,
    buildPreviewMarkdown: buildApprovedRulePreviewMarkdown,
    applyRule: applyApprovedRule,
    recalculate: recalculateFinancialSummary,
    ...dependencyOverrides,
  };

  let preview;
  let previewReport;
  try {
    const approvedRules = input.approvedRules ||
      dependencies.loadApprovedRules({
        registryPath: input.approvedRulesPath,
        logger: { error() {} },
        ...(input.approvedRulesLoadOptions || {}),
      });
    preview = dependencies.buildPreview({
      agentResult: input.agentResult,
      approvedRules,
      generatedAt: input.generatedAt,
    });
    previewReport = dependencies.buildPreviewMarkdown(preview);
  } catch (error) {
    const code = errorCode(
      error,
      'APPROVED_RULE_PREVIEW_UNAVAILABLE'
    );
    return {
      ...base,
      warnings: [...base.warnings, safeWarning(code)],
      approvedRulePreview: unavailableApprovedRulePreview(
        input.generatedAt,
        code
      ),
      approvedRulePreviewReport:
        unavailableApprovedRulePreviewMarkdown(),
      approvedRulePreviewError: code,
      approvedRuleApplications: modeState.mode === 'APPLY_SAFE'
        ? fallbackApplicationReport(
          modeState.mode,
          code
        )
        : null,
    };
  }

  const withPreview = {
    ...base,
    approvedRulePreview: preview,
    approvedRulePreviewReport: previewReport,
  };
  if (modeState.mode === 'PREVIEW') return withPreview;

  try {
    const agentJson = agentJsonFromResult(input.agentResult);
    const productIndex = indexProducts(agentJson);
    const decisionsByIdentity = new Map(
      (agentJson.decisions || []).map(decision => [
        decision.rowIdentity,
        decision,
      ])
    );
    const applicationResult = applyPreviewMatches({
      preview,
      productIndex,
      decisionsByIdentity,
      ruleApplication: dependencies.applyRule,
    });
    const baselineLines = productIndex.products.map(product =>
      orderLine(product, null, decisionsByIdentity)
    );
    const finalLines = productIndex.products.map((product, index) =>
      orderLine(
        product,
        applicationResult.applicationByStableItemKey.get(
          productIndex.stableItemKeys[index]
        ),
        decisionsByIdentity
      )
    );
    const financialSummary = previousFinancialSummary(agentJson);
    const baselineRecalculation = dependencies.recalculate({
      orderLines: baselineLines,
      previousSummary: financialSummary,
    });
    const finalRecalculation = dependencies.recalculate({
      orderLines: finalLines,
      previousSummary: financialSummary,
    });
    if (
      baselineRecalculation.recalculationStatus !==
        RECALCULATION_STATUS.COMPLETE ||
      finalRecalculation.recalculationStatus !==
        RECALCULATION_STATUS.COMPLETE
    ) {
      const error = new Error('Financial recalculation is incomplete.');
      error.code = finalRecalculation.reason ||
        baselineRecalculation.reason ||
        'FINANCIAL_RECALCULATION_INCOMPLETE';
      throw error;
    }
    const report = reportFrom({
      preview,
      applications: applicationResult.applications,
      baselineRecalculation,
      finalRecalculation,
    });
    if (report.applied === 0) {
      return {
        ...withPreview,
        approvedRuleApplications: report,
      };
    }
    return {
      ...withPreview,
      agentResult: publishAppliedResult({
        agentResult: input.agentResult,
        applications: applicationResult.applications,
      }),
      approvedRuleApplications: report,
    };
  } catch (error) {
    const code = errorCode(
      error,
      'APPROVED_RULE_APPLICATION_UNAVAILABLE'
    );
    return {
      ...withPreview,
      warnings: [...withPreview.warnings, safeWarning(code)],
      approvedRuleApplications: fallbackApplicationReport(
        modeState.mode,
        code,
        preview
      ),
    };
  }
}

module.exports = {
  APPLICATION_REPORT_VERSION,
  APPROVED_RULE_MODES,
  DEFAULT_APPROVED_RULE_MODE,
  emptyApplicationReport,
  fallbackApplicationReport,
  normalizeApprovedRuleMode,
  processApprovedRules,
};
