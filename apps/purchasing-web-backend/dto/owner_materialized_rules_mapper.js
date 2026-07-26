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

function mapMaterializedRule(rule = {}) {
  return {
    ruleId: safeText(rule.ruleId),
    status: safeText(rule.status),
    ruleType: safeText(rule.ruleType),
    displayScope: {
      primary:
        safeText(rule.displayScope?.primary) || 'Товар без названия',
      secondary: safeText(rule.displayScope?.secondary) || '—',
    },
    action: {
      decision: safeText(rule.action?.decision),
      quantityStrategy:
        safeText(rule.action?.quantityStrategy),
      quantityValue: safeNumber(rule.action?.quantityValue),
    },
    source: {
      type: safeText(rule.source?.type),
      label: safeText(rule.source?.label),
    },
    provenance: {
      candidateId: safeText(rule.provenance?.candidateId),
      patternType: safeText(rule.provenance?.patternType),
      confidenceScore:
        safeNumber(rule.provenance?.confidenceScore),
      confidenceLevel:
        safeText(rule.provenance?.confidenceLevel),
      priorityScore:
        safeNumber(rule.provenance?.priorityScore),
      priorityLevel:
        safeText(rule.provenance?.priorityLevel),
      eligibilityStatus:
        safeText(rule.provenance?.eligibilityStatus),
      materializedAt:
        safeText(rule.provenance?.materializedAt),
      materializationVersion:
        safeText(rule.provenance?.materializationVersion),
    },
    lifecycle: {
      status: safeText(rule.lifecycle?.status),
      lastAction: safeText(rule.lifecycle?.lastAction),
      lastRecordedAt:
        safeText(rule.lifecycle?.lastRecordedAt),
      reasonCode: safeText(rule.lifecycle?.reasonCode),
    },
    candidateAvailability: {
      status:
        safeText(rule.candidateAvailability?.status) ||
        'UNAVAILABLE',
    },
    timestamps: {
      createdAt: safeText(rule.timestamps?.createdAt),
      updatedAt: safeText(rule.timestamps?.updatedAt),
    },
    safety: {
      affectsPurchasing:
        rule.safety?.affectsPurchasing === true,
      message: safeText(rule.safety?.message),
    },
    management: {
      manageable: rule.management?.manageable === true,
      availableActions: Array.isArray(
        rule.management?.availableActions
      ) ? rule.management.availableActions
        .filter(action => ['ACTIVATE', 'DEACTIVATE'].includes(action))
        .slice(0, 1) : [],
      lastStatusChangeAt:
        safeText(rule.management?.lastStatusChangeAt),
      lastStatusAction:
        safeText(rule.management?.lastStatusAction),
      previewRequired: true,
    },
    effectiveness: {
      status: ['AVAILABLE', 'UNAVAILABLE', 'NO_DATA'].includes(
        rule.effectiveness?.status
      ) ? rule.effectiveness.status : 'UNAVAILABLE',
      classification:
        safeText(rule.effectiveness?.classification),
      evaluatedRuns:
        count(rule.effectiveness?.evaluatedRuns),
      appliedEffectRuns:
        count(rule.effectiveness?.appliedEffectRuns),
      effectRate: safeNumber(rule.effectiveness?.effectRate),
      totalOrderAmountDelta:
        safeNumber(rule.effectiveness?.totalOrderAmountDelta),
      lastAppliedAt:
        safeText(rule.effectiveness?.lastAppliedAt),
      daysSinceLastApplied:
        safeNumber(rule.effectiveness?.daysSinceLastApplied),
    },
  };
}

function mapSummary(summary = {}) {
  return {
    totalRules: count(summary.totalRules),
    activeRules: count(summary.activeRules),
    disabledRules: count(summary.disabledRules),
    buyRules: count(summary.buyRules),
    skipRules: count(summary.skipRules),
    deferRules: count(summary.deferRules),
    currentCandidateAvailable:
      count(summary.currentCandidateAvailable),
    currentCandidateUnavailable:
      count(summary.currentCandidateUnavailable),
  };
}

function mapOwnerMaterializedRules(result = {}) {
  const available = result.status === 'AVAILABLE';
  return {
    status: available ? 'AVAILABLE' : 'UNAVAILABLE',
    generated_at: available ? safeText(result.generatedAt) : null,
    summary: available ? mapSummary(result.summary) : null,
    rules: available && Array.isArray(result.rules)
      ? result.rules.map(mapMaterializedRule)
      : [],
    warning: safeText(result.warning),
  };
}

function mapOwnerMaterializedRuleDetail(result = {}) {
  const available = result.status === 'AVAILABLE';
  return {
    status: available ? 'AVAILABLE' : 'UNAVAILABLE',
    generated_at: available ? safeText(result.generatedAt) : null,
    rule: available ? mapMaterializedRule(result.rule) : null,
    warning: safeText(result.warning),
  };
}

module.exports = {
  mapMaterializedRule,
  mapOwnerMaterializedRuleDetail,
  mapOwnerMaterializedRules,
  mapSummary,
};
