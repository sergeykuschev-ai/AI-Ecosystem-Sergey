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
    primary: safeText(value.primary) || 'Объект без названия',
    secondary: safeText(value.secondary),
  };
}

function mapDecisions(value) {
  if (!value) return null;
  return {
    total: count(value.total),
    unique_items: count(value.uniqueItems),
    agreement_rate: safeNumber(value.agreementRate),
  };
}

function mapCandidates(value) {
  if (!value) return null;
  return {
    total: count(value.total),
    eligible: count(value.eligible),
    review_only: count(value.reviewOnly),
    ineligible: count(value.ineligible),
    approved: count(value.approved),
    postponed: count(value.postponed),
    rejected: count(value.rejected),
  };
}

function mapRules(value) {
  if (!value) return null;
  return {
    total: count(value.total),
    active: count(value.active),
    disabled: count(value.disabled),
    buy: count(value.buy),
    skip: count(value.skip),
    defer: count(value.defer),
  };
}

function mapEffectiveness(value) {
  if (!value) return null;
  return {
    with_data: count(value.withData),
    effective: count(value.effective),
    occasional: count(value.occasional),
    no_effect_yet: count(value.noEffectYet),
    stale: count(value.stale),
    review_recommended: count(value.reviewRecommended),
    insufficient_data: count(value.insufficientData),
    total_order_amount_delta:
      safeNumber(value.totalOrderAmountDelta) ?? 0,
  };
}

function mapSummary(value) {
  if (!value) return null;
  return {
    decisions: mapDecisions(value.decisions),
    candidates: mapCandidates(value.candidates),
    rules: mapRules(value.rules),
    effectiveness: mapEffectiveness(value.effectiveness),
    knowledge_health: value.knowledgeHealth
      ? {
        score: safeNumber(value.knowledgeHealth.score),
        grade: safeText(value.knowledgeHealth.grade),
        critical_findings:
          count(value.knowledgeHealth.criticalFindings),
        attention_findings:
          count(value.knowledgeHealth.attentionFindings),
        conflict_groups: count(value.knowledgeHealth.conflictGroups),
        duplicate_groups: count(value.knowledgeHealth.duplicateGroups),
        stale_rules: count(value.knowledgeHealth.staleRules),
      }
      : null,
  };
}

function mapAttentionItem(value = {}) {
  return {
    attention_id: safeText(value.attentionId),
    type: safeText(value.type),
    priority: safeText(value.priority),
    title: safeText(value.title),
    description: safeText(value.description),
    display_scope: mapScope(value.displayScope),
    entity_type: safeText(value.entityType),
    entity_id: safeText(value.entityId),
    navigation_target: safeText(value.navigationTarget),
    created_at: safeText(value.createdAt),
    explanation_codes: Array.isArray(value.explanationCodes)
      ? value.explanationCodes.map(safeText).filter(Boolean)
      : [],
  };
}

function mapAttention(value = {}) {
  return {
    total: count(value.total),
    items: Array.isArray(value.items)
      ? value.items.map(mapAttentionItem)
      : [],
  };
}

function mapActivity(value = {}) {
  return {
    activity_type: safeText(value.activityType),
    recorded_at: safeText(value.recordedAt),
    display_scope: mapScope(value.displayScope),
    description: safeText(value.description),
    status: safeText(value.status),
    decision: safeText(value.decision),
    amount_delta: safeNumber(value.amountDelta),
    quantity_delta: safeNumber(value.quantityDelta),
    navigation_target: safeText(value.navigationTarget),
  };
}

function mapComponent(value = {}) {
  return {
    status: safeText(value.status) || 'UNAVAILABLE',
    warning: safeText(value.warning),
  };
}

function mapHealth(value = {}) {
  const components = value.components || {};
  return {
    overall_status: safeText(value.overallStatus) || 'UNAVAILABLE',
    components: {
      decision_history: mapComponent(components.decisionHistory),
      candidates: mapComponent(components.candidates),
      candidate_lifecycle: mapComponent(components.candidateLifecycle),
      materializations: mapComponent(components.materializations),
      approved_rules_registry:
        mapComponent(components.approvedRulesRegistry),
      rule_status_events: mapComponent(components.ruleStatusEvents),
      rule_activation_previews:
        mapComponent(components.ruleActivationPreviews),
      rule_effectiveness: mapComponent(components.ruleEffectiveness),
      knowledge_health: mapComponent(components.knowledgeHealth),
    },
    data_quality_warnings:
      Array.isArray(value.dataQualityWarnings)
        ? value.dataQualityWarnings.map(safeText).filter(Boolean)
        : [],
    last_knowledge_change_at: safeText(value.lastKnowledgeChangeAt),
    last_rule_status_change_at:
      safeText(value.lastRuleStatusChangeAt),
    last_rule_effect_at: safeText(value.lastRuleEffectAt),
  };
}

function mapSection(value = {}, options = {}) {
  const mapped = {
    status: safeText(value.status) || 'UNAVAILABLE',
    count: count(value.count),
    navigation_target: safeText(value.navigationTarget),
  };
  if (options.attention) {
    mapped.attention_count = count(value.attentionCount);
  }
  if (options.active) {
    mapped.active_count = count(value.activeCount);
  }
  return mapped;
}

function mapSections(value = {}) {
  return {
    decision_history: mapSection(value.decisionHistory),
    candidates: mapSection(value.candidates, { attention: true }),
    materialized_rules: mapSection(
      value.materializedRules,
      { active: true }
    ),
    effectiveness: mapSection(
      value.effectiveness,
      { attention: true }
    ),
    knowledge_health: {
      ...mapSection(value.knowledgeHealth, { attention: true }),
      score: safeNumber(value.knowledgeHealth?.score),
      grade: safeText(value.knowledgeHealth?.grade),
    },
  };
}

function mapOwnerLearningCenter(result = {}) {
  const status = ['AVAILABLE', 'PARTIAL', 'UNAVAILABLE'].includes(
    result.status
  )
    ? result.status
    : 'UNAVAILABLE';
  return {
    status,
    generated_at:
      status === 'UNAVAILABLE' ? null : safeText(result.generatedAt),
    summary:
      status === 'UNAVAILABLE' ? null : mapSummary(result.summary),
    attention: mapAttention(result.attention),
    recent_activity: Array.isArray(result.recentActivity)
      ? result.recentActivity.map(mapActivity)
      : [],
    system_health: mapHealth(result.systemHealth),
    sections: mapSections(result.sections),
    warnings: Array.isArray(result.warnings)
      ? result.warnings.map(safeText).filter(Boolean)
      : [],
  };
}

module.exports = {
  mapActivity,
  mapAttention,
  mapHealth,
  mapOwnerLearningCenter,
  mapSections,
  mapSummary,
};
