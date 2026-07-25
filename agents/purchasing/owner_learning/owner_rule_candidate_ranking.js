const crypto = require('node:crypto');

const {
  REASON_CODES,
} = require('./owner_decision_history');
const {
  getConfidenceLevel,
} = require('./owner_learning_confidence');
const {
  normalizeAgentRecommendation,
} = require('./owner_learning_report');

const CANDIDATE_SCHEMA_VERSION = 'owner-rule-candidate-ranking-v0.8.2';
const SUPPORTED_DECISIONS = Object.freeze(['BUY', 'SKIP', 'DEFER']);
const CONFIDENCE_LEVELS = Object.freeze([
  'LOW',
  'MEDIUM',
  'HIGH',
  'VERY_HIGH',
]);
const ELIGIBILITY_ORDER = Object.freeze({
  ELIGIBLE: 0,
  REVIEW_ONLY: 1,
  INELIGIBLE: 2,
});
const DEFAULT_OPTIONS = Object.freeze({
  minOccurrencesForEligibility: 3,
  minDominantShareForEligibility: 0.75,
  maxContradictionShareForEligibility: 0.2,
  includeIneligible: true,
  limit: 100,
});
const COMPONENT_LIMITS = Object.freeze({
  confidenceComponent: 30,
  evidenceComponent: 15,
  recurrenceComponent: 15,
  recencyComponent: 10,
  consistencyComponent: 10,
  impactComponent: 20,
  ambiguityPenalty: 20,
  contradictionPenalty: 20,
  dataQualityPenalty: 20,
});
const PATTERN_DEFINITIONS = Object.freeze({
  SAME_ITEM_SAME_DECISION: Object.freeze({
    scopeType: 'ITEM',
    scopeField: 'stableItemKey',
    proposedRuleType: 'ITEM_DECISION_OVERRIDE',
    dominantType: 'DECISION',
    guidanceOnly: false,
  }),
  SAME_ITEM_SAME_REASON: Object.freeze({
    scopeType: 'ITEM',
    scopeField: 'stableItemKey',
    proposedRuleType: 'ITEM_REVIEW_GUIDANCE',
    dominantType: 'REASON',
    guidanceOnly: true,
  }),
  BRAND_DECISION_BIAS: Object.freeze({
    scopeType: 'BRAND',
    scopeField: 'brand',
    proposedRuleType: 'BRAND_DECISION_GUIDANCE',
    dominantType: 'DECISION',
    guidanceOnly: true,
  }),
  SUPPLIER_DECISION_BIAS: Object.freeze({
    scopeType: 'SUPPLIER',
    scopeField: 'supplier',
    proposedRuleType: 'SUPPLIER_DECISION_GUIDANCE',
    dominantType: 'DECISION',
    guidanceOnly: true,
  }),
  AGENT_DISAGREEMENT_REPEAT: Object.freeze({
    scopeType: 'ITEM',
    scopeField: 'stableItemKey',
    proposedRuleType: 'ITEM_AGENT_DISAGREEMENT_REVIEW',
    dominantType: 'DISAGREEMENT',
    guidanceOnly: true,
  }),
});
const ELIGIBILITY_REASON_ORDER = Object.freeze([
  'INVALID_SCOPE',
  'INVALID_DOMINANT_VALUE',
  'INVALID_DOMINANT_SHARE',
  'CONFIDENCE_EVALUATION_MISSING',
  'INSUFFICIENT_EVIDENCE',
  'PATTERN_REVIEW_ONLY_BY_DESIGN',
  'CONFIDENCE_BELOW_ELIGIBILITY_THRESHOLD',
  'OCCURRENCES_BELOW_ELIGIBILITY_THRESHOLD',
  'DOMINANT_SHARE_BELOW_ELIGIBILITY_THRESHOLD',
  'CONTRADICTIONS_ABOVE_ELIGIBILITY_THRESHOLD',
  'DATA_QUALITY_PRESENT',
  'UNSUPPORTED_CRITICAL_FIELDS',
  'ELIGIBLE_STRICT_CRITERIA_MET',
]);
const EXPLANATION_ORDER = Object.freeze([
  'HIGH_CONFIDENCE_PATTERN',
  'MODERATE_CONFIDENCE_PATTERN',
  'LOW_CONFIDENCE_PATTERN',
  'STRONG_EVIDENCE_VOLUME',
  'LIMITED_EVIDENCE_VOLUME',
  'RECENT_PATTERN',
  'STALE_PATTERN',
  'CONSISTENT_PATTERN',
  'CONTRADICTIONS_REDUCE_PRIORITY',
  'DATA_QUALITY_REDUCES_PRIORITY',
  'ITEM_SPECIFIC_CANDIDATE',
  'BROAD_SCOPE_REVIEW_REQUIRED',
  'GUIDANCE_ONLY_CANDIDATE',
  'ELIGIBLE_FOR_OWNER_REVIEW',
  'REVIEW_ONLY_CANDIDATE',
  'INELIGIBLE_CANDIDATE',
  'CONFIDENCE_EVALUATION_MISSING',
  'IMPACT_ESTIMATE_UNAVAILABLE',
  'NO_FINANCIAL_ESTIMATE',
  'PRIORITY_DESCRIBES_MANUAL_REVIEW_ORDER',
]);

class OwnerRuleCandidateRankingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OwnerRuleCandidateRankingError';
    this.code = 'OWNER_RULE_CANDIDATE_RANKING_INVALID_INPUT';
  }
}

function invalidInput(message) {
  throw new OwnerRuleCandidateRankingError(message);
}

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function pathLike(value) {
  return value.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith('file://');
}

function safeText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && !pathLike(normalized) ? normalized : null;
}

function normalizedEnum(value, allowed) {
  const normalized = safeText(value)?.toUpperCase() || null;
  return normalized && allowed.includes(normalized)
    ? normalized
    : null;
}

function finiteRange(value, minimum, maximum) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isoDateOrNull(value) {
  if (value === null) return true;
  const normalized = safeText(value);
  return Boolean(
    normalized &&
    Number.isFinite(Date.parse(normalized))
  );
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function compareText(left, right) {
  if (left === right) return 0;
  return String(left || '').localeCompare(String(right || ''), 'en');
}

function validateOptions(options) {
  if (options === undefined) options = {};
  if (!isPlainObject(options)) {
    invalidInput('options должен быть объектом.');
  }
  const values = {
    minOccurrencesForEligibility:
      options.minOccurrencesForEligibility ??
      DEFAULT_OPTIONS.minOccurrencesForEligibility,
    minDominantShareForEligibility:
      options.minDominantShareForEligibility ??
      DEFAULT_OPTIONS.minDominantShareForEligibility,
    maxContradictionShareForEligibility:
      options.maxContradictionShareForEligibility ??
      DEFAULT_OPTIONS.maxContradictionShareForEligibility,
    includeIneligible:
      options.includeIneligible ?? DEFAULT_OPTIONS.includeIneligible,
    limit: options.limit ?? DEFAULT_OPTIONS.limit,
  };
  if (
    !Number.isInteger(values.minOccurrencesForEligibility) ||
    values.minOccurrencesForEligibility < 1
  ) {
    invalidInput(
      'minOccurrencesForEligibility должен быть положительным целым числом.'
    );
  }
  if (!finiteRange(values.minDominantShareForEligibility, 0, 1)) {
    invalidInput(
      'minDominantShareForEligibility должен быть числом от 0 до 1.'
    );
  }
  if (!finiteRange(values.maxContradictionShareForEligibility, 0, 1)) {
    invalidInput(
      'maxContradictionShareForEligibility должен быть числом от 0 до 1.'
    );
  }
  if (typeof values.includeIneligible !== 'boolean') {
    invalidInput('includeIneligible должен быть boolean.');
  }
  if (
    !Number.isInteger(values.limit) ||
    values.limit < 1 ||
    values.limit > 100
  ) {
    invalidInput('limit должен быть целым числом от 1 до 100.');
  }
  return values;
}

function validateAnalytics(analytics) {
  if (
    !isPlainObject(analytics) ||
    !Array.isArray(analytics.repeatedDecisionPatterns)
  ) {
    invalidInput(
      'analytics должен содержать массив repeatedDecisionPatterns.'
    );
  }
  return analytics.repeatedDecisionPatterns;
}

function validateHistory(history) {
  if (!Array.isArray(history)) {
    invalidInput('history должен быть массивом.');
  }
  return history;
}

function expectedConfidenceLevel(score) {
  try {
    return getConfidenceLevel(score);
  } catch {
    invalidInput('confidence score должен быть целым числом от 0 до 100.');
  }
}

function validateConfidenceEvaluation(evaluation) {
  if (!isPlainObject(evaluation)) {
    invalidInput('confidenceEvaluations содержит не объект.');
  }
  const patternType = safeText(evaluation.patternType);
  const definition = PATTERN_DEFINITIONS[patternType];
  if (!definition) {
    invalidInput(
      'confidence evaluation содержит неизвестный patternType.'
    );
  }
  const scopeType = safeText(evaluation.scopeType);
  const scopeKey = safeText(evaluation.scopeKey);
  if (
    scopeType !== definition.scopeType ||
    !scopeKey
  ) {
    invalidInput(
      'confidence evaluation содержит повреждённый scope.'
    );
  }
  const score = evaluation.confidenceScore;
  const level = normalizedEnum(
    evaluation.confidenceLevel,
    CONFIDENCE_LEVELS
  );
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    invalidInput('confidence evaluation содержит неверный score.');
  }
  if (!level || level !== expectedConfidenceLevel(score)) {
    invalidInput('confidence evaluation содержит неверный level.');
  }
  const evidence = evaluation.evidence;
  const components = evaluation.components;
  const contradictions = evaluation.contradictions;
  const dataQuality = evaluation.dataQuality;
  if (
    !isPlainObject(evidence) ||
    !nonNegativeInteger(evidence.occurrences) ||
    !nonNegativeInteger(evidence.totalRelevantEntries) ||
    !nonNegativeInteger(evidence.supportingDecisionIdsCount) ||
    !finiteRange(evidence.dominantShare, 0, 1) ||
    !(
      evidence.firstRecordedAt === null ||
      safeText(evidence.firstRecordedAt)
    ) ||
    !(
      evidence.lastRecordedAt === null ||
      safeText(evidence.lastRecordedAt)
    ) ||
    !(
      evidence.historySpanDays === null ||
      nonNegativeInteger(evidence.historySpanDays)
    )
  ) {
    invalidInput('confidence evaluation содержит неверный evidence.');
  }
  if (
    !isPlainObject(components) ||
    !finiteRange(components.recencyScore, 0, 15) ||
    !finiteRange(components.consistencyScore, 0, 20) ||
    !finiteRange(components.contradictionPenalty, 0, 30) ||
    !finiteRange(components.dataQualityPenalty, 0, 30)
  ) {
    invalidInput('confidence evaluation содержит неверные components.');
  }
  if (
    !isPlainObject(contradictions) ||
    !nonNegativeInteger(contradictions.count) ||
    !finiteRange(contradictions.share, 0, 1)
  ) {
    invalidInput('confidence evaluation содержит неверные contradictions.');
  }
  if (
    !isPlainObject(dataQuality) ||
    !nonNegativeInteger(dataQuality.missingDates) ||
    !nonNegativeInteger(dataQuality.unsupportedValues) ||
    !nonNegativeInteger(dataQuality.duplicateDecisionIds) ||
    typeof dataQuality.insufficientEvidence !== 'boolean'
  ) {
    invalidInput('confidence evaluation содержит неверный dataQuality.');
  }
  return {
    source: evaluation,
    patternType,
    scopeType,
    scopeKey,
    score,
    level,
    evidence,
    components,
    contradictions,
    dataQuality,
  };
}

function patternKey(patternType, scopeType, scopeKey) {
  return JSON.stringify([patternType, scopeType, scopeKey]);
}

function confidenceIndex(confidenceEvaluations) {
  if (!Array.isArray(confidenceEvaluations)) {
    invalidInput('confidenceEvaluations должен быть массивом.');
  }
  const index = new Map();
  for (const rawEvaluation of confidenceEvaluations) {
    const evaluation = validateConfidenceEvaluation(rawEvaluation);
    const key = patternKey(
      evaluation.patternType,
      evaluation.scopeType,
      evaluation.scopeKey
    );
    if (index.has(key)) {
      invalidInput(
        'confidenceEvaluations содержит повторную оценку pattern scope.'
      );
    }
    index.set(key, evaluation);
  }
  return index;
}

function validDisagreement(value) {
  const normalized = safeText(value)?.toUpperCase() || null;
  if (!normalized) return null;
  const match = normalized.match(/^(BUY|SKIP|DEFER)->(BUY|SKIP|DEFER)$/);
  return match && match[1] !== match[2] ? normalized : null;
}

function normalizePattern(rawPattern) {
  if (!isPlainObject(rawPattern)) {
    invalidInput('repeatedDecisionPatterns содержит не объект.');
  }
  const patternType = safeText(rawPattern.patternType);
  const definition = PATTERN_DEFINITIONS[patternType];
  if (!definition) {
    invalidInput('patternType не поддерживается.');
  }
  if (!nonNegativeInteger(rawPattern.occurrences)) {
    invalidInput('pattern.occurrences должен быть неотрицательным целым.');
  }
  const scopeKey = safeText(rawPattern.scopeKey);
  const scopeValid =
    rawPattern.scopeType === definition.scopeType &&
    scopeKey !== null;
  const shareValid = finiteRange(rawPattern.share, 0, 1);
  let dominantValue = null;
  if (definition.dominantType === 'DECISION') {
    dominantValue = normalizedEnum(
      rawPattern.dominantValue,
      SUPPORTED_DECISIONS
    );
  } else if (definition.dominantType === 'REASON') {
    dominantValue = normalizedEnum(rawPattern.dominantValue, REASON_CODES);
  } else {
    dominantValue = validDisagreement(rawPattern.dominantValue);
  }
  return {
    source: rawPattern,
    definition,
    patternType,
    scopeType: definition.scopeType,
    scopeKey,
    scopeValid,
    share: shareValid ? rawPattern.share : null,
    shareValid,
    occurrences: rawPattern.occurrences,
    dominantValue,
    dominantValid: dominantValue !== null,
  };
}

function proposedAction(pattern) {
  const decision =
    pattern.definition.dominantType === 'DECISION'
      ? pattern.dominantValue
      : null;
  let quantityStrategy = 'NO_QUANTITY_CHANGE';
  if (
    !pattern.definition.guidanceOnly &&
    decision === 'BUY'
  ) {
    quantityStrategy = 'KEEP_AGENT_QUANTITY';
  }
  return {
    decision,
    quantityStrategy,
    quantityValue: null,
  };
}

function buildCandidateId({
  patternType,
  scopeType,
  scopeKey,
  proposedRuleType,
  proposedAction: action,
}) {
  const identity = JSON.stringify([
    CANDIDATE_SCHEMA_VERSION,
    patternType,
    scopeType,
    scopeKey,
    proposedRuleType,
    action.decision,
    action.quantityStrategy,
    action.quantityValue,
  ]);
  return crypto
    .createHash('sha256')
    .update(identity, 'utf8')
    .digest('hex');
}

function relevantHistory(history, pattern) {
  if (!pattern.scopeValid) return [];
  return history.filter(entry =>
    isPlainObject(entry) &&
    safeText(entry[pattern.definition.scopeField]) === pattern.scopeKey
  );
}

function uniqueHistoryEntries(entries) {
  const seen = new Set();
  return entries.filter((entry, index) => {
    const decisionId = safeText(entry.decisionId);
    const key = decisionId ? `id:${decisionId}` : `index:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function historicalQuantityDelta(entries) {
  let found = false;
  let total = 0;
  for (const entry of uniqueHistoryEntries(entries)) {
    const agentDecision = normalizeAgentRecommendation(
      safeText(entry.agentRecommendation)
    );
    const ownerDecision = normalizedEnum(
      entry.ownerDecision,
      SUPPORTED_DECISIONS
    );
    const agentQuantity = entry.agentQuantity;
    const ownerQuantity = entry.ownerQuantity;
    if (
      agentDecision !== 'BUY' ||
      ownerDecision !== 'BUY' ||
      !Number.isFinite(agentQuantity) ||
      agentQuantity < 0 ||
      !Number.isFinite(ownerQuantity) ||
      ownerQuantity < 0
    ) continue;
    found = true;
    total += ownerQuantity - agentQuantity;
  }
  return found ? Math.round(total * 10000) / 10000 : null;
}

function impact(pattern, history) {
  const relevant = relevantHistory(history, pattern);
  let estimatedAffectedItems = null;
  if (pattern.scopeValid && pattern.scopeType === 'ITEM') {
    estimatedAffectedItems = 1;
  } else if (pattern.scopeValid) {
    estimatedAffectedItems = new Set(
      relevant
        .map(entry => safeText(entry.stableItemKey))
        .filter(Boolean)
    ).size;
  }
  return {
    affectedScopeType: pattern.scopeType,
    estimatedAffectedItems,
    estimatedHistoricalQuantityDelta:
      historicalQuantityDelta(relevant),
    hasFinancialEstimate: false,
  };
}

function evidenceScore(count) {
  if (count <= 1) return 0;
  if (count === 2) return 4;
  if (count === 3) return 7;
  if (count === 4) return 10;
  if (count <= 6) return 13;
  return 15;
}

function recurrenceScore(occurrences) {
  if (occurrences <= 1) return 0;
  if (occurrences === 2) return 3;
  if (occurrences === 3) return 6;
  if (occurrences === 4) return 9;
  if (occurrences <= 6) return 12;
  return 15;
}

function impactScore(value) {
  const count = value.estimatedAffectedItems;
  if (!Number.isInteger(count) || count <= 0) return 0;
  if (value.affectedScopeType === 'ITEM') return 4;
  if (count <= 2) return 4;
  if (count <= 5) return 8;
  if (count <= 10) return 12;
  if (count <= 20) return 16;
  return 20;
}

function ambiguityPenalty(pattern, action, confidence) {
  let score = 0;
  if (!action.decision) score += 8;
  if (pattern.definition.guidanceOnly) score += 4;
  if (pattern.share === null || pattern.share < 0.75) score += 4;
  if (confidence?.level === 'LOW') score += 4;
  return clamp(score, 0, COMPONENT_LIMITS.ambiguityPenalty);
}

function rankingComponents(pattern, action, confidence, impactValue) {
  if (!confidence) {
    return {
      confidenceComponent: 0,
      evidenceComponent: 0,
      recurrenceComponent: 0,
      recencyComponent: 0,
      consistencyComponent: 0,
      impactComponent: 0,
      ambiguityPenalty: 0,
      contradictionPenalty: 0,
      dataQualityPenalty: 0,
    };
  }
  return {
    confidenceComponent: Math.round(confidence.score * 0.3),
    evidenceComponent: evidenceScore(
      confidence.evidence.supportingDecisionIdsCount
    ),
    recurrenceComponent: recurrenceScore(pattern.occurrences),
    recencyComponent: Math.round(
      confidence.components.recencyScore / 15 * 10
    ),
    consistencyComponent: Math.round(
      confidence.components.consistencyScore / 20 * 10
    ),
    impactComponent: impactScore(impactValue),
    ambiguityPenalty: ambiguityPenalty(pattern, action, confidence),
    contradictionPenalty: Math.round(
      confidence.components.contradictionPenalty / 30 * 20
    ),
    dataQualityPenalty: Math.round(
      confidence.components.dataQualityPenalty / 30 * 20
    ),
  };
}

function priorityScore(components, confidenceMissing) {
  if (confidenceMissing) return 0;
  const raw =
    components.confidenceComponent +
    components.evidenceComponent +
    components.recurrenceComponent +
    components.recencyComponent +
    components.consistencyComponent +
    components.impactComponent -
    components.ambiguityPenalty -
    components.contradictionPenalty -
    components.dataQualityPenalty;
  return clamp(Math.round(raw), 0, 100);
}

function getCandidatePriorityLevel(score) {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    invalidInput('priority score должен быть целым числом от 0 до 100.');
  }
  if (score <= 24) return 'LOW';
  if (score <= 49) return 'MEDIUM';
  if (score <= 74) return 'HIGH';
  return 'CRITICAL';
}

function eligibility(pattern, action, confidence, options) {
  const reasons = new Set();
  if (!pattern.scopeValid) reasons.add('INVALID_SCOPE');
  if (!pattern.dominantValid) reasons.add('INVALID_DOMINANT_VALUE');
  if (!pattern.shareValid) reasons.add('INVALID_DOMINANT_SHARE');
  if (!confidence) reasons.add('CONFIDENCE_EVALUATION_MISSING');
  if (
    confidence?.level === 'LOW' &&
    confidence.dataQuality.insufficientEvidence
  ) {
    reasons.add('INSUFFICIENT_EVIDENCE');
  }
  const structurallyIneligible =
    !pattern.scopeValid ||
    !pattern.dominantValid ||
    !pattern.shareValid ||
    !confidence ||
    (
      confidence.level === 'LOW' &&
      confidence.dataQuality.insufficientEvidence
    ) ||
    (
      pattern.definition.dominantType === 'DECISION' &&
      !action.decision
    );
  if (structurallyIneligible) {
    return {
      status: 'INELIGIBLE',
      reasons: ELIGIBILITY_REASON_ORDER.filter(reason =>
        reasons.has(reason)
      ),
    };
  }
  if (pattern.definition.guidanceOnly) {
    reasons.add('PATTERN_REVIEW_ONLY_BY_DESIGN');
    return {
      status: 'REVIEW_ONLY',
      reasons: ELIGIBILITY_REASON_ORDER.filter(reason =>
        reasons.has(reason)
      ),
    };
  }
  if (!['HIGH', 'VERY_HIGH'].includes(confidence.level)) {
    reasons.add('CONFIDENCE_BELOW_ELIGIBILITY_THRESHOLD');
  }
  if (pattern.occurrences < options.minOccurrencesForEligibility) {
    reasons.add('OCCURRENCES_BELOW_ELIGIBILITY_THRESHOLD');
  }
  if (
    confidence.evidence.dominantShare <
    options.minDominantShareForEligibility
  ) {
    reasons.add('DOMINANT_SHARE_BELOW_ELIGIBILITY_THRESHOLD');
  }
  if (
    confidence.contradictions.share >
    options.maxContradictionShareForEligibility
  ) {
    reasons.add('CONTRADICTIONS_ABOVE_ELIGIBILITY_THRESHOLD');
  }
  if (confidence.components.dataQualityPenalty > 0) {
    reasons.add('DATA_QUALITY_PRESENT');
  }
  if (
    confidence.dataQuality.unsupportedValues > 0 ||
    confidence.dataQuality.missingDates > 0
  ) {
    reasons.add('UNSUPPORTED_CRITICAL_FIELDS');
  }
  if (reasons.size === 0) {
    reasons.add('ELIGIBLE_STRICT_CRITERIA_MET');
    return {
      status: 'ELIGIBLE',
      reasons: ELIGIBILITY_REASON_ORDER.filter(reason =>
        reasons.has(reason)
      ),
    };
  }
  return {
    status: 'REVIEW_ONLY',
    reasons: ELIGIBILITY_REASON_ORDER.filter(reason =>
      reasons.has(reason)
    ),
  };
}

function evidenceOutput(pattern, confidence) {
  if (!confidence) {
    return {
      occurrences: pattern.occurrences,
      totalRelevantEntries: 0,
      dominantShare: pattern.share,
      firstRecordedAt: null,
      lastRecordedAt: null,
      historySpanDays: null,
      supportingDecisionIdsCount: 0,
    };
  }
  return {
    occurrences: confidence.evidence.occurrences,
    totalRelevantEntries: confidence.evidence.totalRelevantEntries,
    dominantShare: confidence.evidence.dominantShare,
    firstRecordedAt: confidence.evidence.firstRecordedAt,
    lastRecordedAt: confidence.evidence.lastRecordedAt,
    historySpanDays: confidence.evidence.historySpanDays,
    supportingDecisionIdsCount:
      confidence.evidence.supportingDecisionIdsCount,
  };
}

function explanationCodes({
  pattern,
  confidence,
  components,
  impactValue,
  eligibilityValue,
}) {
  const codes = new Set();
  if (confidence) {
    if (['HIGH', 'VERY_HIGH'].includes(confidence.level)) {
      codes.add('HIGH_CONFIDENCE_PATTERN');
    } else if (confidence.level === 'MEDIUM') {
      codes.add('MODERATE_CONFIDENCE_PATTERN');
    } else {
      codes.add('LOW_CONFIDENCE_PATTERN');
    }
    codes.add(
      confidence.evidence.supportingDecisionIdsCount >= 5
        ? 'STRONG_EVIDENCE_VOLUME'
        : 'LIMITED_EVIDENCE_VOLUME'
    );
    if (confidence.components.recencyScore >= 12) {
      codes.add('RECENT_PATTERN');
    } else if (confidence.components.recencyScore <= 2) {
      codes.add('STALE_PATTERN');
    }
    if (confidence.components.consistencyScore >= 15) {
      codes.add('CONSISTENT_PATTERN');
    }
    if (components.contradictionPenalty > 0) {
      codes.add('CONTRADICTIONS_REDUCE_PRIORITY');
    }
    if (components.dataQualityPenalty > 0) {
      codes.add('DATA_QUALITY_REDUCES_PRIORITY');
    }
  } else {
    codes.add('CONFIDENCE_EVALUATION_MISSING');
    codes.add('LIMITED_EVIDENCE_VOLUME');
  }
  if (pattern.scopeType === 'ITEM') {
    codes.add('ITEM_SPECIFIC_CANDIDATE');
  } else {
    codes.add('BROAD_SCOPE_REVIEW_REQUIRED');
  }
  if (pattern.definition.guidanceOnly) {
    codes.add('GUIDANCE_ONLY_CANDIDATE');
  }
  if (eligibilityValue.status === 'ELIGIBLE') {
    codes.add('ELIGIBLE_FOR_OWNER_REVIEW');
  } else if (eligibilityValue.status === 'REVIEW_ONLY') {
    codes.add('REVIEW_ONLY_CANDIDATE');
  } else {
    codes.add('INELIGIBLE_CANDIDATE');
  }
  if (
    !Number.isInteger(impactValue.estimatedAffectedItems) ||
    impactValue.estimatedAffectedItems <= 0
  ) {
    codes.add('IMPACT_ESTIMATE_UNAVAILABLE');
  }
  codes.add('NO_FINANCIAL_ESTIMATE');
  codes.add('PRIORITY_DESCRIBES_MANUAL_REVIEW_ORDER');
  return EXPLANATION_ORDER.filter(code => codes.has(code));
}

function buildCandidate(pattern, confidence, history, options) {
  const action = proposedAction(pattern);
  const impactValue = impact(pattern, history);
  const components = rankingComponents(
    pattern,
    action,
    confidence,
    impactValue
  );
  const score = priorityScore(components, !confidence);
  const eligibilityValue = eligibility(
    pattern,
    action,
    confidence,
    options
  );
  const identity = {
    patternType: pattern.patternType,
    scopeType: pattern.scopeType,
    scopeKey: pattern.scopeKey,
    proposedRuleType: pattern.definition.proposedRuleType,
    proposedAction: action,
  };
  return {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    candidateId: buildCandidateId(identity),
    ...identity,
    confidence: {
      score: confidence?.score ?? null,
      level: confidence?.level ?? null,
    },
    ranking: {
      priorityScore: score,
      priorityLevel: getCandidatePriorityLevel(score),
      rank: null,
      components,
    },
    evidence: evidenceOutput(pattern, confidence),
    impact: impactValue,
    eligibility: eligibilityValue,
    explanationCodes: explanationCodes({
      pattern,
      confidence,
      components,
      impactValue,
      eligibilityValue,
    }),
  };
}

function assertUniqueCandidateIds(candidates) {
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.candidateId)) {
      invalidInput('Обнаружен повторный candidateId.');
    }
    seen.add(candidate.candidateId);
  }
}

function buildRuleCandidates(input = {}) {
  if (!isPlainObject(input)) {
    invalidInput('buildRuleCandidates ожидает объект.');
  }
  const {
    analytics,
    confidenceEvaluations,
    history,
    options,
  } = input;
  const patterns = validateAnalytics(analytics);
  const entries = validateHistory(history);
  const validatedOptions = validateOptions(options);
  const evaluations = confidenceIndex(confidenceEvaluations);
  const normalizedPatterns = patterns.map(normalizePattern);
  const analyticsPatternKeys = new Set(normalizedPatterns
    .filter(pattern => pattern.scopeKey !== null)
    .map(pattern => patternKey(
      pattern.patternType,
      pattern.scopeType,
      pattern.scopeKey
    )));
  for (const key of evaluations.keys()) {
    if (!analyticsPatternKeys.has(key)) {
      invalidInput(
        'confidence evaluation не соответствует analytics pattern.'
      );
    }
  }
  const candidates = normalizedPatterns.map(pattern => {
    const evaluation = evaluations.get(patternKey(
      pattern.patternType,
      pattern.scopeType,
      pattern.scopeKey
    )) || null;
    return buildCandidate(
      pattern,
      evaluation,
      entries,
      validatedOptions
    );
  });
  assertUniqueCandidateIds(candidates);
  return validatedOptions.includeIneligible
    ? candidates
    : candidates.filter(candidate =>
      candidate.eligibility.status !== 'INELIGIBLE'
    );
}

function validateCandidate(candidate) {
  const definition = PATTERN_DEFINITIONS[candidate?.patternType];
  if (
    !isPlainObject(candidate) ||
    candidate.schemaVersion !== CANDIDATE_SCHEMA_VERSION ||
    !/^[a-f0-9]{64}$/.test(candidate.candidateId || '') ||
    !definition ||
    candidate.scopeType !== definition.scopeType ||
    !(
      candidate.scopeKey === null ||
      safeText(candidate.scopeKey) === candidate.scopeKey
    ) ||
    candidate.proposedRuleType !== definition.proposedRuleType ||
    !isPlainObject(candidate.proposedAction) ||
    !isPlainObject(candidate.confidence) ||
    !isPlainObject(candidate.ranking) ||
    !isPlainObject(candidate.ranking.components) ||
    !isPlainObject(candidate.evidence) ||
    !isPlainObject(candidate.impact) ||
    !isPlainObject(candidate.eligibility) ||
    !Array.isArray(candidate.eligibility.reasons) ||
    !Array.isArray(candidate.explanationCodes)
  ) {
    invalidInput('candidates содержит некорректного кандидата.');
  }
  if (
    !(
      candidate.proposedAction.decision === null ||
      SUPPORTED_DECISIONS.includes(candidate.proposedAction.decision)
    ) ||
    !['KEEP_AGENT_QUANTITY', 'NO_QUANTITY_CHANGE'].includes(
      candidate.proposedAction.quantityStrategy
    ) ||
    candidate.proposedAction.quantityValue !== null ||
    candidate.candidateId !== buildCandidateId(candidate)
  ) {
    invalidInput('candidate action или candidateId некорректен.');
  }
  if (
    !Object.hasOwn(ELIGIBILITY_ORDER, candidate.eligibility.status) ||
    !Number.isInteger(candidate.ranking.priorityScore) ||
    candidate.ranking.priorityScore < 0 ||
    candidate.ranking.priorityScore > 100 ||
    candidate.ranking.priorityLevel !== getCandidatePriorityLevel(
      candidate.ranking.priorityScore
    ) ||
    !nonNegativeInteger(candidate.evidence.occurrences)
  ) {
    invalidInput('candidate ranking или eligibility некорректны.');
  }
  if (
    !nonNegativeInteger(candidate.evidence.totalRelevantEntries) ||
    !nonNegativeInteger(
      candidate.evidence.supportingDecisionIdsCount
    ) ||
    !(
      candidate.evidence.dominantShare === null ||
      finiteRange(candidate.evidence.dominantShare, 0, 1)
    ) ||
    !isoDateOrNull(candidate.evidence.firstRecordedAt) ||
    !isoDateOrNull(candidate.evidence.lastRecordedAt) ||
    !(
      candidate.evidence.historySpanDays === null ||
      nonNegativeInteger(candidate.evidence.historySpanDays)
    ) ||
    candidate.impact.affectedScopeType !== candidate.scopeType ||
    !(
      candidate.impact.estimatedAffectedItems === null ||
      nonNegativeInteger(candidate.impact.estimatedAffectedItems)
    ) ||
    !(
      candidate.impact.estimatedHistoricalQuantityDelta === null ||
      Number.isFinite(
        candidate.impact.estimatedHistoricalQuantityDelta
      )
    ) ||
    candidate.impact.hasFinancialEstimate !== false
  ) {
    invalidInput('candidate evidence или impact некорректны.');
  }
  if (
    new Set(candidate.eligibility.reasons).size !==
      candidate.eligibility.reasons.length ||
    candidate.eligibility.reasons.some(reason =>
      !ELIGIBILITY_REASON_ORDER.includes(reason)
    ) ||
    new Set(candidate.explanationCodes).size !==
      candidate.explanationCodes.length ||
    candidate.explanationCodes.some(code =>
      !EXPLANATION_ORDER.includes(code)
    )
  ) {
    invalidInput('candidate содержит неизвестные explanation codes.');
  }
  if (
    candidate.confidence.score === null ||
    candidate.confidence.level === null
  ) {
    if (
      candidate.confidence.score !== null ||
      candidate.confidence.level !== null ||
      candidate.eligibility.status !== 'INELIGIBLE' ||
      candidate.ranking.priorityScore !== 0
    ) {
      invalidInput('candidate содержит неполный confidence.');
    }
  } else if (
    !Number.isInteger(candidate.confidence.score) ||
    candidate.confidence.score < 0 ||
    candidate.confidence.score > 100 ||
    candidate.confidence.level !== expectedConfidenceLevel(
      candidate.confidence.score
    )
  ) {
    invalidInput('candidate confidence некорректен.');
  }
  const limits = COMPONENT_LIMITS;
  for (const [name, maximum] of Object.entries(limits)) {
    const value = candidate.ranking.components[name];
    if (!Number.isInteger(value) || value < 0 || value > maximum) {
      invalidInput(`candidate component ${name} некорректен.`);
    }
  }
  return candidate;
}

function cloneCandidate(candidate) {
  const components = candidate.ranking.components;
  return {
    schemaVersion: candidate.schemaVersion,
    candidateId: candidate.candidateId,
    patternType: candidate.patternType,
    scopeType: candidate.scopeType,
    scopeKey: candidate.scopeKey,
    proposedRuleType: candidate.proposedRuleType,
    proposedAction: {
      decision: candidate.proposedAction.decision,
      quantityStrategy: candidate.proposedAction.quantityStrategy,
      quantityValue: candidate.proposedAction.quantityValue,
    },
    confidence: {
      score: candidate.confidence.score,
      level: candidate.confidence.level,
    },
    ranking: {
      priorityScore: candidate.ranking.priorityScore,
      priorityLevel: candidate.ranking.priorityLevel,
      rank: candidate.ranking.rank,
      components: {
        confidenceComponent: components.confidenceComponent,
        evidenceComponent: components.evidenceComponent,
        recurrenceComponent: components.recurrenceComponent,
        recencyComponent: components.recencyComponent,
        consistencyComponent: components.consistencyComponent,
        impactComponent: components.impactComponent,
        ambiguityPenalty: components.ambiguityPenalty,
        contradictionPenalty: components.contradictionPenalty,
        dataQualityPenalty: components.dataQualityPenalty,
      },
    },
    evidence: {
      occurrences: candidate.evidence.occurrences,
      totalRelevantEntries: candidate.evidence.totalRelevantEntries,
      dominantShare: candidate.evidence.dominantShare,
      firstRecordedAt: candidate.evidence.firstRecordedAt,
      lastRecordedAt: candidate.evidence.lastRecordedAt,
      historySpanDays: candidate.evidence.historySpanDays,
      supportingDecisionIdsCount:
        candidate.evidence.supportingDecisionIdsCount,
    },
    impact: {
      affectedScopeType: candidate.impact.affectedScopeType,
      estimatedAffectedItems: candidate.impact.estimatedAffectedItems,
      estimatedHistoricalQuantityDelta:
        candidate.impact.estimatedHistoricalQuantityDelta,
      hasFinancialEstimate: candidate.impact.hasFinancialEstimate,
    },
    eligibility: {
      status: candidate.eligibility.status,
      reasons: [...candidate.eligibility.reasons],
    },
    explanationCodes: [...candidate.explanationCodes],
  };
}

function rankRuleCandidates(input = {}) {
  if (!isPlainObject(input)) {
    invalidInput('rankRuleCandidates ожидает объект.');
  }
  const { candidates, options } = input;
  if (!Array.isArray(candidates)) {
    invalidInput('candidates должен быть массивом.');
  }
  const validatedOptions = validateOptions(options);
  const validatedCandidates = candidates.map(validateCandidate);
  assertUniqueCandidateIds(validatedCandidates);
  const filtered = validatedOptions.includeIneligible
    ? validatedCandidates
    : validatedCandidates.filter(candidate =>
      candidate.eligibility.status !== 'INELIGIBLE'
    );
  return [...filtered]
    .sort((left, right) =>
      ELIGIBILITY_ORDER[left.eligibility.status] -
        ELIGIBILITY_ORDER[right.eligibility.status] ||
      right.ranking.priorityScore - left.ranking.priorityScore ||
      (right.confidence.score ?? -1) -
        (left.confidence.score ?? -1) ||
      right.evidence.occurrences - left.evidence.occurrences ||
      compareText(left.patternType, right.patternType) ||
      compareText(left.scopeType, right.scopeType) ||
      compareText(left.scopeKey, right.scopeKey) ||
      compareText(left.candidateId, right.candidateId)
    )
    .slice(0, validatedOptions.limit)
    .map((candidate, index) => {
      const clone = cloneCandidate(candidate);
      clone.ranking.rank = index + 1;
      return clone;
    });
}

function buildAndRankRuleCandidates(input = {}) {
  const candidates = buildRuleCandidates(input);
  return rankRuleCandidates({
    candidates,
    options: input.options,
  });
}

module.exports = {
  CANDIDATE_SCHEMA_VERSION,
  COMPONENT_LIMITS,
  DEFAULT_OPTIONS,
  PATTERN_DEFINITIONS,
  OwnerRuleCandidateRankingError,
  buildAndRankRuleCandidates,
  buildRuleCandidates,
  getCandidatePriorityLevel,
  rankRuleCandidates,
};
