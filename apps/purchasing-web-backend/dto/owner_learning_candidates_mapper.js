const DISPLAY_FALLBACKS = Object.freeze({
  ITEM: 'Товар без названия',
  BRAND: 'Бренд не указан',
  SUPPLIER: 'Поставщик не указан',
});

function pathLike(value) {
  return value.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith('file://');
}

function nullableText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && !pathLike(normalized) ? normalized : null;
}

function nullableNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function textList(value) {
  return Array.isArray(value)
    ? value.map(nullableText).filter(Boolean)
    : [];
}

function itemDisplayScope(candidate, analytics) {
  const item = (analytics?.itemAnalytics || []).find(value =>
    value?.stableItemKey === candidate.scopeKey
  );
  const productName = nullableText(item?.productName);
  const sku = nullableText(item?.sku);
  return {
    primary: productName || sku || DISPLAY_FALLBACKS.ITEM,
    secondary: productName && sku ? `SKU ${sku}` : null,
  };
}

function displayScope(candidate, analytics) {
  if (candidate?.scopeType === 'ITEM') {
    return itemDisplayScope(candidate, analytics);
  }
  if (candidate?.scopeType === 'BRAND') {
    const group = (analytics?.brandAnalytics || []).find(value =>
      value?.brand === candidate.scopeKey
    );
    return {
      primary: nullableText(group?.brand) ||
        nullableText(candidate.scopeKey) ||
        DISPLAY_FALLBACKS.BRAND,
      secondary: null,
    };
  }
  if (candidate?.scopeType === 'SUPPLIER') {
    const group = (analytics?.supplierAnalytics || []).find(value =>
      value?.supplier === candidate.scopeKey
    );
    return {
      primary: nullableText(group?.supplier) ||
        nullableText(candidate.scopeKey) ||
        DISPLAY_FALLBACKS.SUPPLIER,
      secondary: null,
    };
  }
  return {
    primary: DISPLAY_FALLBACKS.ITEM,
    secondary: null,
  };
}

function mapExplanation(explanation = {}) {
  return {
    headline: nullableText(explanation.headline),
    summary: nullableText(explanation.summary),
    details: textList(explanation.details),
    strengths: textList(explanation.strengths),
    risks: textList(explanation.risks),
    recommendedOwnerAction:
      nullableText(explanation.recommendedOwnerAction),
    explanationCodes: textList(explanation.explanationCodes),
  };
}

function mapLifecycle(lifecycle = {}) {
  return {
    status: nullableText(lifecycle.status) || 'NEW',
    lastAction: nullableText(lifecycle.lastAction),
    lastRecordedAt: nullableText(lifecycle.lastRecordedAt),
    reasonCode: nullableText(lifecycle.reasonCode),
  };
}

function mapOwnerLearningCandidate(
  candidate = {},
  explanation = {},
  analytics = {}
) {
  return {
    candidateId: nullableText(candidate.candidateId),
    scopeKey: nullableText(candidate.scopeKey),
    patternType: nullableText(candidate.patternType),
    scopeType: nullableText(candidate.scopeType),
    displayScope: displayScope(candidate, analytics),
    proposedRuleType: nullableText(candidate.proposedRuleType),
    proposedAction: {
      decision: nullableText(candidate.proposedAction?.decision),
      quantityStrategy:
        nullableText(candidate.proposedAction?.quantityStrategy),
      quantityValue: nullableNumber(
        candidate.proposedAction?.quantityValue
      ),
    },
    confidence: {
      score: nullableNumber(candidate.confidence?.score),
      level: nullableText(candidate.confidence?.level),
    },
    ranking: {
      priorityScore:
        nullableNumber(candidate.ranking?.priorityScore),
      priorityLevel:
        nullableText(candidate.ranking?.priorityLevel),
      rank: nullableNumber(candidate.ranking?.rank),
    },
    evidence: {
      occurrences: count(candidate.evidence?.occurrences),
      dominantShare:
        nullableNumber(candidate.evidence?.dominantShare),
      firstRecordedAt:
        nullableText(candidate.evidence?.firstRecordedAt),
      lastRecordedAt:
        nullableText(candidate.evidence?.lastRecordedAt),
      historySpanDays:
        nullableNumber(candidate.evidence?.historySpanDays),
    },
    impact: {
      estimatedAffectedItems:
        count(candidate.impact?.estimatedAffectedItems),
      estimatedHistoricalQuantityDelta: nullableNumber(
        candidate.impact?.estimatedHistoricalQuantityDelta
      ),
      hasFinancialEstimate:
        candidate.impact?.hasFinancialEstimate === true,
    },
    eligibility: {
      status: nullableText(candidate.eligibility?.status),
      reasons: textList(candidate.eligibility?.reasons),
    },
    explanation: mapExplanation(explanation),
    lifecycle: mapLifecycle(candidate.lifecycle),
  };
}

function mapSummary(summary = {}) {
  return {
    totalCandidates: count(summary.totalCandidates),
    historyEntries: count(summary.historyEntries),
    patternsFound: count(summary.patternsFound),
    eligible: count(summary.eligible),
    reviewOnly: count(summary.reviewOnly),
    ineligible: count(summary.ineligible),
    highPriority: count(summary.highPriority),
    criticalPriority: count(summary.criticalPriority),
    confidenceLevels: {
      LOW: count(summary.confidenceLevels?.LOW),
      MEDIUM: count(summary.confidenceLevels?.MEDIUM),
      HIGH: count(summary.confidenceLevels?.HIGH),
      VERY_HIGH: count(summary.confidenceLevels?.VERY_HIGH),
    },
  };
}

function mapCandidateDto(candidate = {}) {
  return {
    candidateId: nullableText(candidate.candidateId),
    patternType: nullableText(candidate.patternType),
    scopeType: nullableText(candidate.scopeType),
    displayScope: {
      primary: nullableText(candidate.displayScope?.primary),
      secondary: nullableText(candidate.displayScope?.secondary),
    },
    proposedRuleType: nullableText(candidate.proposedRuleType),
    proposedAction: {
      decision: nullableText(candidate.proposedAction?.decision),
      quantityStrategy:
        nullableText(candidate.proposedAction?.quantityStrategy),
      quantityValue:
        nullableNumber(candidate.proposedAction?.quantityValue),
    },
    confidence: {
      score: nullableNumber(candidate.confidence?.score),
      level: nullableText(candidate.confidence?.level),
    },
    ranking: {
      priorityScore:
        nullableNumber(candidate.ranking?.priorityScore),
      priorityLevel:
        nullableText(candidate.ranking?.priorityLevel),
      rank: nullableNumber(candidate.ranking?.rank),
    },
    evidence: {
      occurrences: count(candidate.evidence?.occurrences),
      dominantShare:
        nullableNumber(candidate.evidence?.dominantShare),
      firstRecordedAt:
        nullableText(candidate.evidence?.firstRecordedAt),
      lastRecordedAt:
        nullableText(candidate.evidence?.lastRecordedAt),
      historySpanDays:
        nullableNumber(candidate.evidence?.historySpanDays),
    },
    impact: {
      estimatedAffectedItems:
        count(candidate.impact?.estimatedAffectedItems),
      estimatedHistoricalQuantityDelta: nullableNumber(
        candidate.impact?.estimatedHistoricalQuantityDelta
      ),
      hasFinancialEstimate:
        candidate.impact?.hasFinancialEstimate === true,
    },
    eligibility: {
      status: nullableText(candidate.eligibility?.status),
      reasons: textList(candidate.eligibility?.reasons),
    },
    explanation: mapExplanation(candidate.explanation),
    lifecycle: mapLifecycle(candidate.lifecycle),
    materialization: {
      status:
        nullableText(candidate.materialization?.status) ||
        'NOT_MATERIALIZED',
      ruleId: nullableText(candidate.materialization?.ruleId),
      ruleStatus:
        nullableText(candidate.materialization?.ruleStatus),
      materializedAt:
        nullableText(candidate.materialization?.materializedAt),
    },
  };
}

function mapOwnerLearningCandidates(result = {}) {
  const available = result.status === 'AVAILABLE';
  const mapped = {
    status: available ? 'AVAILABLE' : 'UNAVAILABLE',
    generated_at: available
      ? nullableText(result.generatedAt)
      : null,
    summary: available ? mapSummary(result.summary) : null,
    candidates: available && Array.isArray(result.candidates)
      ? result.candidates.map(mapCandidateDto)
      : [],
    warning: nullableText(result.warning),
  };
  const lifecycleWarning = nullableText(result.lifecycleWarning);
  if (lifecycleWarning) {
    mapped.lifecycle_warning = lifecycleWarning;
  }
  const materializationWarning = nullableText(
    result.materializationWarning
  );
  if (materializationWarning) {
    mapped.materialization_warning = materializationWarning;
  }
  return mapped;
}

module.exports = {
  DISPLAY_FALLBACKS,
  displayScope,
  mapOwnerLearningCandidate,
  mapOwnerLearningCandidates,
};
