const {
  CANDIDATE_SCHEMA_VERSION,
  PATTERN_DEFINITIONS,
} = require('./owner_rule_candidate_ranking');

const SUPPORTED_DECISIONS = Object.freeze(['BUY', 'SKIP', 'DEFER']);
const CONFIDENCE_LEVELS = Object.freeze([
  'LOW',
  'MEDIUM',
  'HIGH',
  'VERY_HIGH',
]);
const PRIORITY_LEVELS = Object.freeze([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);
const ELIGIBILITY_STATUSES = Object.freeze([
  'ELIGIBLE',
  'REVIEW_ONLY',
  'INELIGIBLE',
]);
const RECOMMENDED_OWNER_ACTIONS = Object.freeze([
  'REVIEW_AND_APPROVE',
  'REVIEW_ONLY',
  'COLLECT_MORE_HISTORY',
  'DO_NOT_CREATE_RULE',
]);
const GUIDANCE_PATTERN_TYPES = Object.freeze([
  'SAME_ITEM_SAME_REASON',
  'BRAND_DECISION_BIAS',
  'SUPPLIER_DECISION_BIAS',
  'AGENT_DISAGREEMENT_REPEAT',
]);
const INSUFFICIENT_REASON_CODES = Object.freeze([
  'CONFIDENCE_EVALUATION_MISSING',
  'INSUFFICIENT_EVIDENCE',
  'OCCURRENCES_BELOW_ELIGIBILITY_THRESHOLD',
]);
const THRESHOLDS = Object.freeze({
  strongOccurrences: 5,
  sufficientEvidence: 3,
  strongHistoryDays: 90,
  strongDominantShare: 0.8,
  strongConsistencyComponent: 8,
});
const EXPLANATION_CODE_ORDER = Object.freeze([
  'HIGH_CONFIDENCE',
  'MODERATE_CONFIDENCE',
  'LOW_CONFIDENCE',
  'STRONG_HISTORY',
  'WEAK_HISTORY',
  'HAS_CONTRADICTIONS',
  'INSUFFICIENT_EVIDENCE',
  'DATA_QUALITY_ISSUES',
  'GUIDANCE_ONLY',
  'ITEM_SCOPE',
  'BRAND_SCOPE',
  'SUPPLIER_SCOPE',
  'BROAD_SCOPE',
  'ELIGIBLE_FOR_REVIEW',
  'REVIEW_ONLY',
  'INELIGIBLE',
  'MANUAL_REVIEW_REQUIRED',
]);
const HEADLINES = Object.freeze({
  SAME_ITEM_SAME_DECISION: 'Повторяющееся решение по товару',
  SAME_ITEM_SAME_REASON: 'Повторяющаяся причина решения по товару',
  BRAND_DECISION_BIAS: 'Повторяющаяся особенность бренда',
  SUPPLIER_DECISION_BIAS: 'Повторяющаяся особенность поставщика',
  AGENT_DISAGREEMENT_REPEAT: 'Повторяющееся расхождение с агентом',
});
const FIXED_STRENGTHS = Object.freeze({
  occurrence: 'Высокая повторяемость',
  confidenceHigh: 'Высокий confidence',
  confidenceModerate: 'Умеренный confidence',
  history: 'Большой период наблюдений',
  share: 'Высокая доля доминирующего решения',
  consistency: 'Устойчивость во времени',
});
const FIXED_RISKS = Object.freeze({
  contradictions: 'Есть противоречия',
  insufficient: 'Недостаточно истории',
  dataQuality: 'Низкое качество данных',
  broadScope: 'Большая область действия',
  lowConfidence: 'Низкий confidence',
  guidance: 'Кандидат предназначен только для рекомендации',
  ineligible: 'Кандидат нельзя безопасно представить как правило',
});

class OwnerLearningExplanationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OwnerLearningExplanationError';
    this.code = 'OWNER_LEARNING_EXPLANATIONS_INVALID_INPUT';
  }
}

function invalidInput(message) {
  throw new OwnerLearningExplanationError(message);
}

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function finiteRange(value, minimum, maximum) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum;
}

function expectedConfidenceLevel(score) {
  if (score <= 24) return 'LOW';
  if (score <= 49) return 'MEDIUM';
  if (score <= 74) return 'HIGH';
  return 'VERY_HIGH';
}

function expectedPriorityLevel(score) {
  if (score <= 24) return 'LOW';
  if (score <= 49) return 'MEDIUM';
  if (score <= 74) return 'HIGH';
  return 'CRITICAL';
}

function validateCandidate(candidate) {
  if (!isPlainObject(candidate)) {
    invalidInput('candidate должен быть объектом.');
  }
  const definition = PATTERN_DEFINITIONS[candidate.patternType];
  if (
    candidate.schemaVersion !== CANDIDATE_SCHEMA_VERSION ||
    !definition ||
    candidate.scopeType !== definition.scopeType ||
    candidate.proposedRuleType !== definition.proposedRuleType
  ) {
    invalidInput('candidate имеет неподдерживаемый контракт.');
  }
  if (
    !isPlainObject(candidate.proposedAction) ||
    !(
      candidate.proposedAction.decision === null ||
      SUPPORTED_DECISIONS.includes(candidate.proposedAction.decision)
    ) ||
    !isPlainObject(candidate.confidence) ||
    !isPlainObject(candidate.ranking) ||
    !isPlainObject(candidate.ranking.components) ||
    !isPlainObject(candidate.evidence) ||
    !isPlainObject(candidate.eligibility) ||
    !Array.isArray(candidate.eligibility.reasons)
  ) {
    invalidInput('candidate содержит неполную структуру.');
  }
  const confidenceScore = candidate.confidence.score;
  const confidenceLevel = candidate.confidence.level;
  if (
    confidenceScore === null ||
    confidenceLevel === null
  ) {
    if (
      confidenceScore !== null ||
      confidenceLevel !== null ||
      candidate.eligibility.status !== 'INELIGIBLE'
    ) {
      invalidInput('candidate confidence некорректен.');
    }
  } else if (
    !Number.isInteger(confidenceScore) ||
    confidenceScore < 0 ||
    confidenceScore > 100 ||
    !CONFIDENCE_LEVELS.includes(confidenceLevel) ||
    confidenceLevel !== expectedConfidenceLevel(confidenceScore)
  ) {
    invalidInput('candidate confidence некорректен.');
  }
  if (
    !Number.isInteger(candidate.ranking.priorityScore) ||
    candidate.ranking.priorityScore < 0 ||
    candidate.ranking.priorityScore > 100 ||
    !PRIORITY_LEVELS.includes(candidate.ranking.priorityLevel) ||
    candidate.ranking.priorityLevel !== expectedPriorityLevel(
      candidate.ranking.priorityScore
    ) ||
    !finiteRange(
      candidate.ranking.components.consistencyComponent,
      0,
      10
    ) ||
    !finiteRange(
      candidate.ranking.components.contradictionPenalty,
      0,
      20
    ) ||
    !finiteRange(
      candidate.ranking.components.dataQualityPenalty,
      0,
      20
    )
  ) {
    invalidInput('candidate ranking некорректен.');
  }
  if (
    !nonNegativeInteger(candidate.evidence.occurrences) ||
    !nonNegativeInteger(
      candidate.evidence.supportingDecisionIdsCount
    ) ||
    !(
      candidate.evidence.dominantShare === null ||
      finiteRange(candidate.evidence.dominantShare, 0, 1)
    ) ||
    !(
      candidate.evidence.historySpanDays === null ||
      nonNegativeInteger(candidate.evidence.historySpanDays)
    ) ||
    !ELIGIBILITY_STATUSES.includes(candidate.eligibility.status) ||
    candidate.eligibility.reasons.some(reason =>
      typeof reason !== 'string'
    )
  ) {
    invalidInput('candidate evidence или eligibility некорректны.');
  }
  return candidate;
}

function summaryFor(candidate) {
  const decision = candidate.proposedAction.decision;
  if (candidate.patternType === 'SAME_ITEM_SAME_DECISION') {
    if (decision) {
      return `В истории обнаружено повторяющееся решение ${decision} ` +
        'по данному товару.';
    }
    return 'В истории обнаружен кандидат повторяющегося решения по ' +
      'товару, но безопасное действие не определено.';
  }
  if (candidate.patternType === 'SAME_ITEM_SAME_REASON') {
    return 'В истории обнаружена повторяющаяся причина решения по ' +
      'данному товару. Кандидат предназначен только для подсказки.';
  }
  if (candidate.patternType === 'BRAND_DECISION_BIAS') {
    return decision
      ? `В истории повторяется решение ${decision} для товаров данного ` +
          'бренда. Кандидат требует ручной проверки.'
      : 'В истории обнаружена повторяющаяся особенность решений для ' +
          'данного бренда. Кандидат требует ручной проверки.';
  }
  if (candidate.patternType === 'SUPPLIER_DECISION_BIAS') {
    return decision
      ? `В истории повторяется решение ${decision} для товаров данного ` +
          'поставщика. Кандидат требует ручной проверки.'
      : 'В истории обнаружена повторяющаяся особенность решений для ' +
          'данного поставщика. Кандидат требует ручной проверки.';
  }
  return 'В истории обнаружено повторяющееся расхождение между ' +
    'рекомендацией агента и решением владельца.';
}

function formatPercent(value) {
  if (value === null) return 'нет данных';
  const percentage = Math.round(value * 10000) / 100;
  return Number.isInteger(percentage)
    ? `${percentage}%`
    : `${percentage.toFixed(2).replace(/0+$/, '')}%`;
}

function detailsFor(candidate) {
  return [
    `Повторений: ${candidate.evidence.occurrences}`,
    `Confidence: ${candidate.confidence.score ?? 'нет оценки'}`,
    `Priority: ${candidate.ranking.priorityLevel}`,
    `Dominant share: ${formatPercent(
      candidate.evidence.dominantShare
    )}`,
    `История: ${
      candidate.evidence.historySpanDays === null
        ? 'нет данных'
        : `${candidate.evidence.historySpanDays} дней`
    }`,
    `Статус кандидата: ${candidate.eligibility.status}`,
  ];
}

function insufficientEvidence(candidate) {
  return candidate.evidence.supportingDecisionIdsCount <
      THRESHOLDS.sufficientEvidence ||
    candidate.eligibility.reasons.some(reason =>
      INSUFFICIENT_REASON_CODES.includes(reason)
    );
}

function strengthsFor(candidate) {
  const strengths = [];
  if (
    candidate.evidence.occurrences >= THRESHOLDS.strongOccurrences
  ) {
    strengths.push(FIXED_STRENGTHS.occurrence);
  }
  if (
    ['HIGH', 'VERY_HIGH'].includes(candidate.confidence.level)
  ) {
    strengths.push(FIXED_STRENGTHS.confidenceHigh);
  } else if (candidate.confidence.level === 'MEDIUM') {
    strengths.push(FIXED_STRENGTHS.confidenceModerate);
  }
  if (
    candidate.evidence.historySpanDays !== null &&
    candidate.evidence.historySpanDays >=
      THRESHOLDS.strongHistoryDays
  ) {
    strengths.push(FIXED_STRENGTHS.history);
  }
  if (
    candidate.evidence.dominantShare !== null &&
    candidate.evidence.dominantShare >=
      THRESHOLDS.strongDominantShare
  ) {
    strengths.push(FIXED_STRENGTHS.share);
  }
  if (
    candidate.ranking.components.consistencyComponent >=
      THRESHOLDS.strongConsistencyComponent
  ) {
    strengths.push(FIXED_STRENGTHS.consistency);
  }
  return strengths;
}

function risksFor(candidate) {
  const risks = [];
  if (candidate.ranking.components.contradictionPenalty > 0) {
    risks.push(FIXED_RISKS.contradictions);
  }
  if (insufficientEvidence(candidate)) {
    risks.push(FIXED_RISKS.insufficient);
  }
  if (candidate.ranking.components.dataQualityPenalty > 0) {
    risks.push(FIXED_RISKS.dataQuality);
  }
  if (['BRAND', 'SUPPLIER'].includes(candidate.scopeType)) {
    risks.push(FIXED_RISKS.broadScope);
  }
  if (
    candidate.confidence.level === 'LOW' ||
    candidate.confidence.level === null
  ) {
    risks.push(FIXED_RISKS.lowConfidence);
  }
  if (GUIDANCE_PATTERN_TYPES.includes(candidate.patternType)) {
    risks.push(FIXED_RISKS.guidance);
  }
  if (candidate.eligibility.status === 'INELIGIBLE') {
    risks.push(FIXED_RISKS.ineligible);
  }
  return risks;
}

function recommendedOwnerActionFor(candidate) {
  if (candidate.eligibility.status === 'ELIGIBLE') {
    return 'REVIEW_AND_APPROVE';
  }
  if (
    insufficientEvidence(candidate) ||
    candidate.confidence.level === 'LOW' ||
    candidate.confidence.level === null
  ) {
    return 'COLLECT_MORE_HISTORY';
  }
  if (candidate.eligibility.status === 'REVIEW_ONLY') {
    return 'REVIEW_ONLY';
  }
  return 'DO_NOT_CREATE_RULE';
}

function explanationCodesFor(candidate) {
  const codes = new Set();
  if (['HIGH', 'VERY_HIGH'].includes(candidate.confidence.level)) {
    codes.add('HIGH_CONFIDENCE');
  } else if (candidate.confidence.level === 'MEDIUM') {
    codes.add('MODERATE_CONFIDENCE');
  } else {
    codes.add('LOW_CONFIDENCE');
  }
  const strongHistory =
    candidate.evidence.occurrences >= THRESHOLDS.strongOccurrences ||
    (
      candidate.evidence.historySpanDays !== null &&
      candidate.evidence.historySpanDays >=
        THRESHOLDS.strongHistoryDays
    );
  codes.add(strongHistory ? 'STRONG_HISTORY' : 'WEAK_HISTORY');
  if (candidate.ranking.components.contradictionPenalty > 0) {
    codes.add('HAS_CONTRADICTIONS');
  }
  if (insufficientEvidence(candidate)) {
    codes.add('INSUFFICIENT_EVIDENCE');
  }
  if (candidate.ranking.components.dataQualityPenalty > 0) {
    codes.add('DATA_QUALITY_ISSUES');
  }
  if (GUIDANCE_PATTERN_TYPES.includes(candidate.patternType)) {
    codes.add('GUIDANCE_ONLY');
  }
  codes.add(`${candidate.scopeType}_SCOPE`);
  if (['BRAND', 'SUPPLIER'].includes(candidate.scopeType)) {
    codes.add('BROAD_SCOPE');
  }
  if (candidate.eligibility.status === 'ELIGIBLE') {
    codes.add('ELIGIBLE_FOR_REVIEW');
  } else if (candidate.eligibility.status === 'REVIEW_ONLY') {
    codes.add('REVIEW_ONLY');
  } else {
    codes.add('INELIGIBLE');
  }
  codes.add('MANUAL_REVIEW_REQUIRED');
  return EXPLANATION_CODE_ORDER.filter(code => codes.has(code));
}

function buildCandidateExplanation(candidate) {
  const validated = validateCandidate(candidate);
  const summary = summaryFor(validated);
  if (summary.length > 200) {
    invalidInput('Шаблон summary превысил 200 символов.');
  }
  const recommendedOwnerAction =
    recommendedOwnerActionFor(validated);
  if (!RECOMMENDED_OWNER_ACTIONS.includes(recommendedOwnerAction)) {
    invalidInput('Не удалось определить recommendedOwnerAction.');
  }
  return {
    headline: HEADLINES[validated.patternType],
    summary,
    details: detailsFor(validated),
    strengths: strengthsFor(validated),
    risks: risksFor(validated),
    recommendedOwnerAction,
    explanationCodes: explanationCodesFor(validated),
  };
}

function buildCandidateExplanations(candidates) {
  if (!Array.isArray(candidates)) {
    invalidInput('candidates должен быть массивом.');
  }
  return candidates.map(buildCandidateExplanation);
}

module.exports = {
  EXPLANATION_CODE_ORDER,
  RECOMMENDED_OWNER_ACTIONS,
  THRESHOLDS,
  OwnerLearningExplanationError,
  buildCandidateExplanation,
  buildCandidateExplanations,
};
