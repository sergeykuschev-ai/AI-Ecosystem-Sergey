const {
  normalizeAgentRecommendation,
  normalizeOwnerDecision,
} = require('./owner_learning_report');

const ENGINE_VERSION = 'rule-application-engine-v0.6.1';
const APPLICATION_STATUS = Object.freeze({
  UNCHANGED: 'UNCHANGED',
  APPLIED: 'APPLIED',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  BLOCKED_CONFLICT: 'BLOCKED_CONFLICT',
  BLOCKED_INVALID_RULE: 'BLOCKED_INVALID_RULE',
  BLOCKED_UNKNOWN_RECOMMENDATION: 'BLOCKED_UNKNOWN_RECOMMENDATION',
  BLOCKED_INVALID_QUANTITY: 'BLOCKED_INVALID_QUANTITY',
});

function optionalString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function normalizedAgentState(value) {
  return normalizeAgentRecommendation(value) || 'UNKNOWN';
}

function quantityState(value) {
  if (value === null || value === undefined) {
    return { valid: true, value: null };
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return { valid: false, value: null };
  }
  return { valid: true, value };
}

function isConflict(previewMatch) {
  if (!previewMatch || typeof previewMatch !== 'object') return false;
  if (
    previewMatch.conflict === true ||
    previewMatch.reason === 'CONFLICTING_ACTIVE_RULES'
  ) {
    return true;
  }
  if (!Array.isArray(previewMatch.approvedDecisions)) return false;
  const decisions = new Set(
    previewMatch.approvedDecisions
      .map(normalizeOwnerDecision)
      .filter(Boolean)
  );
  return decisions.size > 1;
}

function normalizedRuleStatus(previewMatch) {
  const status = optionalString(previewMatch?.status);
  return status ? status.toUpperCase() : null;
}

function ruleIdentity(previewMatch) {
  return {
    ruleId: optionalString(previewMatch?.ruleId),
    stableItemKey: optionalString(previewMatch?.stableItemKey),
  };
}

function conflictRuleIds(previewMatch) {
  if (!Array.isArray(previewMatch?.ruleIds)) return [];
  return previewMatch.ruleIds
    .map(optionalString)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function resultFor({
  agentRecommendation,
  agentQuantity,
  finalRecommendation = agentRecommendation,
  finalQuantity = agentQuantity,
  applicationStatus,
  ruleApplied = false,
  ruleId = null,
  stableItemKey = null,
  reason,
  matchedActiveRule = false,
  quantityInputValid = true,
  conflictIds = [],
}) {
  return {
    agentRecommendation,
    agentQuantity,
    finalRecommendation,
    finalQuantity,
    applicationStatus,
    ruleApplied,
    ruleId,
    stableItemKey,
    reason,
    diagnostics: {
      engineVersion: ENGINE_VERSION,
      matchedActiveRule,
      quantityInputValid,
      positiveQuantityCreated: false,
      conflictRuleIds: [...conflictIds],
    },
  };
}

function applyApprovedRule({
  agentRecommendation,
  agentQuantity,
  previewMatch,
} = {}) {
  const normalizedAgent = normalizedAgentState(agentRecommendation);
  const quantity = quantityState(agentQuantity);
  const identity = ruleIdentity(previewMatch);

  if (isConflict(previewMatch)) {
    return resultFor({
      agentRecommendation: normalizedAgent,
      agentQuantity: quantity.value,
      applicationStatus: APPLICATION_STATUS.BLOCKED_CONFLICT,
      ruleId: identity.ruleId,
      stableItemKey: identity.stableItemKey,
      reason: 'CONFLICTING_ACTIVE_RULES',
      quantityInputValid: quantity.valid,
      conflictIds: conflictRuleIds(previewMatch),
    });
  }

  if (!quantity.valid) {
    return resultFor({
      agentRecommendation: normalizedAgent,
      agentQuantity: null,
      finalQuantity: null,
      applicationStatus: APPLICATION_STATUS.BLOCKED_INVALID_QUANTITY,
      ruleId: identity.ruleId,
      stableItemKey: identity.stableItemKey,
      reason: 'INVALID_AGENT_QUANTITY',
      quantityInputValid: false,
    });
  }

  if (previewMatch === null || previewMatch === undefined) {
    return resultFor({
      agentRecommendation: normalizedAgent,
      agentQuantity: quantity.value,
      applicationStatus: APPLICATION_STATUS.UNCHANGED,
      reason: 'NO_ACTIVE_RULE',
    });
  }

  if (typeof previewMatch !== 'object' || Array.isArray(previewMatch)) {
    return resultFor({
      agentRecommendation: normalizedAgent,
      agentQuantity: quantity.value,
      applicationStatus: APPLICATION_STATUS.BLOCKED_INVALID_RULE,
      reason: 'INVALID_PREVIEW_MATCH',
    });
  }

  const ruleStatus = normalizedRuleStatus(previewMatch);
  if (ruleStatus && ruleStatus !== 'ACTIVE') {
    return resultFor({
      agentRecommendation: normalizedAgent,
      agentQuantity: quantity.value,
      applicationStatus: APPLICATION_STATUS.UNCHANGED,
      ruleId: identity.ruleId,
      stableItemKey: identity.stableItemKey,
      reason: 'RULE_NOT_ACTIVE',
    });
  }

  if (!identity.ruleId || !identity.stableItemKey) {
    return resultFor({
      agentRecommendation: normalizedAgent,
      agentQuantity: quantity.value,
      applicationStatus: APPLICATION_STATUS.BLOCKED_INVALID_RULE,
      ruleId: identity.ruleId,
      stableItemKey: identity.stableItemKey,
      reason: identity.ruleId
        ? 'MISSING_STABLE_ITEM_KEY'
        : 'MISSING_RULE_ID',
    });
  }

  const approvedDecision = normalizeOwnerDecision(
    previewMatch.approvedDecision
  );
  if (!approvedDecision) {
    return resultFor({
      agentRecommendation: normalizedAgent,
      agentQuantity: quantity.value,
      applicationStatus: APPLICATION_STATUS.BLOCKED_INVALID_RULE,
      ruleId: identity.ruleId,
      stableItemKey: identity.stableItemKey,
      reason: 'INVALID_RULE_RECOMMENDATION',
      matchedActiveRule: true,
    });
  }

  if (normalizedAgent === 'UNKNOWN') {
    return resultFor({
      agentRecommendation: normalizedAgent,
      agentQuantity: quantity.value,
      applicationStatus:
        APPLICATION_STATUS.BLOCKED_UNKNOWN_RECOMMENDATION,
      ruleId: identity.ruleId,
      stableItemKey: identity.stableItemKey,
      reason: 'UNKNOWN_AGENT_RECOMMENDATION',
      matchedActiveRule: true,
    });
  }

  if (normalizedAgent === approvedDecision) {
    return resultFor({
      agentRecommendation: normalizedAgent,
      agentQuantity: quantity.value,
      applicationStatus: APPLICATION_STATUS.UNCHANGED,
      ruleId: identity.ruleId,
      stableItemKey: identity.stableItemKey,
      reason: 'APPROVED_RULE_MATCHES_AGENT_RECOMMENDATION',
      matchedActiveRule: true,
    });
  }

  if (approvedDecision === 'BUY') {
    return resultFor({
      agentRecommendation: normalizedAgent,
      agentQuantity: quantity.value,
      applicationStatus: APPLICATION_STATUS.MANUAL_REVIEW,
      ruleId: identity.ruleId,
      stableItemKey: identity.stableItemKey,
      reason: 'POSITIVE_QUANTITY_REQUIRES_MANUAL_REVIEW',
      matchedActiveRule: true,
    });
  }

  return resultFor({
    agentRecommendation: normalizedAgent,
    agentQuantity: quantity.value,
    finalRecommendation: approvedDecision,
    finalQuantity: 0,
    applicationStatus: APPLICATION_STATUS.APPLIED,
    ruleApplied: true,
    ruleId: identity.ruleId,
    stableItemKey: identity.stableItemKey,
    reason: 'APPROVED_RULE_APPLIED_WITH_ZERO_QUANTITY',
    matchedActiveRule: true,
  });
}

module.exports = {
  APPLICATION_STATUS,
  ENGINE_VERSION,
  applyApprovedRule,
};
