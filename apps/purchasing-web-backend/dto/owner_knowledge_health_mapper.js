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

function mapScope(value = {}) {
  return {
    primary: safeText(value.primary),
    secondary: safeText(value.secondary),
  };
}

function mapEvidence(value = {}) {
  const mapped = {};
  for (const name of [
    'activeRuleCount',
    'count',
    'daysSinceLastApplied',
    'daysSinceUpdated',
    'evaluatedRuns',
    'appliedEffectRuns',
    'totalEvents',
  ]) {
    const number = safeNumber(value[name]);
    if (number !== null) mapped[toSnake(name)] = number;
  }
  for (const name of [
    'duplicateType',
    'confidenceLevel',
    'priorityLevel',
    'lifecycleStatus',
    'status',
    'eventStatus',
    'effectivenessClassification',
    'ruleType',
    'scopeType',
  ]) {
    const text = safeText(value[name]);
    if (text) mapped[toSnake(name)] = text;
  }
  for (const name of [
    'supportedStatus',
    'supportedDecision',
    'validUpdatedAt',
    'displayScopeAvailable',
  ]) {
    if (typeof value[name] === 'boolean') {
      mapped[toSnake(name)] = value[name];
    }
  }
  for (const name of ['decisions', 'statuses']) {
    if (Array.isArray(value[name])) {
      mapped[name] = value[name].map(safeText).filter(Boolean);
    }
  }
  return mapped;
}

function toSnake(value) {
  return value.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

function mapFinding(value = {}) {
  return {
    finding_id: safeText(value.findingId),
    type: safeText(value.type),
    severity: safeText(value.severity),
    rule_ids: Array.isArray(value.ruleIds)
      ? value.ruleIds.map(safeText).filter(Boolean)
      : [],
    display_scopes: Array.isArray(value.displayScopes)
      ? value.displayScopes.map(mapScope)
      : [],
    title_code: safeText(value.titleCode),
    description_code: safeText(value.descriptionCode),
    evidence: mapEvidence(value.evidence),
    recommended_review_action:
      safeText(value.recommendedReviewAction),
    navigation_target: safeText(value.navigationTarget),
    explanation_codes: Array.isArray(value.explanationCodes)
      ? value.explanationCodes.map(safeText).filter(Boolean)
      : [],
  };
}

function mapSignals(value = {}) {
  return {
    has_conflict: value.hasConflict === true,
    has_duplicate: value.hasDuplicate === true,
    is_stale: value.isStale === true,
    has_effectiveness_data: value.hasEffectivenessData === true,
    effectiveness_classification:
      safeText(value.effectivenessClassification),
    confidence_level: safeText(value.confidenceLevel),
    priority_level: safeText(value.priorityLevel),
    lifecycle_status: safeText(value.lifecycleStatus),
    provenance_available: value.provenanceAvailable === true,
    materialization_available:
      value.materializationAvailable === true,
    status_history_available: value.statusHistoryAvailable === true,
  };
}

function mapRule(value = {}) {
  return {
    rule_id: safeText(value.ruleId),
    status: safeText(value.status),
    decision: safeText(value.decision),
    display_scope: mapScope(value.displayScope),
    score: safeNumber(value.score),
    grade: safeText(value.grade),
    classification: safeText(value.classification),
    updated_at: safeText(value.updatedAt),
    last_applied_at: safeText(value.lastAppliedAt),
    signals: mapSignals(value.signals),
    findings: Array.isArray(value.findings)
      ? value.findings.map(mapFinding)
      : [],
    explanation_codes: Array.isArray(value.explanationCodes)
      ? value.explanationCodes.map(safeText).filter(Boolean)
      : [],
  };
}

function mapSummary(value) {
  if (!value) return null;
  return {
    total_rules: count(value.totalRules),
    active_rules: count(value.activeRules),
    disabled_rules: count(value.disabledRules),
    healthy_rules: count(value.healthyRules),
    attention_rules: count(value.attentionRules),
    critical_rules: count(value.criticalRules),
    duplicate_groups: count(value.duplicateGroups),
    conflict_groups: count(value.conflictGroups),
    stale_rules: count(value.staleRules),
    no_effect_rules: count(value.noEffectRules),
    inconsistent_rules: count(value.inconsistentRules),
  };
}

function mapDimension(value = {}) {
  return {
    score: safeNumber(value.score),
    weight: safeNumber(value.weight),
    findings_count: count(value.findingsCount),
    critical_findings: count(value.criticalFindings),
    explanation_codes: Array.isArray(value.explanationCodes)
      ? value.explanationCodes.map(safeText).filter(Boolean)
      : [],
  };
}

function mapDimensions(value) {
  if (!value) return null;
  return {
    consistency: mapDimension(value.consistency),
    effectiveness: mapDimension(value.effectiveness),
    freshness: mapDimension(value.freshness),
    data_quality: mapDimension(value.dataQuality),
    safety: mapDimension(value.safety),
    maintainability: mapDimension(value.maintainability),
  };
}

function mapDataQuality(value) {
  if (!value) return null;
  return {
    invalid_rules: count(value.invalidRules),
    rules_missing_provenance: count(value.rulesMissingProvenance),
    rules_missing_materialization:
      count(value.rulesMissingMaterialization),
    invalid_rule_timestamps: count(value.invalidRuleTimestamps),
    missing_display_scope: count(value.missingDisplayScope),
    missing_confidence: count(value.missingConfidence),
    missing_priority: count(value.missingPriority),
    duplicate_rule_ids: Array.isArray(value.duplicateRuleIds)
      ? value.duplicateRuleIds.map(safeText).filter(Boolean)
      : [],
    orphan_materializations: count(value.orphanMaterializations),
    orphan_lifecycle_states: count(value.orphanLifecycleStates),
    orphan_status_events: count(value.orphanStatusEvents),
    orphan_effectiveness_summaries:
      count(value.orphanEffectivenessSummaries),
    warnings: Array.isArray(value.warnings)
      ? value.warnings.map(safeText).filter(Boolean)
      : [],
  };
}

function normalizedStatus(value) {
  return ['AVAILABLE', 'PARTIAL', 'UNAVAILABLE'].includes(value)
    ? value
    : 'UNAVAILABLE';
}

function mapKnowledgeHealth(result = {}) {
  const status = normalizedStatus(result.status);
  return {
    status,
    generated_at:
      status === 'UNAVAILABLE' ? null : safeText(result.generatedAt),
    score: status === 'UNAVAILABLE' ? null : safeNumber(result.score),
    grade: status === 'UNAVAILABLE' ? null : safeText(result.grade),
    summary: status === 'UNAVAILABLE'
      ? null
      : mapSummary(result.summary),
    dimensions: status === 'UNAVAILABLE'
      ? null
      : mapDimensions(result.dimensions),
    findings: Array.isArray(result.findings)
      ? result.findings.map(mapFinding)
      : [],
    rules: Array.isArray(result.rules)
      ? result.rules.map(mapRule)
      : [],
    data_quality: status === 'UNAVAILABLE'
      ? null
      : mapDataQuality(result.dataQuality),
    explanation_codes: Array.isArray(result.explanationCodes)
      ? result.explanationCodes.map(safeText).filter(Boolean)
      : [],
    warnings: Array.isArray(result.warnings)
      ? result.warnings.map(safeText).filter(Boolean)
      : [],
  };
}

function mapRuleHealth(result = {}) {
  return {
    status: normalizedStatus(result.status),
    generated_at: safeText(result.generatedAt),
    rule: result.rule ? mapRule(result.rule) : null,
    warnings: Array.isArray(result.warnings)
      ? result.warnings.map(safeText).filter(Boolean)
      : [],
  };
}

function mapFindings(result = {}) {
  return {
    status: normalizedStatus(result.status),
    generated_at: safeText(result.generatedAt),
    findings: Array.isArray(result.findings)
      ? result.findings.map(mapFinding)
      : [],
    warnings: Array.isArray(result.warnings)
      ? result.warnings.map(safeText).filter(Boolean)
      : [],
  };
}

module.exports = {
  mapDataQuality,
  mapDimensions,
  mapFinding,
  mapFindings,
  mapKnowledgeHealth,
  mapRule,
  mapRuleHealth,
  mapSummary,
};
