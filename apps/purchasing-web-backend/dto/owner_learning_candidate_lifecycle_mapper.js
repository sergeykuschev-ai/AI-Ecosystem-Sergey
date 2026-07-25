function nullableText(value) {
  return typeof value === 'string' ? value : null;
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function mapLastEvent(event, { includeComment = false } = {}) {
  if (!event) return null;
  const mapped = {
    recorded_at: nullableText(event.recordedAt),
    action: nullableText(event.action),
    reason_code: nullableText(event.reasonCode),
  };
  if (includeComment) {
    mapped.owner_comment = nullableText(event.ownerComment);
  }
  return mapped;
}

function mapLifecycleState(state = {}, options = {}) {
  return {
    candidate_id: nullableText(state.candidateId),
    status: nullableText(state.status) || 'NEW',
    last_event: mapLastEvent(state.lastEvent, options),
  };
}

function mapLifecycleSummary(summary = {}) {
  const mapCounts = (source, keys) => Object.fromEntries(
    keys.map(key => [key, count(source?.[key])])
  );
  return {
    totalEvents: count(summary.totalEvents),
    uniqueCandidates: count(summary.uniqueCandidates),
    currentStates: mapCounts(summary.currentStates, [
      'NEW',
      'UNDER_REVIEW',
      'APPROVED',
      'REJECTED',
      'POSTPONED',
    ]),
    actionsByType: mapCounts(summary.actionsByType, [
      'START_REVIEW',
      'APPROVE',
      'REJECT',
      'POSTPONE',
      'REOPEN',
    ]),
    reasonsByType: mapCounts(summary.reasonsByType, [
      'READY_FOR_RULE',
      'NEEDS_MORE_HISTORY',
      'INSUFFICIENT_EVIDENCE',
      'TOO_BROAD',
      'CONTRADICTORY_HISTORY',
      'NOT_RELEVANT',
      'OWNER_EXPERIENCE',
      'OTHER',
      'NOT_SPECIFIED',
    ]),
    firstRecordedAt: nullableText(summary.firstRecordedAt),
    lastRecordedAt: nullableText(summary.lastRecordedAt),
  };
}

function mapLifecycleList(result = {}) {
  return {
    summary: mapLifecycleSummary(result.summary),
    states: Array.isArray(result.states)
      ? result.states.map(state => mapLifecycleState(state))
      : [],
  };
}

module.exports = {
  mapLastEvent,
  mapLifecycleList,
  mapLifecycleState,
  mapLifecycleSummary,
};
