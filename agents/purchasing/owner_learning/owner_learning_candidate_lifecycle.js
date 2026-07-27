const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LIFECYCLE_SCHEMA_VERSION =
  'owner-learning-candidate-lifecycle-v0.8.5';
const DEFAULT_LIFECYCLE_PATH = path.resolve(
  __dirname,
  '../../../data/purchasing/owner-learning-candidate-lifecycle.json'
);
const MAX_OWNER_COMMENT_LENGTH = 1000;
const STATUSES = Object.freeze([
  'NEW',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'POSTPONED',
]);
const ACTIONS = Object.freeze([
  'START_REVIEW',
  'APPROVE',
  'REJECT',
  'POSTPONE',
  'REOPEN',
]);
const REASON_CODES = Object.freeze([
  'READY_FOR_RULE',
  'NEEDS_MORE_HISTORY',
  'INSUFFICIENT_EVIDENCE',
  'TOO_BROAD',
  'CONTRADICTORY_HISTORY',
  'NOT_RELEVANT',
  'OWNER_EXPERIENCE',
  'OTHER',
  'NOT_SPECIFIED',
]);
const ALLOWED_TRANSITIONS = Object.freeze({
  NEW: Object.freeze([
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'POSTPONED',
  ]),
  UNDER_REVIEW: Object.freeze([
    'APPROVED',
    'REJECTED',
    'POSTPONED',
  ]),
  POSTPONED: Object.freeze([
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
  ]),
  REJECTED: Object.freeze(['UNDER_REVIEW']),
  APPROVED: Object.freeze(['UNDER_REVIEW']),
});
const FORBIDDEN_METADATA_KEY =
  /(authorization|credential|password|secret|token|api[-_]?key)/i;

class OwnerLearningCandidateLifecycleError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerLearningCandidateLifecycleError';
    this.code = code;
  }
}

function lifecycleError(code, message, cause) {
  return new OwnerLearningCandidateLifecycleError(
    code,
    message,
    cause ? { cause } : {}
  );
}

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function plainObject(value, fieldName) {
  if (value === null || value === undefined) return {};
  if (!isPlainObject(value)) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
      `${fieldName} должен быть объектом.`
    );
  }
  return value;
}

function pathLike(value) {
  return value.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith('file://');
}

function optionalText(value, fieldName, maximum = null) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
      `${fieldName} должен быть строкой.`
    );
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (pathLike(normalized)) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
      `${fieldName} содержит локальный путь.`
    );
  }
  if (maximum !== null && normalized.length > maximum) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
      `${fieldName} превышает допустимую длину.`
    );
  }
  return normalized;
}

function requiredText(value, fieldName, maximum = null) {
  const normalized = optionalText(value, fieldName, maximum);
  if (!normalized) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
      `${fieldName} обязателен.`
    );
  }
  return normalized;
}

function enumValue(value, allowed, fieldName, defaultValue = null) {
  const normalized = optionalText(value, fieldName)?.toUpperCase() ||
    defaultValue;
  if (!normalized || !allowed.includes(normalized)) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
      `${fieldName} содержит неизвестное значение.`
    );
  }
  return normalized;
}

function isoUtc(value, fieldName) {
  const normalized = requiredText(value, fieldName);
  if (
    !normalized.endsWith('Z') ||
    !normalized.includes('T') ||
    !Number.isFinite(Date.parse(normalized))
  ) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
      `${fieldName} должен быть ISO UTC datetime.`
    );
  }
  return new Date(Date.parse(normalized)).toISOString();
}

function nullableScore(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > 100
  ) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
      `${fieldName} должен быть целым числом от 0 до 100.`
    );
  }
  return value;
}

function safeMetadataValue(value, fieldName, seen = new Set()) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return optionalText(value, fieldName);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw lifecycleError(
        'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
        `${fieldName} содержит некорректное число.`
      );
    }
    return value;
  }
  if (typeof value !== 'object' || value === undefined) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
      `${fieldName} содержит несериализуемое значение.`
    );
  }
  if (seen.has(value)) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
      `${fieldName} содержит циклическую ссылку.`
    );
  }
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((item, index) =>
      safeMetadataValue(item, `${fieldName}[${index}]`, seen)
    );
  } else {
    if (!isPlainObject(value)) {
      throw lifecycleError(
        'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
        `${fieldName} содержит небезопасный объект.`
      );
    }
    result = {};
    for (const key of Object.keys(value).sort()) {
      if (FORBIDDEN_METADATA_KEY.test(key)) {
        throw lifecycleError(
          'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
          'metadata содержит запрещённое поле.'
        );
      }
      result[key] = safeMetadataValue(
        value[key],
        `${fieldName}.${key}`,
        seen
      );
    }
  }
  seen.delete(value);
  return result;
}

function normalizeDisplayScope(value) {
  const source = plainObject(value, 'candidateSnapshot.displayScope');
  return {
    primary: requiredText(
      source.primary,
      'candidateSnapshot.displayScope.primary',
      512
    ),
    secondary: optionalText(
      source.secondary,
      'candidateSnapshot.displayScope.secondary',
      512
    ),
  };
}

function normalizeCandidateSnapshot(value) {
  const source = plainObject(value, 'candidateSnapshot');
  return {
    patternType: requiredText(
      source.patternType,
      'candidateSnapshot.patternType',
      128
    ),
    scopeType: requiredText(
      source.scopeType,
      'candidateSnapshot.scopeType',
      32
    ),
    displayScope: normalizeDisplayScope(source.displayScope),
    proposedRuleType: requiredText(
      source.proposedRuleType,
      'candidateSnapshot.proposedRuleType',
      128
    ),
    proposedDecision: optionalText(
      source.proposedDecision,
      'candidateSnapshot.proposedDecision',
      32
    ),
    confidenceScore: nullableScore(
      source.confidenceScore,
      'candidateSnapshot.confidenceScore'
    ),
    confidenceLevel: optionalText(
      source.confidenceLevel,
      'candidateSnapshot.confidenceLevel',
      32
    ),
    priorityScore: nullableScore(
      source.priorityScore,
      'candidateSnapshot.priorityScore'
    ),
    priorityLevel: requiredText(
      source.priorityLevel,
      'candidateSnapshot.priorityLevel',
      32
    ),
    eligibilityStatus: requiredText(
      source.eligibilityStatus,
      'candidateSnapshot.eligibilityStatus',
      32
    ),
  };
}

function validateCandidateLifecycleTransition({
  fromStatus,
  toStatus,
  action,
} = {}) {
  const from = enumValue(fromStatus, STATUSES, 'fromStatus');
  const to = enumValue(toStatus, STATUSES, 'toStatus');
  if (to === 'NEW' || !ALLOWED_TRANSITIONS[from].includes(to)) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_TRANSITION_INVALID',
      `Переход ${from} → ${to} не разрешён.`
    );
  }
  if (action !== undefined) {
    const normalizedAction = enumValue(action, ACTIONS, 'action');
    const expectedAction = to === 'UNDER_REVIEW'
      ? (from === 'NEW' ? 'START_REVIEW' : 'REOPEN')
      : {
        APPROVED: 'APPROVE',
        REJECTED: 'REJECT',
        POSTPONED: 'POSTPONE',
      }[to];
    if (normalizedAction !== expectedAction) {
      throw lifecycleError(
        'OWNER_LEARNING_LIFECYCLE_TRANSITION_INVALID',
        'Действие не соответствует переходу lifecycle.'
      );
    }
  }
  return { fromStatus: from, toStatus: to };
}

function eventIdPayload(event) {
  return [
    event.schemaVersion,
    event.recordedAt,
    event.candidateId,
    event.fromStatus,
    event.toStatus,
    event.action,
    event.reasonCode,
  ];
}

function buildEventId(event) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(eventIdPayload(event)), 'utf8')
    .digest('hex');
}

function createCandidateLifecycleEvent(input = {}) {
  const source = plainObject(input, 'input');
  const transition = validateCandidateLifecycleTransition({
    fromStatus: source.fromStatus,
    toStatus: source.toStatus,
    action: source.action,
  });
  const event = {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    eventId: null,
    recordedAt: isoUtc(source.recordedAt, 'recordedAt'),
    candidateId: requiredText(source.candidateId, 'candidateId', 128),
    fromStatus: transition.fromStatus,
    toStatus: transition.toStatus,
    action: enumValue(source.action, ACTIONS, 'action'),
    actor: enumValue(source.actor, ['OWNER'], 'actor', 'OWNER'),
    reasonCode: enumValue(
      source.reasonCode,
      REASON_CODES,
      'reasonCode',
      'NOT_SPECIFIED'
    ),
    ownerComment: optionalText(
      source.ownerComment,
      'ownerComment',
      MAX_OWNER_COMMENT_LENGTH
    ),
    candidateSnapshot: normalizeCandidateSnapshot(
      source.candidateSnapshot
    ),
    metadata: safeMetadataValue(
      plainObject(source.metadata, 'metadata'),
      'metadata'
    ),
  };
  event.eventId = buildEventId(event);
  return event;
}

function emptyCandidateLifecycle() {
  return {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    updatedAt: null,
    events: [],
  };
}

function validateLifecycleEvent(value) {
  if (!isPlainObject(value)) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
      'Lifecycle содержит некорректное событие.'
    );
  }
  if (value.schemaVersion !== LIFECYCLE_SCHEMA_VERSION) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_SCHEMA_UNSUPPORTED',
      'Lifecycle event имеет неизвестную schemaVersion.'
    );
  }
  const normalized = createCandidateLifecycleEvent(value);
  if (value.eventId !== normalized.eventId) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
      'Lifecycle event содержит некорректный eventId.'
    );
  }
  return normalized;
}

function validateCandidateLifecycle(value) {
  if (!isPlainObject(value)) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
      'Candidate lifecycle должен быть объектом.'
    );
  }
  if (value.schemaVersion !== LIFECYCLE_SCHEMA_VERSION) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_SCHEMA_UNSUPPORTED',
      'Candidate lifecycle имеет неизвестную schemaVersion.'
    );
  }
  if (!Array.isArray(value.events)) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
      'Candidate lifecycle events должен быть массивом.'
    );
  }
  const updatedAt = value.updatedAt === null ||
    value.updatedAt === undefined
    ? null
    : isoUtc(value.updatedAt, 'updatedAt');
  const events = value.events.map(validateLifecycleEvent);
  const eventIds = new Set();
  const states = new Map();
  for (const event of events) {
    if (eventIds.has(event.eventId)) {
      throw lifecycleError(
        'OWNER_LEARNING_LIFECYCLE_INVALID_INPUT',
        'Candidate lifecycle содержит повторный eventId.'
      );
    }
    eventIds.add(event.eventId);
    const current = states.get(event.candidateId) || 'NEW';
    if (event.fromStatus !== current) {
      throw lifecycleError(
        'OWNER_LEARNING_LIFECYCLE_TRANSITION_INVALID',
        'Lifecycle event не соответствует текущему статусу кандидата.'
      );
    }
    validateCandidateLifecycleTransition(event);
    states.set(event.candidateId, event.toStatus);
  }
  return {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    updatedAt,
    events,
  };
}

function loadCandidateLifecycle({
  filePath = DEFAULT_LIFECYCLE_PATH,
  fsModule = fs,
} = {}) {
  const resolvedPath = path.resolve(filePath);
  let source;
  try {
    source = fsModule.readFileSync(resolvedPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return emptyCandidateLifecycle();
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_CORRUPTED',
      'Candidate lifecycle недоступен.',
      error
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_CORRUPTED',
      'Candidate lifecycle повреждён и не был перезаписан.',
      error
    );
  }
  return validateCandidateLifecycle(parsed);
}

function fsyncDirectory(directoryPath, fsModule) {
  let descriptor;
  try {
    descriptor = fsModule.openSync(directoryPath, 'r');
    fsModule.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fsModule.closeSync(descriptor);
  }
}

function atomicWriteCandidateLifecycle(
  filePath,
  lifecycle,
  options = {}
) {
  const fsModule = options.fsModule || fs;
  const validated = validateCandidateLifecycle(lifecycle);
  const resolvedPath = path.resolve(filePath);
  const directoryPath = path.dirname(resolvedPath);
  const suffix = options.randomSuffix ||
    crypto.randomBytes(6).toString('hex');
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(resolvedPath)}.${process.pid}-${suffix}.tmp`
  );
  let descriptor;
  try {
    fsModule.mkdirSync(directoryPath, { recursive: true });
    descriptor = fsModule.openSync(temporaryPath, 'wx', 0o600);
    fsModule.writeFileSync(
      descriptor,
      `${JSON.stringify(validated, null, 2)}\n`,
      'utf8'
    );
    fsModule.fsyncSync(descriptor);
    fsModule.closeSync(descriptor);
    descriptor = undefined;
    fsModule.renameSync(temporaryPath, resolvedPath);
    fsyncDirectory(directoryPath, fsModule);
    return validated;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fsModule.closeSync(descriptor);
      } catch {}
    }
    try {
      if (fsModule.existsSync(temporaryPath)) {
        fsModule.unlinkSync(temporaryPath);
      }
    } catch {}
    if (error instanceof OwnerLearningCandidateLifecycleError) {
      throw error;
    }
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_WRITE_FAILED',
      'Не удалось атомарно сохранить candidate lifecycle.',
      error
    );
  }
}

function latestIsoDate(left, right) {
  if (!left) return right;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function appendCandidateLifecycleEvent({
  filePath = DEFAULT_LIFECYCLE_PATH,
  event,
  fsModule = fs,
  randomSuffix,
} = {}) {
  const normalizedEvent = validateLifecycleEvent(event);
  const lifecycle = loadCandidateLifecycle({ filePath, fsModule });
  const existing = lifecycle.events.find(
    item => item.eventId === normalizedEvent.eventId
  );
  if (existing) {
    return {
      added: false,
      event: existing,
      lifecycle,
    };
  }
  const current = getCandidateLifecycleState({
    lifecycle,
    candidateId: normalizedEvent.candidateId,
  });
  if (normalizedEvent.fromStatus !== current.status) {
    throw lifecycleError(
      'OWNER_LEARNING_LIFECYCLE_TRANSITION_INVALID',
      'Событие не соответствует текущему статусу кандидата.'
    );
  }
  validateCandidateLifecycleTransition(normalizedEvent);
  const nextLifecycle = {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION,
    updatedAt: latestIsoDate(
      lifecycle.updatedAt,
      normalizedEvent.recordedAt
    ),
    events: [...lifecycle.events, normalizedEvent],
  };
  const saved = atomicWriteCandidateLifecycle(
    filePath,
    nextLifecycle,
    { fsModule, randomSuffix }
  );
  return {
    added: true,
    event: normalizedEvent,
    lifecycle: saved,
  };
}

function stateFromEvents(candidateId, events) {
  const lastEvent = events.at(-1) || null;
  return {
    candidateId,
    status: lastEvent?.toStatus || 'NEW',
    lastAction: lastEvent?.action || null,
    lastRecordedAt: lastEvent?.recordedAt || null,
    reasonCode: lastEvent?.reasonCode || null,
    eventCount: events.length,
    lastEvent,
  };
}

function getCandidateLifecycleState({
  lifecycle,
  candidateId,
} = {}) {
  const validated = validateCandidateLifecycle(lifecycle);
  const normalizedId = requiredText(candidateId, 'candidateId', 128);
  return stateFromEvents(
    normalizedId,
    validated.events.filter(event =>
      event.candidateId === normalizedId
    )
  );
}

function getCandidateLifecycleStates({ lifecycle } = {}) {
  const validated = validateCandidateLifecycle(lifecycle);
  const ids = [...new Set(
    validated.events.map(event => event.candidateId)
  )].sort((left, right) => left.localeCompare(right, 'en'));
  return ids.map(candidateId => getCandidateLifecycleState({
    lifecycle: validated,
    candidateId,
  }));
}

function summarizeCandidateLifecycle(lifecycle) {
  const validated = validateCandidateLifecycle(lifecycle);
  const states = getCandidateLifecycleStates({ lifecycle: validated });
  const summary = {
    totalEvents: validated.events.length,
    uniqueCandidates: states.length,
    currentStates: {
      NEW: 0,
      UNDER_REVIEW: 0,
      APPROVED: 0,
      REJECTED: 0,
      POSTPONED: 0,
    },
    actionsByType: Object.fromEntries(
      ACTIONS.map(action => [action, 0])
    ),
    reasonsByType: Object.fromEntries(
      REASON_CODES.map(reason => [reason, 0])
    ),
    firstRecordedAt: null,
    lastRecordedAt: null,
  };
  for (const state of states) {
    summary.currentStates[state.status] += 1;
  }
  for (const event of validated.events) {
    summary.actionsByType[event.action] += 1;
    summary.reasonsByType[event.reasonCode] += 1;
    if (
      !summary.firstRecordedAt ||
      Date.parse(event.recordedAt) <
        Date.parse(summary.firstRecordedAt)
    ) {
      summary.firstRecordedAt = event.recordedAt;
    }
    if (
      !summary.lastRecordedAt ||
      Date.parse(event.recordedAt) >
        Date.parse(summary.lastRecordedAt)
    ) {
      summary.lastRecordedAt = event.recordedAt;
    }
  }
  return summary;
}

module.exports = {
  ACTIONS,
  ALLOWED_TRANSITIONS,
  DEFAULT_LIFECYCLE_PATH,
  LIFECYCLE_SCHEMA_VERSION,
  MAX_OWNER_COMMENT_LENGTH,
  REASON_CODES,
  STATUSES,
  OwnerLearningCandidateLifecycleError,
  appendCandidateLifecycleEvent,
  atomicWriteCandidateLifecycle,
  createCandidateLifecycleEvent,
  emptyCandidateLifecycle,
  getCandidateLifecycleState,
  getCandidateLifecycleStates,
  loadCandidateLifecycle,
  summarizeCandidateLifecycle,
  validateCandidateLifecycle,
  validateCandidateLifecycleTransition,
};
