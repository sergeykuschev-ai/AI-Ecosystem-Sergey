const {
  OWNER_DECISIONS,
  REASON_CODES,
} = require('./owner_decision_history');
const {
  normalizeAgentRecommendation,
} = require('./owner_learning_report');

const CONFIDENCE_SCHEMA_VERSION = 'owner-learning-confidence-v0.8.1';
const MAX_EVIDENCE_DECISION_IDS = 100;
const MAX_CONTRADICTION_DECISION_IDS = 20;
const DEFAULT_MAX_EVIDENCE_DECISION_IDS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const AGENT_RECOMMENDATIONS = Object.freeze(['BUY', 'SKIP', 'DEFER']);
const CONFIDENCE_LEVELS = Object.freeze({
  LOW: Object.freeze({ minimum: 0, maximum: 24 }),
  MEDIUM: Object.freeze({ minimum: 25, maximum: 49 }),
  HIGH: Object.freeze({ minimum: 50, maximum: 74 }),
  VERY_HIGH: Object.freeze({ minimum: 75, maximum: 100 }),
});
const PATTERN_DEFINITIONS = Object.freeze({
  SAME_ITEM_SAME_DECISION: Object.freeze({
    scopeType: 'ITEM',
    scopeField: 'stableItemKey',
    valueType: 'OWNER_DECISION',
  }),
  SAME_ITEM_SAME_REASON: Object.freeze({
    scopeType: 'ITEM',
    scopeField: 'stableItemKey',
    valueType: 'REASON_CODE',
  }),
  BRAND_DECISION_BIAS: Object.freeze({
    scopeType: 'BRAND',
    scopeField: 'brand',
    valueType: 'OWNER_DECISION',
  }),
  SUPPLIER_DECISION_BIAS: Object.freeze({
    scopeType: 'SUPPLIER',
    scopeField: 'supplier',
    valueType: 'OWNER_DECISION',
  }),
  AGENT_DISAGREEMENT_REPEAT: Object.freeze({
    scopeType: 'ITEM',
    scopeField: 'stableItemKey',
    valueType: 'AGENT_DISAGREEMENT',
  }),
});
const COMPONENT_LIMITS = Object.freeze({
  occurrenceScore: 25,
  dominanceScore: 25,
  consistencyScore: 20,
  recencyScore: 15,
  durationScore: 15,
  contradictionPenalty: 30,
  dataQualityPenalty: 30,
});
const DATA_QUALITY_PENALTIES = Object.freeze({
  missingDateEach: 4,
  missingDateMaximum: 12,
  duplicateDecisionIdEach: 5,
  duplicateDecisionIdMaximum: 10,
  unsupportedValueEach: 5,
  unsupportedValueMaximum: 10,
  missingScopeKey: 10,
  invalidDominantValue: 10,
  invalidShare: 10,
  invalidEvidenceDecisionIds: 5,
  missingEvidenceDecisionIdEach: 3,
  missingEvidenceDecisionIdMaximum: 9,
  insufficientEvidence: 10,
  futureRecordedAt: 8,
});
const WARNING_ORDER = Object.freeze([
  'MISSING_SCOPE_KEY',
  'INVALID_DOMINANT_VALUE',
  'INVALID_DOMINANT_SHARE',
  'MISSING_RECORDED_AT',
  'INVALID_RECORDED_AT',
  'FUTURE_RECORDED_AT',
  'DUPLICATE_DECISION_ID',
  'UNSUPPORTED_OWNER_DECISION',
  'UNSUPPORTED_REASON_CODE',
  'UNSUPPORTED_AGENT_RECOMMENDATION',
  'MISSING_EVIDENCE_DECISION_ID',
  'INVALID_EVIDENCE_DECISION_IDS',
  'INSUFFICIENT_EVIDENCE',
]);
const EXPLANATION_ORDER = Object.freeze([
  'STRONG_OCCURRENCE_COUNT',
  'LIMITED_OCCURRENCE_COUNT',
  'HIGH_DOMINANT_SHARE',
  'MODERATE_DOMINANT_SHARE',
  'RECENT_SUPPORTING_EVIDENCE',
  'STALE_SUPPORTING_EVIDENCE',
  'CONSISTENT_ACROSS_TIME',
  'INCONSISTENT_ACROSS_TIME',
  'LONG_OBSERVATION_PERIOD',
  'SHORT_OBSERVATION_PERIOD',
  'CONTRADICTIONS_PRESENT',
  'NO_CONTRADICTIONS',
  'DATA_QUALITY_ISSUES',
  'INSUFFICIENT_EVIDENCE',
  'CONFIDENCE_DESCRIBES_HISTORICAL_PATTERN_STRENGTH',
]);

class OwnerLearningConfidenceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OwnerLearningConfidenceError';
    this.code = 'OWNER_LEARNING_CONFIDENCE_INVALID_INPUT';
  }
}

function invalidInput(message) {
  throw new OwnerLearningConfidenceError(message);
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

function enumValue(value, allowed) {
  const normalized = safeText(value)?.toUpperCase() || null;
  return normalized && allowed.includes(normalized)
    ? normalized
    : null;
}

function utcTimestamp(value) {
  const normalized = safeText(value);
  if (
    !normalized ||
    !normalized.endsWith('Z') ||
    !normalized.includes('T')
  ) return null;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function validateOptions(options) {
  if (!isPlainObject(options)) {
    invalidInput('options должен быть объектом.');
  }
  const asOfTimestamp = utcTimestamp(options.asOf);
  if (asOfTimestamp === null) {
    invalidInput('options.asOf должен быть ISO UTC datetime.');
  }
  const maxEvidenceDecisionIds = options.maxEvidenceDecisionIds ??
    DEFAULT_MAX_EVIDENCE_DECISION_IDS;
  if (
    !Number.isInteger(maxEvidenceDecisionIds) ||
    maxEvidenceDecisionIds < 1 ||
    maxEvidenceDecisionIds > MAX_EVIDENCE_DECISION_IDS
  ) {
    invalidInput(
      'options.maxEvidenceDecisionIds должен быть целым числом от 1 до 100.'
    );
  }
  const includeLowConfidence = options.includeLowConfidence ?? true;
  if (typeof includeLowConfidence !== 'boolean') {
    invalidInput('options.includeLowConfidence должен быть boolean.');
  }
  return {
    asOf: new Date(asOfTimestamp).toISOString(),
    asOfTimestamp,
    maxEvidenceDecisionIds,
    includeLowConfidence,
  };
}

function historyEntries(history) {
  if (Array.isArray(history)) return history;
  if (isPlainObject(history) && Array.isArray(history.entries)) {
    return history.entries;
  }
  invalidInput(
    'history должен быть массивом или объектом с массивом entries.'
  );
}

function validatePattern(pattern) {
  if (!isPlainObject(pattern)) {
    invalidInput('pattern должен быть объектом.');
  }
  const patternType = safeText(pattern.patternType);
  const definition = PATTERN_DEFINITIONS[patternType];
  if (!definition) {
    invalidInput('pattern.patternType не поддерживается.');
  }
  if (pattern.scopeType !== definition.scopeType) {
    invalidInput('pattern.scopeType не соответствует patternType.');
  }
  if (
    !Number.isInteger(pattern.occurrences) ||
    pattern.occurrences < 0
  ) {
    invalidInput(
      'pattern.occurrences должен быть неотрицательным целым числом.'
    );
  }
  const scopeKey = safeText(pattern.scopeKey);
  if (typeof pattern.scopeKey === 'string' && pathLike(pattern.scopeKey)) {
    invalidInput('pattern.scopeKey содержит небезопасное значение.');
  }
  return {
    definition,
    patternType,
    scopeType: definition.scopeType,
    scopeKey,
  };
}

function occurrenceScore(occurrences) {
  if (occurrences <= 1) return 0;
  if (occurrences === 2) return 5;
  if (occurrences === 3) return 10;
  if (occurrences === 4) return 15;
  if (occurrences <= 6) return 20;
  return 25;
}

function dominanceScore(share) {
  if (share < 0.5) return 0;
  if (share < 0.6) return 5;
  if (share < 0.7) return 10;
  if (share < 0.8) return 15;
  if (share < 0.9) return 20;
  return 25;
}

function recencyScore(ageDays) {
  if (ageDays === null || ageDays < 0) return 0;
  if (ageDays <= 30) return 15;
  if (ageDays <= 60) return 12;
  if (ageDays <= 90) return 9;
  if (ageDays <= 180) return 5;
  if (ageDays <= 365) return 2;
  return 0;
}

function durationScore(spanDays, occurrences) {
  if (occurrences <= 1 || spanDays === null || spanDays < 7) return 0;
  if (spanDays < 30) return 3;
  if (spanDays < 90) return 6;
  if (spanDays < 180) return 9;
  if (spanDays < 365) return 12;
  return 15;
}

function contradictionPenalty(share) {
  if (share <= 0) return 0;
  if (share <= 0.1) return 3;
  if (share <= 0.2) return 7;
  if (share <= 0.3) return 12;
  if (share <= 0.4) return 18;
  if (share <= 0.5) return 24;
  return 30;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedEntry(value, inputIndex) {
  const entry = isPlainObject(value) ? value : {};
  const decisionId = safeText(entry.decisionId);
  const recordedAtText = safeText(entry.recordedAt);
  const recordedAtTimestamp = utcTimestamp(recordedAtText);
  return {
    inputIndex,
    decisionId,
    stableItemKey: safeText(entry.stableItemKey),
    brand: safeText(entry.brand),
    supplier: safeText(entry.supplier),
    ownerDecisionText: safeText(entry.ownerDecision),
    ownerDecision: enumValue(entry.ownerDecision, OWNER_DECISIONS),
    reasonCodeText: safeText(entry.reasonCode),
    reasonCode: enumValue(entry.reasonCode, REASON_CODES),
    agentRecommendationText: safeText(entry.agentRecommendation),
    agentRecommendation: normalizeAgentRecommendation(
      safeText(entry.agentRecommendation)
    ),
    recordedAtText,
    recordedAtTimestamp,
  };
}

function relevantEntries(rawEntries, definition, scopeKey) {
  if (!scopeKey) return [];
  return rawEntries
    .map(normalizedEntry)
    .filter(entry => entry[definition.scopeField] === scopeKey);
}

function deduplicateEntries(entries) {
  const seen = new Set();
  const values = [];
  let duplicateDecisionIds = 0;
  for (const entry of entries) {
    if (entry.decisionId) {
      if (seen.has(entry.decisionId)) {
        duplicateDecisionIds += 1;
        continue;
      }
      seen.add(entry.decisionId);
    }
    values.push(entry);
  }
  return { entries: values, duplicateDecisionIds };
}

function validDisagreementDominant(value) {
  const normalized = safeText(value)?.toUpperCase() || null;
  if (!normalized) return null;
  const match = normalized.match(/^(BUY|SKIP|DEFER)->(BUY|SKIP|DEFER)$/);
  return match && match[1] !== match[2] ? normalized : null;
}

function dominantValue(pattern, definition) {
  if (definition.valueType === 'OWNER_DECISION') {
    return enumValue(pattern.dominantValue, OWNER_DECISIONS);
  }
  if (definition.valueType === 'REASON_CODE') {
    return enumValue(pattern.dominantValue, REASON_CODES);
  }
  return validDisagreementDominant(pattern.dominantValue);
}

function entryClassification(entry, definition, dominant) {
  if (definition.valueType === 'OWNER_DECISION') {
    if (!entry.ownerDecision) return 'UNSUPPORTED';
    return entry.ownerDecision === dominant ? 'SUPPORT' : 'CONTRADICTION';
  }
  if (definition.valueType === 'REASON_CODE') {
    if (!entry.reasonCode) return 'UNSUPPORTED';
    return entry.reasonCode === dominant ? 'SUPPORT' : 'CONTRADICTION';
  }
  const comparable =
    AGENT_RECOMMENDATIONS.includes(entry.agentRecommendation) &&
    AGENT_RECOMMENDATIONS.includes(entry.ownerDecision);
  if (!comparable) return 'UNSUPPORTED';
  return entry.agentRecommendation !== entry.ownerDecision
    ? 'SUPPORT'
    : 'CONTRADICTION';
}

function consistencyScore(entries, classifications) {
  const dated = entries
    .map((entry, index) => ({
      entry,
      classification: classifications[index],
    }))
    .filter(item =>
      item.entry.recordedAtTimestamp !== null &&
      item.classification !== 'UNSUPPORTED'
    )
    .sort((left, right) =>
      left.entry.recordedAtTimestamp - right.entry.recordedAtTimestamp ||
      String(left.entry.decisionId || '').localeCompare(
        String(right.entry.decisionId || ''),
        'en'
      ) ||
      left.entry.inputIndex - right.entry.inputIndex
    );
  if (dated.length <= 2) return 0;
  const split = Math.ceil(dated.length / 2);
  const early = dated.slice(0, split);
  const late = dated.slice(split);
  const supportShare = values =>
    values.filter(item => item.classification === 'SUPPORT').length /
      values.length;
  const earlyShare = supportShare(early);
  const lateShare = supportShare(late);
  if (earlyShare >= 0.75 && lateShare >= 0.75) return 20;
  if (earlyShare >= 0.6 && lateShare >= 0.6) return 15;
  if (earlyShare > 0 && lateShare > 0) return 10;
  if (earlyShare > 0 || lateShare > 0) return 5;
  return 0;
}

function dateEvidence(supportingEntries, asOfTimestamp) {
  const timestamps = supportingEntries
    .map(entry => entry.recordedAtTimestamp)
    .filter(value => value !== null)
    .sort((left, right) => left - right);
  const first = timestamps[0] ?? null;
  const last = timestamps.at(-1) ?? null;
  return {
    firstRecordedAt: first === null ? null : new Date(first).toISOString(),
    lastRecordedAt: last === null ? null : new Date(last).toISOString(),
    historySpanDays: first === null || last === null
      ? null
      : Math.floor((last - first) / DAY_MS),
    ageDays: last === null
      ? null
      : Math.floor((asOfTimestamp - last) / DAY_MS),
  };
}

function countUnsupported(entries, definition) {
  if (definition.valueType === 'OWNER_DECISION') {
    return entries.filter(entry =>
      entry.ownerDecisionText && !entry.ownerDecision
    ).length;
  }
  if (definition.valueType === 'REASON_CODE') {
    return entries.filter(entry =>
      entry.reasonCodeText && !entry.reasonCode
    ).length;
  }
  return entries.filter(entry => {
    const ownerInvalid =
      entry.ownerDecisionText && !entry.ownerDecision;
    const agentInvalid =
      entry.agentRecommendationText && !entry.agentRecommendation;
    return ownerInvalid || agentInvalid;
  }).length;
}

function missingEvidenceIds(pattern, historyIds) {
  if (
    pattern.evidenceDecisionIds !== undefined &&
    !Array.isArray(pattern.evidenceDecisionIds)
  ) {
    return { count: 0, invalid: true };
  }
  const evidenceIds = Array.isArray(pattern.evidenceDecisionIds)
    ? Array.from(new Set(
      pattern.evidenceDecisionIds
        .map(safeText)
        .filter(Boolean)
    ))
    : [];
  return {
    count: evidenceIds.filter(id => !historyIds.has(id)).length,
    invalid: false,
  };
}

function buildDataQuality({
  entries,
  definition,
  duplicateDecisionIds,
  dominantValid,
  shareValid,
  scopeKey,
  missingEvidence,
  supportingEntries,
  futureDates,
}) {
  const warnings = new Set();
  let missingDates = 0;
  for (const entry of entries) {
    if (!entry.recordedAtText) {
      missingDates += 1;
      warnings.add('MISSING_RECORDED_AT');
    } else if (entry.recordedAtTimestamp === null) {
      missingDates += 1;
      warnings.add('INVALID_RECORDED_AT');
    }
  }
  const unsupportedValues = countUnsupported(entries, definition);
  if (unsupportedValues > 0) {
    if (definition.valueType === 'REASON_CODE') {
      warnings.add('UNSUPPORTED_REASON_CODE');
    } else if (definition.valueType === 'AGENT_DISAGREEMENT') {
      if (entries.some(entry =>
        entry.ownerDecisionText && !entry.ownerDecision
      )) warnings.add('UNSUPPORTED_OWNER_DECISION');
      if (entries.some(entry =>
        entry.agentRecommendationText && !entry.agentRecommendation
      )) warnings.add('UNSUPPORTED_AGENT_RECOMMENDATION');
    } else {
      warnings.add('UNSUPPORTED_OWNER_DECISION');
    }
  }
  if (!scopeKey) warnings.add('MISSING_SCOPE_KEY');
  if (!dominantValid) warnings.add('INVALID_DOMINANT_VALUE');
  if (!shareValid) warnings.add('INVALID_DOMINANT_SHARE');
  if (duplicateDecisionIds > 0) {
    warnings.add('DUPLICATE_DECISION_ID');
  }
  if (missingEvidence.count > 0) {
    warnings.add('MISSING_EVIDENCE_DECISION_ID');
  }
  if (missingEvidence.invalid) {
    warnings.add('INVALID_EVIDENCE_DECISION_IDS');
  }
  if (futureDates > 0) warnings.add('FUTURE_RECORDED_AT');
  const insufficientEvidence = supportingEntries.length < 2;
  const insufficientEvidencePenaltyApplies =
    insufficientEvidence && Boolean(scopeKey) && dominantValid;
  if (insufficientEvidence) warnings.add('INSUFFICIENT_EVIDENCE');
  const penalty =
    Math.min(
      DATA_QUALITY_PENALTIES.missingDateMaximum,
      missingDates * DATA_QUALITY_PENALTIES.missingDateEach
    ) +
    Math.min(
      DATA_QUALITY_PENALTIES.duplicateDecisionIdMaximum,
      duplicateDecisionIds *
        DATA_QUALITY_PENALTIES.duplicateDecisionIdEach
    ) +
    Math.min(
      DATA_QUALITY_PENALTIES.unsupportedValueMaximum,
      unsupportedValues * DATA_QUALITY_PENALTIES.unsupportedValueEach
    ) +
    (!scopeKey ? DATA_QUALITY_PENALTIES.missingScopeKey : 0) +
    (!dominantValid
      ? DATA_QUALITY_PENALTIES.invalidDominantValue
      : 0) +
    (!shareValid ? DATA_QUALITY_PENALTIES.invalidShare : 0) +
    (missingEvidence.invalid
      ? DATA_QUALITY_PENALTIES.invalidEvidenceDecisionIds
      : 0) +
    Math.min(
      DATA_QUALITY_PENALTIES.missingEvidenceDecisionIdMaximum,
      missingEvidence.count *
        DATA_QUALITY_PENALTIES.missingEvidenceDecisionIdEach
    ) +
    (insufficientEvidencePenaltyApplies
      ? DATA_QUALITY_PENALTIES.insufficientEvidence
      : 0) +
    (futureDates > 0 ? DATA_QUALITY_PENALTIES.futureRecordedAt : 0);
  return {
    penalty: clamp(
      penalty,
      0,
      COMPONENT_LIMITS.dataQualityPenalty
    ),
    dataQuality: {
      missingDates,
      unsupportedValues,
      duplicateDecisionIds,
      insufficientEvidence,
      warnings: WARNING_ORDER.filter(warning => warnings.has(warning)),
    },
  };
}

function explanationCodes({
  occurrences,
  share,
  recency,
  consistency,
  duration,
  contradictions,
  dataQuality,
}) {
  const codes = new Set();
  codes.add(
    occurrences >= 7
      ? 'STRONG_OCCURRENCE_COUNT'
      : 'LIMITED_OCCURRENCE_COUNT'
  );
  if (share >= 0.9) codes.add('HIGH_DOMINANT_SHARE');
  else if (share >= 0.6) codes.add('MODERATE_DOMINANT_SHARE');
  if (recency >= 12) codes.add('RECENT_SUPPORTING_EVIDENCE');
  else if (recency <= 2) codes.add('STALE_SUPPORTING_EVIDENCE');
  if (consistency >= 15) codes.add('CONSISTENT_ACROSS_TIME');
  else if (consistency <= 5) codes.add('INCONSISTENT_ACROSS_TIME');
  if (duration >= 12) codes.add('LONG_OBSERVATION_PERIOD');
  else if (duration <= 3) codes.add('SHORT_OBSERVATION_PERIOD');
  codes.add(
    contradictions > 0
      ? 'CONTRADICTIONS_PRESENT'
      : 'NO_CONTRADICTIONS'
  );
  if (dataQuality.warnings.length > 0) {
    codes.add('DATA_QUALITY_ISSUES');
  }
  if (dataQuality.insufficientEvidence) {
    codes.add('INSUFFICIENT_EVIDENCE');
  }
  codes.add('CONFIDENCE_DESCRIBES_HISTORICAL_PATTERN_STRENGTH');
  return EXPLANATION_ORDER.filter(code => codes.has(code));
}

function getConfidenceLevel(score) {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    invalidInput('score должен быть целым числом от 0 до 100.');
  }
  if (score <= CONFIDENCE_LEVELS.LOW.maximum) return 'LOW';
  if (score <= CONFIDENCE_LEVELS.MEDIUM.maximum) return 'MEDIUM';
  if (score <= CONFIDENCE_LEVELS.HIGH.maximum) return 'HIGH';
  return 'VERY_HIGH';
}

function evaluatePatternConfidence({
  pattern,
  history,
  options,
} = {}) {
  const validatedPattern = validatePattern(pattern);
  const validatedOptions = validateOptions(options);
  const rawEntries = historyEntries(history);
  const relevant = relevantEntries(
    rawEntries,
    validatedPattern.definition,
    validatedPattern.scopeKey
  );
  const deduplicated = deduplicateEntries(relevant);
  const dominant = dominantValue(
    pattern,
    validatedPattern.definition
  );
  const dominantValid = dominant !== null;
  const shareValid =
    typeof pattern.share === 'number' &&
    Number.isFinite(pattern.share) &&
    pattern.share >= 0 &&
    pattern.share <= 1;
  const classifications = dominantValid
    ? deduplicated.entries.map(entry =>
      entryClassification(
        entry,
        validatedPattern.definition,
        dominant
      )
    )
    : deduplicated.entries.map(() => 'UNSUPPORTED');
  const supportingEntries = deduplicated.entries.filter(
    (entry, index) => classifications[index] === 'SUPPORT'
  );
  const contradictoryEntries = deduplicated.entries.filter(
    (entry, index) => classifications[index] === 'CONTRADICTION'
  );
  const comparableCount =
    supportingEntries.length + contradictoryEntries.length;
  const contradictionShare = comparableCount === 0
    ? 0
    : contradictoryEntries.length / comparableCount;
  const dates = dateEvidence(
    supportingEntries,
    validatedOptions.asOfTimestamp
  );
  const futureDates = deduplicated.entries.filter(entry =>
    entry.recordedAtTimestamp !== null &&
    entry.recordedAtTimestamp > validatedOptions.asOfTimestamp
  ).length;
  const historyIds = new Set(
    rawEntries
      .filter(isPlainObject)
      .map(entry => safeText(entry.decisionId))
      .filter(Boolean)
  );
  const missingEvidence = missingEvidenceIds(pattern, historyIds);
  const quality = buildDataQuality({
    entries: deduplicated.entries,
    definition: validatedPattern.definition,
    duplicateDecisionIds: deduplicated.duplicateDecisionIds,
    dominantValid,
    shareValid,
    scopeKey: validatedPattern.scopeKey,
    missingEvidence,
    supportingEntries,
    futureDates,
  });
  const components = {
    occurrenceScore: occurrenceScore(supportingEntries.length),
    dominanceScore: dominanceScore(shareValid ? pattern.share : 0),
    recencyScore: recencyScore(dates.ageDays),
    consistencyScore: dominantValid
      ? consistencyScore(deduplicated.entries, classifications)
      : 0,
    durationScore: durationScore(
      dates.historySpanDays,
      supportingEntries.length
    ),
    contradictionPenalty: contradictionPenalty(contradictionShare),
    dataQualityPenalty: quality.penalty,
  };
  const rawScore =
    components.occurrenceScore +
    components.dominanceScore +
    components.consistencyScore +
    components.recencyScore +
    components.durationScore -
    components.contradictionPenalty -
    components.dataQualityPenalty;
  const confidenceScore = clamp(Math.round(rawScore), 0, 100);
  const contradictionIds = Array.from(new Set(
    contradictoryEntries
      .map(entry => entry.decisionId)
    .filter(Boolean)
  ))
    .sort((left, right) => left.localeCompare(right, 'en'))
    .slice(0, Math.min(
      validatedOptions.maxEvidenceDecisionIds,
      MAX_CONTRADICTION_DECISION_IDS
    ));
  const evaluation = {
    schemaVersion: CONFIDENCE_SCHEMA_VERSION,
    patternType: validatedPattern.patternType,
    scopeType: validatedPattern.scopeType,
    scopeKey: validatedPattern.scopeKey,
    confidenceScore,
    confidenceLevel: getConfidenceLevel(confidenceScore),
    evidence: {
      occurrences: supportingEntries.length,
      totalRelevantEntries: deduplicated.entries.length,
      dominantShare: shareValid ? pattern.share : null,
      supportingDecisionIdsCount: new Set(
        supportingEntries
          .map(entry => entry.decisionId)
          .filter(Boolean)
      ).size,
      firstRecordedAt: dates.firstRecordedAt,
      lastRecordedAt: dates.lastRecordedAt,
      historySpanDays: dates.historySpanDays,
    },
    components,
    contradictions: {
      count: contradictoryEntries.length,
      share: Math.round(contradictionShare * 10000) / 10000,
      decisionIds: contradictionIds,
    },
    dataQuality: quality.dataQuality,
    explanationCodes: explanationCodes({
      occurrences: supportingEntries.length,
      share: shareValid ? pattern.share : 0,
      recency: components.recencyScore,
      consistency: components.consistencyScore,
      duration: components.durationScore,
      contradictions: contradictoryEntries.length,
      dataQuality: quality.dataQuality,
    }),
  };
  return evaluation;
}

function evaluateAllPatternConfidences({
  analytics,
  history,
  options,
} = {}) {
  if (
    !isPlainObject(analytics) ||
    !Array.isArray(analytics.repeatedDecisionPatterns)
  ) {
    invalidInput(
      'analytics должен содержать repeatedDecisionPatterns.'
    );
  }
  const validatedOptions = validateOptions(options);
  historyEntries(history);
  const evaluations = analytics.repeatedDecisionPatterns.map(pattern =>
    evaluatePatternConfidence({
      pattern,
      history,
      options: validatedOptions,
    })
  );
  return validatedOptions.includeLowConfidence
    ? evaluations
    : evaluations.filter(item => item.confidenceLevel !== 'LOW');
}

function rankPatternsByConfidence({ evaluations, limit } = {}) {
  if (!Array.isArray(evaluations)) {
    invalidInput('evaluations должен быть массивом.');
  }
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > 100)
  ) {
    invalidInput('limit должен быть целым числом от 1 до 100.');
  }
  for (const evaluation of evaluations) {
    if (
      !isPlainObject(evaluation) ||
      !Number.isInteger(evaluation.confidenceScore) ||
      evaluation.confidenceScore < 0 ||
      evaluation.confidenceScore > 100 ||
      !Number.isInteger(evaluation.evidence?.occurrences) ||
      typeof evaluation.patternType !== 'string' ||
      typeof evaluation.scopeType !== 'string' ||
      typeof evaluation.scopeKey !== 'string'
    ) {
      invalidInput('evaluations содержит некорректную оценку.');
    }
  }
  const ranked = [...evaluations].sort((left, right) =>
    right.confidenceScore - left.confidenceScore ||
    right.evidence.occurrences - left.evidence.occurrences ||
    left.patternType.localeCompare(right.patternType, 'en') ||
    left.scopeType.localeCompare(right.scopeType, 'en') ||
    left.scopeKey.localeCompare(right.scopeKey, 'ru')
  );
  return limit === undefined ? ranked : ranked.slice(0, limit);
}

module.exports = {
  COMPONENT_LIMITS,
  CONFIDENCE_LEVELS,
  CONFIDENCE_SCHEMA_VERSION,
  DATA_QUALITY_PENALTIES,
  PATTERN_DEFINITIONS,
  OwnerLearningConfidenceError,
  evaluateAllPatternConfidences,
  evaluatePatternConfidence,
  getConfidenceLevel,
  rankPatternsByConfidence,
};
