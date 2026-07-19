const { DECISION_ENGINE_CONFIG, DEMAND_ENGINE_CONFIG } = require('../config');
const { normalizeClass } = require('../rules/abc_xyz_rules');

const DECISIONS = Object.freeze({
  MUST_BUY: 'must_buy',
  RECOMMENDED: 'recommended',
  MANUAL_REVIEW: 'manual_review',
  POSTPONE: 'postpone',
  DO_NOT_BUY: 'do_not_buy',
});

const CONFIDENCE_LEVELS = Object.freeze(['low', 'medium', 'high']);
const RISK_COMBINATIONS = Object.freeze({
  'A/Z': { decision: DECISIONS.MANUAL_REVIEW, scoreKey: 'riskAZ' },
  'B/Z': { decision: DECISIONS.MANUAL_REVIEW, scoreKey: 'riskBZ' },
  'C/Y': { decision: DECISIONS.POSTPONE, scoreKey: 'riskCY' },
  'C/Z': { decision: DECISIONS.MANUAL_REVIEW, scoreKey: 'riskCZ' },
});

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function confidenceFromScore(score, config = DECISION_ENGINE_CONFIG) {
  if (score >= config.confidenceThresholds.high) return 'high';
  if (score >= config.confidenceThresholds.medium) return 'medium';
  return 'low';
}

function downgradeConfidence(confidence) {
  const index = CONFIDENCE_LEVELS.indexOf(confidence);
  return CONFIDENCE_LEVELS[Math.max(0, index - 1)];
}

function capConfidence(confidence, maximum) {
  const confidenceIndex = CONFIDENCE_LEVELS.indexOf(confidence);
  const maximumIndex = CONFIDENCE_LEVELS.indexOf(maximum);
  return CONFIDENCE_LEVELS[Math.min(confidenceIndex, maximumIndex)];
}

function getDuplicateArticleRowIdentities(context = {}) {
  const diagnostics = context.duplicateIdentifiers || [];
  return new Set(
    diagnostics
      .filter(diagnostic => diagnostic.identifierType === 'article')
      .flatMap(diagnostic => diagnostic.rowIdentities || [])
  );
}

function getAmbiguousRowNumbers(context = {}) {
  return new Set(
    (context.ambiguousRowClassifications || [])
      .map(diagnostic => diagnostic.rowNumber)
  );
}

function collectRequiredData(row) {
  const requiredData = [];

  if (row.freeStock === null || row.freeStock === undefined) {
    requiredData.push('free_stock');
  }
  if (!row.supplier) requiredData.push('supplier');
  if (row.priceNum === null || row.priceNum === undefined || row.priceNum <= 0) {
    requiredData.push('purchase_price');
  }
  if (!normalizeClass(row.abc)) requiredData.push('abc_class');
  if (!normalizeClass(row.xyz)) requiredData.push('xyz_class');

  return requiredData;
}

function calculateDecisionScore(row, requiredData, context, config) {
  const weights = config.score;
  const quantity = row.orderQty;
  const abc = normalizeClass(row.abc);
  const xyz = normalizeClass(row.xyz);
  const combination = `${abc}/${xyz}`;
  let score = weights.base;

  if (quantity !== null && quantity !== undefined && quantity > 0) {
    score += weights.positiveCalculatedOrder;
  } else if (quantity !== null && quantity !== undefined && quantity <= 0) {
    score += weights.nonPositiveCalculatedOrder;
  }

  if (row.freeStock === null || row.freeStock === undefined) {
    score += weights.unknownFreeStock;
  } else {
    score += weights.knownFreeStock;
    if (row.freeStock === 0) score += weights.confirmedZeroStock;
    if (row.freeStock < 0) score += weights.negativeFreeStock;
  }

  if (quantity !== null && quantity !== undefined && quantity > 0) {
    if (combination === 'A/X') score += weights.priorityAX;
    if (combination === 'A/Y') score += weights.priorityAY;
    if (row.strategic) score += weights.strategicProduct;
    const risk = RISK_COMBINATIONS[combination];
    if (risk) score += weights[risk.scoreKey];
  }

  const missingFieldsWithoutStock = requiredData.filter(field => field !== 'free_stock');
  score += missingFieldsWithoutStock.length * weights.missingCriticalField;
  if (!row.article) score += weights.missingArticle;
  if (context.duplicateArticleRowIdentities.has(row.rowIdentity)) {
    score += weights.duplicateArticle;
  }

  return Math.max(
    config.scoreBounds.minimum,
    Math.min(config.scoreBounds.maximum, Math.round(score))
  );
}

function decideProduct(row, context, config = DECISION_ENGINE_CONFIG) {
  if (!row || typeof row !== 'object') {
    throw new TypeError('Decision engine requires analyzed product rows.');
  }
  if (typeof row.rowIdentity !== 'string' || !row.rowIdentity) {
    throw new TypeError('Decision engine requires report-local rowIdentity.');
  }

  const calculatedOrderQuantity = row.orderQty;
  const reasons = [];
  const warnings = [];
  let requiredData = [];
  let decision;
  let approvedOrderQuantity;

  if (!row.article) warnings.push('missing_article');
  if (context.duplicateArticleRowIdentities.has(row.rowIdentity)) {
    warnings.push('duplicate_article');
  }
  if (context.ambiguousRowNumbers.has(row.rowNumber)) {
    warnings.push('ambiguous_row_classification');
  }
  if (row.freeStock < 0) warnings.push('negative_free_stock');

  if (calculatedOrderQuantity === null || calculatedOrderQuantity === undefined) {
    decision = DECISIONS.MANUAL_REVIEW;
    approvedOrderQuantity = null;
    requiredData = ['calculated_order_quantity', ...collectRequiredData(row)];
    reasons.push('calculated_order_quantity_missing');
  } else if (calculatedOrderQuantity <= 0) {
    decision = DECISIONS.DO_NOT_BUY;
    approvedOrderQuantity = 0;
    reasons.push('calculated_order_quantity_not_positive');
  } else {
    requiredData = collectRequiredData(row);
    const abc = normalizeClass(row.abc);
    const xyz = normalizeClass(row.xyz);
    const combination = `${abc}/${xyz}`;

    if (row.strategic) reasons.push('strategic_product_priority');
    if (row.freeStock === 0) reasons.push('confirmed_numeric_zero_free_stock');

    if (requiredData.length > 0) {
      decision = DECISIONS.MANUAL_REVIEW;
      approvedOrderQuantity = null;
      if (requiredData.includes('free_stock')) reasons.push('free_stock_unknown');
      for (const field of requiredData.filter(field => field !== 'free_stock')) {
        reasons.push(`critical_data_missing:${field}`);
      }
    } else if (row.freeStock < 0) {
      decision = DECISIONS.MANUAL_REVIEW;
      approvedOrderQuantity = null;
      reasons.push('negative_free_stock_requires_review');
      requiredData.push('free_stock_confirmation');
    } else if (RISK_COMBINATIONS[combination]) {
      decision = RISK_COMBINATIONS[combination].decision;
      approvedOrderQuantity = null;
      reasons.push(`abc_xyz_risk:${combination}`);
    } else if (combination === 'A/X') {
      decision = DECISIONS.MUST_BUY;
      approvedOrderQuantity = calculatedOrderQuantity;
      reasons.push('abc_xyz_priority:A/X');
    } else if (combination === 'A/Y') {
      decision = DECISIONS.RECOMMENDED;
      approvedOrderQuantity = calculatedOrderQuantity;
      reasons.push('abc_xyz_priority:A/Y');
    } else {
      decision = DECISIONS.RECOMMENDED;
      approvedOrderQuantity = calculatedOrderQuantity;
      reasons.push('calculated_order_supported_by_known_stock');
    }
  }

  const score = calculateDecisionScore(row, requiredData, context, config);
  let confidence = confidenceFromScore(score, config);

  if (decision === DECISIONS.MANUAL_REVIEW || decision === DECISIONS.POSTPONE) {
    confidence = capConfidence(confidence, 'medium');
  }
  if (warnings.includes('missing_article')) {
    confidence = downgradeConfidence(confidence);
  }

  return {
    rowIdentity: row.rowIdentity,
    decision,
    confidence,
    calculatedOrderQuantity,
    approvedOrderQuantity,
    reasons,
    warnings,
    requiredData: Array.from(new Set(requiredData)),
    decisionScore: score,
    decisionVersion: config.version,
  };
}

function summarizeDecisions(decisions, productRows) {
  const rowsByIdentity = new Map(
    productRows.map(row => [row.rowIdentity, row])
  );
  const count = decision => decisions.filter(item => item.decision === decision).length;
  const confidenceCount = confidence =>
    decisions.filter(item => item.confidence === confidence).length;
  const approved = decisions.filter(item =>
    item.approvedOrderQuantity !== null && item.approvedOrderQuantity > 0
  );
  const pending = decisions.filter(item =>
    item.calculatedOrderQuantity !== null &&
    item.calculatedOrderQuantity > 0 &&
    item.approvedOrderQuantity === null
  );
  const sumRows = items => roundCurrency(items.reduce((sum, item) => {
    const row = rowsByIdentity.get(item.rowIdentity);
    return sum + (row && row.sumNum ? row.sumNum : 0);
  }, 0));

  return {
    mustBuyCount: count(DECISIONS.MUST_BUY),
    recommendedCount: count(DECISIONS.RECOMMENDED),
    manualReviewCount: count(DECISIONS.MANUAL_REVIEW),
    postponeCount: count(DECISIONS.POSTPONE),
    doNotBuyCount: count(DECISIONS.DO_NOT_BUY),
    highConfidenceCount: confidenceCount('high'),
    mediumConfidenceCount: confidenceCount('medium'),
    lowConfidenceCount: confidenceCount('low'),
    approvedOrderLines: approved.length,
    approvedOrderSum: sumRows(approved),
    pendingReviewLines: pending.length,
    pendingReviewCalculatedSum: sumRows(pending),
  };
}

function buildPurchasingDecisions(analysis, diagnostics = {}, config = DECISION_ENGINE_CONFIG) {
  if (!analysis || !Array.isArray(analysis.productRows)) {
    throw new TypeError('Decision engine requires analyzer productRows.');
  }

  const context = {
    duplicateArticleRowIdentities: getDuplicateArticleRowIdentities(diagnostics),
    ambiguousRowNumbers: getAmbiguousRowNumbers(diagnostics),
  };
  const rowIdentities = new Set();
  const decisions = analysis.productRows.map(row => {
    if (rowIdentities.has(row.rowIdentity)) {
      throw new TypeError(`Duplicate decision rowIdentity: ${row.rowIdentity}.`);
    }
    rowIdentities.add(row.rowIdentity);
    return decideProduct(row, context, config);
  });

  return {
    decisionVersion: config.version,
    decisions,
    summary: summarizeDecisions(decisions, analysis.productRows),
  };
}

function calculatePhase2DecisionScore(product, config = DEMAND_ENGINE_CONFIG) {
  const weights = config.decisionScore;
  const combination = `${product.abc}/${product.xyz}`;
  const missingSalesPeriods = product.requiredData.filter(field =>
    ['sales7', 'sales14', 'sales30'].includes(field)
  ).length;
  const missingCriticalFields = product.finalRecommendedQuantity === null
    ? product.requiredData.filter(field =>
      !['sales7', 'sales14', 'sales30'].includes(field)
    ).length
    : 0;
  let score = weights.base;

  if (product.finalRecommendedQuantity !== null) score += weights.knownFinalQuantity;
  if (product.freeStock !== null) score += weights.knownStock;
  if (product.salesDailyRate !== null) score += weights.validSales;
  if (product.salesStatus === 'complete' || product.salesStatus === 'confirmed_zero') {
    score += weights.completeSales;
  }
  if (
    product.mandatoryAssortment &&
    product.assortmentPriority === 'critical'
  ) {
    score += weights.mandatoryCritical;
  }
  if (combination === 'A/X') score += weights.priorityAX;
  if (combination === 'A/Y') score += weights.priorityAY;
  if (combination === 'B/X') score += weights.priorityBX;
  score += missingCriticalFields * weights.missingCriticalField;
  score += missingSalesPeriods * weights.missingSalesPeriod;
  if (product.warnings.includes('short_term_sales_spike')) {
    score += weights.shortTermSalesSpike;
  }
  if (product.warnings.includes('declining_sales')) score += weights.decliningSales;

  return Math.max(
    config.scoreBounds.minimum,
    Math.min(config.scoreBounds.maximum, Math.round(score))
  );
}

function decidePhase2Product(product, context, config = DEMAND_ENGINE_CONFIG) {
  if (!product || typeof product !== 'object' || !product.rowIdentity) {
    throw new TypeError('Phase 2 decision engine requires demand products.');
  }

  const warnings = [...product.warnings];
  const requiredData = [...product.requiredData];
  const reasons = [];
  const finalQuantity = product.finalRecommendedQuantity;
  const combination = `${product.abc}/${product.xyz}`;
  let decision;
  let approvedOrderQuantity;
  let decisionBasis;

  if (!product.article) warnings.push('missing_article');
  if (context.duplicateArticleRowIdentities.has(product.rowIdentity)) {
    warnings.push('duplicate_article');
  }
  if (context.ambiguousRowNumbers.has(product.rowNumber)) {
    warnings.push('ambiguous_row_classification');
  }

  const spikeNeedsReview =
    warnings.includes('short_term_sales_spike') &&
    finalQuantity !== null &&
    (
      finalQuantity >= config.trendThresholds.spikeReviewQuantity ||
      (product.priceNum > 0 &&
        finalQuantity * product.priceNum >=
          config.trendThresholds.spikeReviewOrderValue)
    );
  const mandatoryGapRequired =
    product.mandatoryAssortment === true && product.mandatoryMinimumGap > 0;
  const ambiguousReportedRate =
    product.salesRateSource === 'smartzapas_reported_daily_rate' &&
    product.salesRateConfidence === 'low';
  const provisionalNoAction =
    product.analyzerCalculatedQuantity === 0 &&
    product.salesStatus === 'missing' &&
    product.mandatoryAssortment !== true &&
    !(product.demandCalculatedQuantity > 0);

  if (provisionalNoAction) {
    decision = DECISIONS.DO_NOT_BUY;
    approvedOrderQuantity = 0;
    decisionBasis = 'provisional_phase1_no_order';
    reasons.push('phase1_no_order');
    warnings.push('phase2_data_unavailable');
  } else if (finalQuantity === null) {
    decision = DECISIONS.MANUAL_REVIEW;
    approvedOrderQuantity = null;
    decisionBasis = 'phase2_data_incomplete';
    reasons.push('final_quantity_unavailable');
  } else if (finalQuantity <= 0) {
    decision = DECISIONS.DO_NOT_BUY;
    approvedOrderQuantity = 0;
    decisionBasis = 'phase2_calculated';
    reasons.push('final_recommended_quantity_not_positive');
  } else if (ambiguousReportedRate && product.analyzerCalculatedQuantity > 0) {
    decision = DECISIONS.MANUAL_REVIEW;
    approvedOrderQuantity = null;
    decisionBasis = 'phase2_data_quality_review';
    reasons.push('reported_sales_rate_unit_requires_confirmation');
  } else if (product.salesStatus === 'confirmed_zero' && !mandatoryGapRequired) {
    decision = DECISIONS.DO_NOT_BUY;
    approvedOrderQuantity = 0;
    decisionBasis = 'phase2_calculated';
    reasons.push('confirmed_zero_sales_without_mandatory_gap');
  } else if (spikeNeedsReview) {
    decision = DECISIONS.MANUAL_REVIEW;
    approvedOrderQuantity = null;
    decisionBasis = 'phase2_risk_review';
    reasons.push('sales_spike_quantity_requires_review');
  } else if (
    product.mandatoryAssortment === true &&
    product.assortmentPriority === 'critical'
  ) {
    decision = DECISIONS.MUST_BUY;
    approvedOrderQuantity = finalQuantity;
    decisionBasis = 'phase2_calculated';
    reasons.push('mandatory_critical_assortment_gap');
  } else if (combination === 'A/Z' || combination === 'B/Z' || combination === 'C/Z') {
    decision = DECISIONS.MANUAL_REVIEW;
    approvedOrderQuantity = null;
    decisionBasis = 'phase2_risk_review';
    reasons.push(`abc_xyz_risk:${combination}`);
  } else if (combination === 'C/Y') {
    decision = DECISIONS.POSTPONE;
    approvedOrderQuantity = null;
    decisionBasis = 'phase2_risk_review';
    reasons.push('abc_xyz_risk:C/Y');
  } else if (combination === 'A/X') {
    decision = DECISIONS.MUST_BUY;
    approvedOrderQuantity = finalQuantity;
    decisionBasis = 'phase2_calculated';
    reasons.push('valid_demand_with_abc_xyz_priority:A/X');
  } else if (combination === 'A/Y') {
    decision = DECISIONS.RECOMMENDED;
    approvedOrderQuantity = finalQuantity;
    decisionBasis = 'phase2_calculated';
    reasons.push('valid_demand_with_abc_xyz_priority:A/Y');
  } else if (combination === 'B/X' && product.salesTrend === 'consistent') {
    decision = DECISIONS.RECOMMENDED;
    approvedOrderQuantity = finalQuantity;
    decisionBasis = 'phase2_calculated';
    reasons.push('consistent_sales_with_abc_xyz:B/X');
  } else {
    decision = DECISIONS.RECOMMENDED;
    approvedOrderQuantity = finalQuantity;
    decisionBasis = 'phase2_calculated';
    reasons.push('deterministic_phase2_quantity_available');
  }

  if (!provisionalNoAction && product.quantityReason) {
    reasons.push(`quantity_reason:${product.quantityReason}`);
  }
  const decisionScore = calculatePhase2DecisionScore(product, config);
  let confidence = confidenceFromScore(decisionScore, config);

  if (provisionalNoAction) confidence = 'low';
  if (ambiguousReportedRate) confidence = 'low';
  if (decision === DECISIONS.MANUAL_REVIEW || decision === DECISIONS.POSTPONE) {
    confidence = capConfidence(confidence, 'medium');
  }
  if (
    decision === DECISIONS.MUST_BUY &&
    product.mandatoryAssortment === true &&
    warnings.length > 0
  ) {
    confidence = capConfidence(confidence, 'medium');
  }
  if (warnings.includes('declining_sales')) confidence = downgradeConfidence(confidence);
  if (warnings.includes('missing_article')) confidence = downgradeConfidence(confidence);

  return {
    rowIdentity: product.rowIdentity,
    decision,
    decisionBasis,
    confidence,
    calculatedOrderQuantity: finalQuantity,
    approvedOrderQuantity,
    reasons: Array.from(new Set(reasons)),
    warnings: Array.from(new Set(warnings)),
    requiredData: Array.from(new Set(requiredData)),
    decisionScore,
    decisionVersion: config.version,
  };
}

function summarizePhase2Decisions(decisions, products) {
  const productsByIdentity = new Map(
    products.map(product => [product.rowIdentity, product])
  );
  const count = decision => decisions.filter(item => item.decision === decision).length;
  const confidenceCount = confidence =>
    decisions.filter(item => item.confidence === confidence).length;
  const approved = decisions.filter(item => item.approvedOrderQuantity > 0);
  const hasCalculatedFinalQuantity = products.some(
    product => product.finalRecommendedQuantity !== null
  );
  const finalApprovedSum = !hasCalculatedFinalQuantity
    ? null
    : approved.some(item => {
      const product = productsByIdentity.get(item.rowIdentity);
      return !(product && product.priceNum > 0);
    })
      ? null
      : roundCurrency(approved.reduce((sum, item) => {
        const product = productsByIdentity.get(item.rowIdentity);
        return sum + item.approvedOrderQuantity * product.priceNum;
      }, 0));

  return {
    mustBuyCount: count(DECISIONS.MUST_BUY),
    recommendedCount: count(DECISIONS.RECOMMENDED),
    manualReviewCount: count(DECISIONS.MANUAL_REVIEW),
    postponeCount: count(DECISIONS.POSTPONE),
    doNotBuyCount: count(DECISIONS.DO_NOT_BUY),
    highConfidenceCount: confidenceCount('high'),
    mediumConfidenceCount: confidenceCount('medium'),
    lowConfidenceCount: confidenceCount('low'),
    provisionalNoActionCount: decisions.filter(
      item => item.decisionBasis === 'provisional_phase1_no_order'
    ).length,
    positiveAnalyzerLinesAwaitingData: decisions.filter(item => {
      const product = productsByIdentity.get(item.rowIdentity);
      return (
        product &&
        product.analyzerCalculatedQuantity > 0 &&
        product.finalRecommendedQuantity === null &&
        item.decision === DECISIONS.MANUAL_REVIEW
      );
    }).length,
    finalApprovedLines: hasCalculatedFinalQuantity ? approved.length : null,
    finalApprovedSum,
  };
}

function buildPhase2PurchasingDecisions(
  demandResult,
  diagnostics = {},
  config = DEMAND_ENGINE_CONFIG
) {
  if (!demandResult || !Array.isArray(demandResult.products)) {
    throw new TypeError('Phase 2 decision engine requires demand products.');
  }
  const context = {
    duplicateArticleRowIdentities: getDuplicateArticleRowIdentities(diagnostics),
    ambiguousRowNumbers: getAmbiguousRowNumbers(diagnostics),
  };
  const decisions = demandResult.products.map(product =>
    decidePhase2Product(product, context, config)
  );

  return {
    decisionVersion: config.version,
    decisions,
    summary: summarizePhase2Decisions(decisions, demandResult.products),
  };
}

module.exports = {
  DECISIONS,
  CONFIDENCE_LEVELS,
  RISK_COMBINATIONS,
  confidenceFromScore,
  downgradeConfidence,
  collectRequiredData,
  calculateDecisionScore,
  decideProduct,
  summarizeDecisions,
  buildPurchasingDecisions,
  calculatePhase2DecisionScore,
  decidePhase2Product,
  summarizePhase2Decisions,
  buildPhase2PurchasingDecisions,
};
