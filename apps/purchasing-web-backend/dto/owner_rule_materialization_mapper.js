const SAFE_MESSAGE =
  'Правило создано как неактивное и пока не влияет на закупку.';

function text(value) {
  return typeof value === 'string' ? value : null;
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function mapMaterializedRule(rule = {}, candidate = {}) {
  return {
    rule_id: text(rule.ruleId),
    status: text(rule.status),
    rule_type: text(rule.ruleType),
    display_scope: {
      primary: text(candidate.displayScope?.primary) ||
        text(rule.name),
      secondary: text(candidate.displayScope?.secondary),
    },
    decision: text(rule.approvedDecision),
    quantity_strategy: text(rule.action?.quantityStrategy),
    created_at: text(rule.createdAt) || text(rule.approvedAt),
  };
}

function mapMaterializationResult(result = {}) {
  return {
    status: text(result.status),
    candidate_id: text(result.candidate?.candidateId),
    rule: mapMaterializedRule(result.rule, result.candidate),
    message: SAFE_MESSAGE,
  };
}

function mapMaterializationEvent(event = {}) {
  if (!event) return null;
  return {
    status: 'MATERIALIZED',
    candidate_id: text(event.candidateId),
    rule: {
      rule_id: text(event.ruleId),
      status: text(event.ruleStatus),
      rule_type: text(event.snapshot?.proposedRuleType),
      decision: text(event.snapshot?.proposedDecision),
      created_at: text(event.recordedAt),
    },
    message: SAFE_MESSAGE,
  };
}

function mapMaterializationList(result = {}) {
  return {
    summary: {
      total: count(result.summary?.totalEvents),
      created: count(result.summary?.created),
      repaired: count(result.summary?.repaired),
      disabled_rules: count(result.summary?.disabledRules),
      first_recorded_at: text(result.summary?.firstRecordedAt),
      last_recorded_at: text(result.summary?.lastRecordedAt),
    },
    materializations: Array.isArray(result.materializations)
      ? result.materializations.map(mapMaterializationEvent)
      : [],
  };
}

module.exports = {
  SAFE_MESSAGE,
  mapMaterializationEvent,
  mapMaterializationList,
  mapMaterializationResult,
  mapMaterializedRule,
};
