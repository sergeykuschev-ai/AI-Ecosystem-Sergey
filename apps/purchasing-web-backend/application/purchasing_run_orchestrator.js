const {
  runOrderAgentFromSmartZapasXlsxWithDemand,
} = require('../../../agents/purchasing/order_agent');
const {
  buildMatrixDraftFromSmartZapasXlsx,
} = require('../../../agents/purchasing/matrix_builder/matrix_builder');
const {
  applyOwnerDecisions,
  loadOwnerDecisions,
} = require('../../../agents/purchasing/matrix_builder/owner_decisions');
const {
  loadDecisionHistory,
} = require('../../../agents/purchasing/owner_learning/owner_decision_history');
const {
  buildOwnerReviewModel,
  buildOwnerReviewReport,
} = require(
  '../../../agents/purchasing/matrix_builder/owner_review_dashboard'
);
const {
  buildRecommendationExplanations,
  buildRecommendationExplanationsReport,
} = require(
  '../../../agents/purchasing/explanations/recommendation_explainer'
);
const {
  buildOwnerLearningInput,
  buildOwnerLearningMarkdown,
  buildOwnerLearningReport,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_report'
);
const {
  buildHistoryRunEntry,
} = require(
  '../../../agents/purchasing/owner_learning/owner_learning_history'
);
const {
  DEFAULT_REGISTRY_PATH: DEFAULT_APPROVED_RULES_PATH,
  loadApprovedRules,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_registry'
);
const {
  processApprovedRules,
} = require(
  '../../../agents/purchasing/owner_learning/approved_rule_application'
);
const {
  recordRuleEffectivenessForRun,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_effectiveness_recorder'
);
const {
  DEFAULT_RULE_EFFECTIVENESS_PATH,
} = require(
  '../../../agents/purchasing/owner_learning/owner_rule_effectiveness'
);
const {
  PurchasingWebApplicationError,
} = require('./application_error');

const DEFAULT_DEPENDENCIES = Object.freeze({
  runAgent: runOrderAgentFromSmartZapasXlsxWithDemand,
  buildMatrix: buildMatrixDraftFromSmartZapasXlsx,
  loadOwnerDecisions,
  applyOwnerDecisions,
  loadDecisionHistory,
  buildOwnerReview: buildOwnerReviewModel,
  buildOwnerReviewReport,
  buildExplanations: buildRecommendationExplanations,
  buildExplanationsReport: buildRecommendationExplanationsReport,
  buildOwnerLearning: buildOwnerLearningReport,
  buildOwnerLearningMarkdown,
  loadApprovedRules,
  processApprovedRules,
  recordRuleEffectiveness: recordRuleEffectivenessForRun,
});

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PurchasingWebApplicationError(
      'INVALID_RUN_REQUEST',
      `Поле ${field} должно быть непустой строкой.`
    );
  }
}

function validateRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new PurchasingWebApplicationError(
      'INVALID_RUN_REQUEST',
      'Параметры application run должны быть объектом.'
    );
  }
  [
    'runId',
    'inputPath',
    'generatedAt',
    'financialDataPath',
    'configPath',
    'matrixPath',
    'ownerDecisionsPath',
  ].forEach(field => assertNonEmptyString(request[field], field));

  const generatedAt = new Date(request.generatedAt);
  if (
    !Number.isFinite(generatedAt.getTime()) ||
    generatedAt.toISOString() !== request.generatedAt
  ) {
    throw new PurchasingWebApplicationError(
      'INVALID_RUN_REQUEST',
      'Поле generatedAt должно быть точной ISO-датой.'
    );
  }
  if (
    request.recommendationConfigPath !== undefined &&
    (typeof request.recommendationConfigPath !== 'string' ||
      request.recommendationConfigPath.trim() === '')
  ) {
    throw new PurchasingWebApplicationError(
      'INVALID_RUN_REQUEST',
      'Поле recommendationConfigPath должно быть непустой строкой.'
    );
  }
  if (
    request.ownerLearningRuleEffectivenessFilePath !== undefined &&
    (
      typeof request.ownerLearningRuleEffectivenessFilePath !== 'string' ||
      request.ownerLearningRuleEffectivenessFilePath.trim() === ''
    )
  ) {
    throw new PurchasingWebApplicationError(
      'INVALID_RUN_REQUEST',
      'Путь effectiveness journal должен быть непустой строкой.'
    );
  }
}

function agentJsonFromResult(agentResult) {
  const agentJson = Array.isArray(agentResult)
    ? agentResult[0]?.json
    : null;
  if (!agentJson || typeof agentJson !== 'object') {
    throw new PurchasingWebApplicationError(
      'RUN_CONSISTENCY_ERROR',
      'Purchasing Agent вернул некорректный application contract.'
    );
  }
  return agentJson;
}

function stableProductSku(product) {
  return product.article ||
    product.barcode ||
    product.internalProductId ||
    product.rowIdentity;
}

function productRows(agentJson) {
  if (Array.isArray(agentJson.demandProducts)) {
    return agentJson.demandProducts;
  }
  if (Array.isArray(agentJson.workingOrderProducts)) {
    return agentJson.workingOrderProducts;
  }
  return [];
}

function uniqueIdentitySet(items, label) {
  const identities = new Set();
  for (const item of items) {
    if (typeof item?.rowIdentity !== 'string' || item.rowIdentity === '') {
      throw new PurchasingWebApplicationError(
        'RUN_CONSISTENCY_ERROR',
        `${label} содержит SKU без стабильной идентичности.`
      );
    }
    if (identities.has(item.rowIdentity)) {
      throw new PurchasingWebApplicationError(
        'RUN_CONSISTENCY_ERROR',
        `${label} содержит повторяющуюся стабильную идентичность.`
      );
    }
    identities.add(item.rowIdentity);
  }
  return identities;
}

function sectionReferences(value, references = []) {
  if (Array.isArray(value)) {
    value.forEach(reference => references.push(reference));
    return references;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(child => sectionReferences(child, references));
  }
  return references;
}

function assertKnownReferences(items, knownIdentities, label) {
  for (const item of items) {
    const reference = typeof item === 'string' ? item : item?.rowIdentity;
    if (
      typeof reference !== 'string' ||
      !knownIdentities.has(reference)
    ) {
      throw new PurchasingWebApplicationError(
        'RUN_CONSISTENCY_ERROR',
        `${label} содержит ссылку на неизвестный SKU.`
      );
    }
  }
}

function assertExplanationCoverage(products, explanations) {
  const explanationItems = explanations?.items;
  if (
    !Array.isArray(explanationItems) ||
    explanations.source_product_count !== products.length ||
    explanations.explained_sku_count !== products.length ||
    explanationItems.length !== products.length
  ) {
    throw new PurchasingWebApplicationError(
      'RUN_CONSISTENCY_ERROR',
      'Recommendation Explainer покрыл не все SKU Purchasing Agent.'
    );
  }

  products.forEach((product, index) => {
    if (explanationItems[index]?.sku !== stableProductSku(product)) {
      throw new PurchasingWebApplicationError(
        'RUN_CONSISTENCY_ERROR',
        'Recommendation Explainer нарушил соответствие SKU.'
      );
    }
  });
}

function assertRunConsistency({
  agentResult,
  matrixDraft,
  manualReview,
  ownerReview,
  explanations,
}) {
  const agentJson = agentJsonFromResult(agentResult);
  const products = productRows(agentJson);
  const expectedCount = agentJson.product_rows_count;
  const matrixItems = matrixDraft?.items;
  const ownerReviewItems = ownerReview?.items;

  if (
    !Number.isInteger(expectedCount) ||
    expectedCount < 0 ||
    products.length !== expectedCount ||
    !Array.isArray(matrixItems) ||
    matrixItems.length !== expectedCount ||
    !Array.isArray(ownerReviewItems) ||
    ownerReviewItems.length !== expectedCount
  ) {
    throw new PurchasingWebApplicationError(
      'RUN_CONSISTENCY_ERROR',
      'Количество SKU между application-компонентами не совпадает.'
    );
  }

  const productIdentities = uniqueIdentitySet(products, 'Purchasing Agent');
  const matrixIdentities = uniqueIdentitySet(matrixItems, 'Matrix Builder');
  if (
    productIdentities.size !== matrixIdentities.size ||
    Array.from(productIdentities).some(
      identity => !matrixIdentities.has(identity)
    )
  ) {
    throw new PurchasingWebApplicationError(
      'RUN_CONSISTENCY_ERROR',
      'Наборы SKU Purchasing Agent и Matrix Builder не совпадают.'
    );
  }

  assertExplanationCoverage(products, explanations);
  assertKnownReferences(ownerReviewItems, matrixIdentities, 'Owner Review');
  assertKnownReferences(
    sectionReferences(ownerReview.sections),
    matrixIdentities,
    'Owner Review'
  );
  assertKnownReferences(
    Array.isArray(manualReview?.items) ? manualReview.items : [],
    matrixIdentities,
    'Manual Review'
  );
}

function stageError(code, message, cause) {
  if (cause instanceof PurchasingWebApplicationError) return cause;
  return new PurchasingWebApplicationError(code, message, { cause });
}

async function runPurchasingWebOrchestrator(
  request,
  dependencyOverrides = {}
) {
  validateRequest(request);
  const dependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...dependencyOverrides,
  };

  let agentResult;
  try {
    agentResult = await dependencies.runAgent(
      request.inputPath,
      { purchasingProfile: 'miska' },
      {
        financialDataPath: request.financialDataPath,
        assortmentMatrixPath: request.matrixPath,
      }
    );
  } catch (error) {
    throw stageError(
      'PURCHASING_RUN_FAILED',
      'Не удалось выполнить Purchasing Agent.',
      error
    );
  }

  let approvedRulesRegistry = null;
  const approvedRuleProcessing = dependencies.processApprovedRules({
    agentResult,
    approvedRuleMode: request.approvedRuleMode,
    approvedRulesPath: request.approvedRulesPath ||
      DEFAULT_APPROVED_RULES_PATH,
    loadApprovedRules: dependencies.loadApprovedRules,
    generatedAt: request.generatedAt,
    onApprovedRulesLoaded(value) {
      approvedRulesRegistry = value;
    },
  }, dependencyOverrides.approvedRuleApplicationDependencies || {});
  agentResult = approvedRuleProcessing.agentResult;

  let matrixResult;
  try {
    matrixResult = await dependencies.buildMatrix(request.inputPath, {
      configPath: request.configPath,
      existingMatrixPath: request.matrixPath,
      generatedAt: request.generatedAt,
    });
  } catch (error) {
    throw stageError(
      'MATRIX_BUILD_FAILED',
      'Не удалось выполнить Matrix Builder.',
      error
    );
  }

  const agentJson = agentJsonFromResult(agentResult);

  let ownerApplication;
  let ownerReview;
  let ownerLearningReview;
  let ownerReviewReport;
  try {
    ownerLearningReview = dependencies.buildOwnerReview(
      matrixResult.draft,
      matrixResult.manualReview,
      matrixResult.config,
      null
    );
    const ownerDecisions = dependencies.loadOwnerDecisions(
      request.ownerDecisionsPath,
      { allowMissing: true }
    );
    let ownerDecisionHistory = null;
    try {
      if (request.ownerDecisionHistoryPath) {
        ownerDecisionHistory = dependencies.loadDecisionHistory({
          filePath: request.ownerDecisionHistoryPath,
        });
      }
    } catch (historyError) {
      logger.warn(
        `[OWNER_DECISION_HISTORY_LOAD_WARNING] ${historyError.message}`
      );
    }
    ownerApplication = dependencies.applyOwnerDecisions(
      matrixResult.draft,
      ownerDecisions.store,
      {
        history: ownerDecisionHistory,
        enableLegacyResolution: true,
      }
    );
    ownerReview = dependencies.buildOwnerReview(
      ownerApplication.draft,
      matrixResult.manualReview,
      matrixResult.config,
      ownerApplication.summary,
      agentJson.workingOrderProducts
    );
    ownerReviewReport = dependencies.buildOwnerReviewReport(
      ownerApplication.draft,
      matrixResult.manualReview,
      matrixResult.config,
      ownerReview
    );
  } catch (error) {
    throw stageError(
      'OWNER_REVIEW_FAILED',
      'Не удалось сформировать Owner Review.',
      error
    );
  }

  let ownerLearning;
  let ownerLearningHistoryEntry;
  let ownerLearningReport;
  try {
    const ownerLearningInput = buildOwnerLearningInput(
      agentJsonFromResult(agentResult),
      ownerLearningReview,
      ownerApplication.draft
    );
    ownerLearning = dependencies.buildOwnerLearning({
      ...ownerLearningInput,
      generatedAt: request.generatedAt,
    });
    ownerLearningHistoryEntry = buildHistoryRunEntry({
      runId: request.runId,
      generatedAt: request.generatedAt,
      report: ownerLearning,
      learningInput: ownerLearningInput,
    });
    ownerLearningReport = dependencies.buildOwnerLearningMarkdown(
      ownerLearning
    );
  } catch (error) {
    throw stageError(
      'OWNER_LEARNING_FAILED',
      'Не удалось сформировать Owner Learning Report.',
      error
    );
  }

  let explanations;
  let explanationsReport;
  try {
    explanations = dependencies.buildExplanations(agentResult, {
      matrixDraft: ownerApplication.draft,
      configPath: request.recommendationConfigPath,
    });
    explanationsReport = dependencies.buildExplanationsReport(explanations);
  } catch (error) {
    throw stageError(
      'EXPLANATION_BUILD_FAILED',
      'Не удалось сформировать Recommendation Explanations.',
      error
    );
  }

  assertRunConsistency({
    agentResult,
    matrixDraft: ownerApplication.draft,
    manualReview: matrixResult.manualReview,
    ownerReview,
    explanations,
  });

  let ruleEffectiveness = {
    status: 'SKIPPED',
    recorded: 0,
    duplicates: 0,
    failed: 0,
    warnings: [],
  };
  try {
    ruleEffectiveness = dependencies.recordRuleEffectiveness({
      effectivenessFilePath:
        request.ownerLearningRuleEffectivenessFilePath ||
        DEFAULT_RULE_EFFECTIVENESS_PATH,
      runContext: {
        runId: request.runId,
        recordedAt: request.generatedAt,
        supplier:
          agentJsonFromResult(agentResult).supplier || null,
        applicationMode: approvedRuleProcessing.mode,
      },
      registry: approvedRulesRegistry || { rules: [] },
      applicationResult:
        approvedRuleProcessing.approvedRuleApplications,
      financialContext: {
        workingOrderProducts:
          agentJsonFromResult(agentResult).workingOrderProducts || [],
        financialStatusBefore:
          approvedRuleProcessing.approvedRuleApplications
            ?.financialStatusBefore ?? null,
        financialStatusAfter:
          approvedRuleProcessing.approvedRuleApplications
            ?.financialStatusAfter ?? null,
        financiallyPermitted:
          approvedRuleProcessing.approvedRuleApplications
            ?.appliedWorkingOrderFinancialAssessment
            ?.financiallyPermitted ?? null,
      },
      logger: dependencyOverrides.logger || console,
    });
  } catch {
    try {
      (dependencyOverrides.logger || console).warn(
        '[OWNER_RULE_EFFECTIVENESS_UNAVAILABLE] ' +
        'Аналитика эффективности недоступна; run продолжен.'
      );
    } catch {}
    ruleEffectiveness = {
      status: 'UNAVAILABLE',
      recorded: 0,
      duplicates: 0,
      failed: 1,
      warnings: ['OWNER_RULE_EFFECTIVENESS_UNAVAILABLE'],
    };
  }

  return {
    run_id: request.runId,
    generated_at: request.generatedAt,
    status: 'completed',
    agentResult,
    matrixDraft: ownerApplication.draft,
    manualReview: matrixResult.manualReview,
    ownerReview,
    ownerReviewReport,
    ownerLearning,
    ownerLearningHistoryEntry,
    ownerLearningReport,
    explanations,
    explanationsReport,
    matrixReportText: matrixResult.reportText,
    ownerDecisionSummary: ownerApplication.summary,
    approvedRuleMode: approvedRuleProcessing.mode,
    approvedRuleWarnings: approvedRuleProcessing.warnings,
    approvedRulePreview: approvedRuleProcessing.approvedRulePreview,
    approvedRulePreviewReport:
      approvedRuleProcessing.approvedRulePreviewReport,
    approvedRulePreviewError:
      approvedRuleProcessing.approvedRulePreviewError,
    approvedRuleApplications:
      approvedRuleProcessing.approvedRuleApplications,
    ruleEffectiveness,
  };
}

module.exports = {
  agentJsonFromResult,
  assertExplanationCoverage,
  assertRunConsistency,
  runPurchasingWebOrchestrator,
  sectionReferences,
  stableProductSku,
  validateRequest,
};
