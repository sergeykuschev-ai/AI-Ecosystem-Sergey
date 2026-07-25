const crypto = require('node:crypto');

const {
  buildRuleId,
} = require('./owner_rule_registry');

const MATERIALIZATION_SCHEMA_VERSION =
  'owner-rule-materialization-v0.9.0';
const MATERIALIZATION_VERSION = 'v0.9.0';
const SAFE_RULE_STATUS = 'DISABLED';
const SUPPORTED_DECISIONS = Object.freeze([
  'BUY',
  'SKIP',
  'DEFER',
]);

class OwnerRuleMaterializationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerRuleMaterializationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new OwnerRuleMaterializationError(code, message);
}

function text(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(
      'OWNER_RULE_MATERIALIZATION_INVALID_INPUT',
      `${fieldName} обязателен.`
    );
  }
  return value.trim();
}

function score(value, fieldName) {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    fail(
      'OWNER_RULE_MATERIALIZATION_INVALID_INPUT',
      `${fieldName} должен быть целым числом от 0 до 100.`
    );
  }
  return value;
}

function isoDate(value, fieldName) {
  const normalized = text(value, fieldName);
  if (
    !normalized.endsWith('Z') ||
    !Number.isFinite(Date.parse(normalized))
  ) {
    fail(
      'OWNER_RULE_MATERIALIZATION_INVALID_INPUT',
      `${fieldName} должен быть ISO UTC datetime.`
    );
  }
  return new Date(Date.parse(normalized)).toISOString();
}

function digest(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

function quantityAction(decision) {
  return {
    decision,
    quantityStrategy: decision === 'BUY'
      ? 'KEEP_AGENT_QUANTITY'
      : 'NO_QUANTITY_CHANGE',
    quantityValue: null,
  };
}

function validateCandidateForMaterialization({
  candidate,
  lifecycleState,
} = {}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail(
      'OWNER_RULE_MATERIALIZATION_INVALID_INPUT',
      'Candidate должен быть объектом.'
    );
  }
  if (
    !lifecycleState ||
    typeof lifecycleState !== 'object' ||
    Array.isArray(lifecycleState)
  ) {
    fail(
      'OWNER_RULE_MATERIALIZATION_INVALID_INPUT',
      'Lifecycle state должен быть объектом.'
    );
  }
  const candidateId = text(candidate.candidateId, 'candidateId');
  if (lifecycleState.candidateId !== candidateId) {
    fail(
      'OWNER_RULE_MATERIALIZATION_INVALID_INPUT',
      'Lifecycle state относится к другому кандидату.'
    );
  }
  if (lifecycleState.status !== 'APPROVED') {
    fail(
      'CANDIDATE_NOT_APPROVED',
      'Кандидат не одобрен владельцем.'
    );
  }
  if (candidate.eligibility?.status !== 'ELIGIBLE') {
    fail(
      'CANDIDATE_NOT_ELIGIBLE',
      'Кандидат не соответствует требованиям materialization.'
    );
  }
  if (
    candidate.confidence?.level === 'LOW' ||
    !Number.isInteger(candidate.confidence?.score)
  ) {
    fail(
      'CANDIDATE_NOT_ELIGIBLE',
      'Confidence кандидата недостаточен.'
    );
  }
  if (
    candidate.patternType !== 'SAME_ITEM_SAME_DECISION' ||
    candidate.proposedRuleType !== 'ITEM_DECISION_OVERRIDE' ||
    candidate.scopeType !== 'ITEM'
  ) {
    fail(
      'CANDIDATE_TYPE_NOT_MATERIALIZABLE',
      'Тип кандидата нельзя материализовать в v0.9.0.'
    );
  }
  const decision = text(
    candidate.proposedAction?.decision,
    'proposedAction.decision'
  ).toUpperCase();
  if (!SUPPORTED_DECISIONS.includes(decision)) {
    fail(
      'OWNER_RULE_MATERIALIZATION_INVALID_INPUT',
      'Решение кандидата не поддерживается.'
    );
  }
  const lifecycleEventId = text(
    lifecycleState.lastEvent?.eventId,
    'lifecycleEventId'
  );
  if (lifecycleState.lastEvent?.toStatus !== 'APPROVED') {
    fail(
      'CANDIDATE_NOT_APPROVED',
      'Последнее lifecycle-событие не подтверждает APPROVED.'
    );
  }
  const normalized = {
    candidateId,
    lifecycleEventId,
    patternType: candidate.patternType,
    proposedRuleType: candidate.proposedRuleType,
    scopeType: candidate.scopeType,
    scopeKey: text(candidate.scopeKey, 'scopeKey'),
    displayScope: {
      primary: text(
        candidate.displayScope?.primary,
        'displayScope.primary'
      ),
      secondary:
        typeof candidate.displayScope?.secondary === 'string'
          ? candidate.displayScope.secondary.trim() || null
          : null,
    },
    action: quantityAction(decision),
    confidence: {
      score: score(candidate.confidence.score, 'confidence.score'),
      level: text(candidate.confidence.level, 'confidence.level'),
    },
    ranking: {
      priorityScore: score(
        candidate.ranking?.priorityScore,
        'ranking.priorityScore'
      ),
      priorityLevel: text(
        candidate.ranking?.priorityLevel,
        'ranking.priorityLevel'
      ),
    },
    eligibilityStatus: candidate.eligibility.status,
  };
  return normalized;
}

function createMaterializationFingerprint({ candidate } = {}) {
  if (!candidate || typeof candidate !== 'object') {
    fail(
      'OWNER_RULE_MATERIALIZATION_INVALID_INPUT',
      'Candidate обязателен для fingerprint.'
    );
  }
  return digest([
    candidate.candidateId,
    candidate.patternType,
    candidate.proposedRuleType,
    candidate.scopeType,
    candidate.scopeKey,
    candidate.proposedAction?.decision,
    candidate.proposedAction?.quantityStrategy,
    candidate.proposedAction?.quantityValue,
  ]);
}

function materializeRuleFromCandidate({
  candidate,
  lifecycleState,
  options = {},
} = {}) {
  const normalized = validateCandidateForMaterialization({
    candidate,
    lifecycleState,
  });
  const materializedAt = isoDate(
    options.materializedAt,
    'materializedAt'
  );
  const fingerprint = createMaterializationFingerprint({ candidate });
  const materializationId = digest([
    MATERIALIZATION_SCHEMA_VERSION,
    normalized.candidateId,
    normalized.lifecycleEventId,
    normalized.proposedRuleType,
    normalized.action.decision,
    normalized.action.quantityStrategy,
    normalized.action.quantityValue,
  ]);
  const provenance = {
    source: 'OWNER_LEARNING_CANDIDATE',
    candidateId: normalized.candidateId,
    lifecycleEventId: normalized.lifecycleEventId,
    patternType: normalized.patternType,
    confidenceScore: normalized.confidence.score,
    confidenceLevel: normalized.confidence.level,
    priorityScore: normalized.ranking.priorityScore,
    priorityLevel: normalized.ranking.priorityLevel,
    eligibilityStatus: normalized.eligibilityStatus,
    materializedAt,
    materializationVersion: MATERIALIZATION_VERSION,
  };
  const ruleDraft = {
    ruleId: buildRuleId(materializationId),
    proposalId: materializationId,
    status: SAFE_RULE_STATUS,
    ruleType: normalized.proposedRuleType,
    stableItemKey: normalized.scopeKey,
    scopeType: normalized.scopeType,
    scopeKey: normalized.scopeKey,
    name: normalized.displayScope.primary,
    brand: null,
    approvedDecision: normalized.action.decision,
    action: { ...normalized.action },
    source: 'OWNER_LEARNING_CANDIDATE',
    approvedAt: materializedAt,
    createdAt: materializedAt,
    updatedAt: materializedAt,
    createdFromVersion: MATERIALIZATION_SCHEMA_VERSION,
    notes: null,
    provenance: { ...provenance },
  };
  return {
    schemaVersion: MATERIALIZATION_SCHEMA_VERSION,
    materializationId,
    fingerprint,
    candidateId: normalized.candidateId,
    ruleDraft,
    provenance,
    warnings: [
      'RULE_CREATED_DISABLED',
      'RULE_NOT_APPLIED_TO_PURCHASING',
    ],
  };
}

module.exports = {
  MATERIALIZATION_SCHEMA_VERSION,
  MATERIALIZATION_VERSION,
  SAFE_RULE_STATUS,
  SUPPORTED_DECISIONS,
  OwnerRuleMaterializationError,
  createMaterializationFingerprint,
  materializeRuleFromCandidate,
  validateCandidateForMaterialization,
};
