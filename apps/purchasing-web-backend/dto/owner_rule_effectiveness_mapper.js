function safeText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.startsWith('file://') ||
    /^[a-zA-Z]:[\\/]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function mapEffectiveness(value = {}) {
  return {
    population: {
      totalEvents: count(value.population?.totalEvents),
      evaluatedRuns: count(value.population?.evaluatedRuns),
      unavailableRuns: count(value.population?.unavailableRuns),
      fallbackRuns: count(value.population?.fallbackRuns),
    },
    effects: {
      appliedEffectRuns: count(value.effects?.appliedEffectRuns),
      matchedNoChangeRuns: count(value.effects?.matchedNoChangeRuns),
      noMatchRuns: count(value.effects?.noMatchRuns),
      effectRate: safeNumber(value.effects?.effectRate),
      matchRate: safeNumber(value.effects?.matchRate),
    },
    impact: {
      totalAffectedRows: count(value.impact?.totalAffectedRows),
      totalDecisionChanges: count(value.impact?.totalDecisionChanges),
      totalQuantityChanges: count(value.impact?.totalQuantityChanges),
      totalQuantityDelta:
        safeNumber(value.impact?.totalQuantityDelta),
      averageQuantityDelta:
        safeNumber(value.impact?.averageQuantityDelta),
      totalOrderAmountDelta:
        safeNumber(value.impact?.totalOrderAmountDelta),
      averageOrderAmountDelta:
        safeNumber(value.impact?.averageOrderAmountDelta),
      positiveAmountDeltaRuns:
        count(value.impact?.positiveAmountDeltaRuns),
      negativeAmountDeltaRuns:
        count(value.impact?.negativeAmountDeltaRuns),
      zeroAmountDeltaRuns:
        count(value.impact?.zeroAmountDeltaRuns),
    },
    activity: {
      firstEvaluatedAt:
        safeText(value.activity?.firstEvaluatedAt),
      lastEvaluatedAt:
        safeText(value.activity?.lastEvaluatedAt),
      lastAppliedAt: safeText(value.activity?.lastAppliedAt),
      daysSinceLastApplied:
        safeNumber(value.activity?.daysSinceLastApplied),
      consecutiveNoEffectRuns:
        count(value.activity?.consecutiveNoEffectRuns),
    },
    quality: {
      duplicateEvents: count(value.quality?.duplicateEvents),
      invalidEvents: count(value.quality?.invalidEvents),
      missingImpactValues:
        count(value.quality?.missingImpactValues),
      warnings: Array.isArray(value.quality?.warnings)
        ? value.quality.warnings.map(safeText).filter(Boolean)
        : [],
    },
    classification: safeText(value.classification),
    explanationCodes: Array.isArray(value.explanationCodes)
      ? value.explanationCodes.map(safeText).filter(Boolean)
      : [],
  };
}

function mapRule(rule = {}) {
  return {
    ruleId: safeText(rule.ruleId),
    displayScope: {
      primary:
        safeText(rule.displayScope?.primary) || 'Товар без названия',
      secondary: safeText(rule.displayScope?.secondary) || '—',
    },
    status: safeText(rule.status),
    decision: safeText(rule.decision),
    confidence: {
      score: safeNumber(rule.confidence?.score),
      level: safeText(rule.confidence?.level),
    },
    priority: {
      score: safeNumber(rule.priority?.score),
      level: safeText(rule.priority?.level),
    },
    effectiveness: mapEffectiveness(rule.effectiveness),
    safety: {
      observationalOnly:
        rule.safety?.observationalOnly === true,
      changesRuleStatus:
        rule.safety?.changesRuleStatus === true,
      message: safeText(rule.safety?.message),
    },
  };
}

function mapSummary(value = {}) {
  return {
    totalRules: count(value.totalRules),
    appliedRules: count(value.appliedRules),
    noEffectRules: count(value.noEffectRules),
    staleRules: count(value.staleRules),
    reviewRecommendedRules:
      count(value.reviewRecommendedRules),
    totalOrderAmountDelta:
      safeNumber(value.totalOrderAmountDelta) ?? 0,
  };
}

function mapList(result = {}) {
  const available = result.status === 'AVAILABLE';
  return {
    status: available ? 'AVAILABLE' : 'UNAVAILABLE',
    generated_at: available ? safeText(result.generatedAt) : null,
    summary: available ? mapSummary(result.summary) : null,
    rules: available && Array.isArray(result.rules)
      ? result.rules.map(mapRule)
      : [],
    warning: safeText(result.warning),
  };
}

function mapDetail(result = {}) {
  const available = result.status === 'AVAILABLE';
  return {
    status: available ? 'AVAILABLE' : 'UNAVAILABLE',
    rule: available ? mapRule(result.rule) : null,
    effectiveness: available
      ? mapEffectiveness(result.effectiveness)
      : null,
    warning: safeText(result.warning),
  };
}

function shortRunId(value) {
  const normalized = safeText(value);
  if (!normalized) return null;
  return normalized.length > 12
    ? `${normalized.slice(0, 8)}…`
    : normalized;
}

function mapEvent(event = {}) {
  return {
    recordedAt: safeText(event.recordedAt),
    runId: shortRunId(event.runId),
    evaluationStatus: safeText(event.evaluationStatus),
    effectStatus: safeText(event.effectStatus),
    decision: safeText(event.decision),
    scopeSnapshot: {
      displayPrimary:
        safeText(event.scopeSnapshot?.displayPrimary),
      displaySecondary:
        safeText(event.scopeSnapshot?.displaySecondary),
    },
    impact: {
      affectedRows: count(event.impact?.affectedRows),
      decisionChanges: count(event.impact?.decisionChanges),
      quantityChanges: count(event.impact?.quantityChanges),
      quantityDelta: safeNumber(event.impact?.quantityDelta),
      orderAmountDelta:
        safeNumber(event.impact?.orderAmountDelta),
      financialStatusBefore:
        safeText(event.impact?.financialStatusBefore),
      financialStatusAfter:
        safeText(event.impact?.financialStatusAfter),
      financiallyPermitted:
        typeof event.impact?.financiallyPermitted === 'boolean'
          ? event.impact.financiallyPermitted
          : null,
    },
    fallback: {
      occurred: event.fallback?.occurred === true,
      reasonCode: safeText(event.fallback?.reasonCode),
    },
  };
}

function mapEvents(result = {}) {
  const available = result.status === 'AVAILABLE';
  return {
    status: available ? 'AVAILABLE' : 'UNAVAILABLE',
    generated_at: available ? safeText(result.generatedAt) : null,
    events: available && Array.isArray(result.events)
      ? result.events.map(mapEvent)
      : [],
    warning: safeText(result.warning),
  };
}

module.exports = {
  mapDetail,
  mapEffectiveness,
  mapEvent,
  mapEvents,
  mapList,
  mapRule,
  mapSummary,
};
