const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  STATUS_EVENTS_SCHEMA_VERSION,
} = require('./owner_rule_status_manager');

const STATUS_TRANSITION_INTENT_SCHEMA_VERSION =
  'owner-learning-rule-status-transition-intent-v1.0';
const EVENT_FIELDS = new Set([
  'schemaVersion',
  'eventId',
  'recordedAt',
  'ruleId',
  'candidateId',
  'fromStatus',
  'toStatus',
  'action',
  'actor',
  'reasonCode',
  'ownerComment',
  'previewId',
  'previewSnapshot',
  'ruleSnapshot',
  'metadata',
]);

class OwnerRuleStatusTransitionIntentError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerRuleStatusTransitionIntentError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new OwnerRuleStatusTransitionIntentError(
    code,
    message,
    cause ? { cause } : {}
  );
}

function text(value, name, maximum = 128) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > maximum ||
    value.includes('\0')
  ) {
    fail(
      'RULE_STATUS_TRANSITION_INTENT_INVALID',
      `${name} имеет неверное значение.`
    );
  }
  return value.trim();
}

function isoDate(value, name) {
  const normalized = text(value, name, 64);
  if (
    !normalized.endsWith('Z') ||
    !Number.isFinite(Date.parse(normalized))
  ) {
    fail(
      'RULE_STATUS_TRANSITION_INTENT_INVALID',
      `${name} должен быть ISO UTC datetime.`
    );
  }
  return new Date(Date.parse(normalized)).toISOString();
}

function digest(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

function intentFilePath(directoryPath, ruleId) {
  const directory = path.resolve(text(directoryPath, 'directoryPath', 4096));
  return path.join(directory, `${digest(text(ruleId, 'ruleId'))}.json`);
}

function validateStatusTransitionIntent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      'RULE_STATUS_TRANSITION_INTENT_CORRUPTED',
      'Status transition intent повреждён.'
    );
  }
  if (value.schemaVersion !== STATUS_TRANSITION_INTENT_SCHEMA_VERSION) {
    fail(
      'RULE_STATUS_TRANSITION_INTENT_CORRUPTED',
      'Status transition intent имеет неподдерживаемую схему.'
    );
  }
  const ruleId = text(value.ruleId, 'ruleId');
  const fromStatus = text(value.fromStatus, 'fromStatus', 32).toUpperCase();
  const toStatus = text(value.toStatus, 'toStatus', 32).toUpperCase();
  const action = text(value.action, 'action', 32).toUpperCase();
  const previewId = text(value.previewId, 'previewId');
  const reasonCode = text(value.reasonCode, 'reasonCode', 64).toUpperCase();
  const ownerComment = value.ownerComment === null
    ? null
    : text(value.ownerComment, 'ownerComment', 1000);
  const targetUpdatedAt = isoDate(
    value.targetUpdatedAt,
    'targetUpdatedAt'
  );
  if (
    !['ACTIVE', 'DISABLED'].includes(fromStatus) ||
    !['ACTIVE', 'DISABLED'].includes(toStatus) ||
    fromStatus === toStatus ||
    action !== (toStatus === 'ACTIVE' ? 'ACTIVATE' : 'DEACTIVATE')
  ) {
    fail(
      'RULE_STATUS_TRANSITION_INTENT_CORRUPTED',
      'Status transition intent не соответствует переходу.'
    );
  }
  const event = value.event;
  if (
    !event ||
    typeof event !== 'object' ||
    Array.isArray(event) ||
    Object.keys(event).some(name => !EVENT_FIELDS.has(name)) ||
    event.schemaVersion !== STATUS_EVENTS_SCHEMA_VERSION ||
    !/^[a-f0-9]{64}$/.test(event.eventId) ||
    event.ruleId !== ruleId ||
    event.fromStatus !== fromStatus ||
    event.toStatus !== toStatus ||
    event.action !== action ||
    event.previewId !== previewId ||
    event.reasonCode !== reasonCode ||
    event.ownerComment !== ownerComment ||
    event.recordedAt !== targetUpdatedAt ||
    event.previewSnapshot?.previewId !== previewId ||
    event.previewSnapshot?.ruleId !== ruleId ||
    event.previewSnapshot?.currentRuleStatus !== fromStatus ||
    event.previewSnapshot?.targetRuleStatus !== toStatus
  ) {
    fail(
      'RULE_STATUS_TRANSITION_INTENT_CORRUPTED',
      'Status transition intent не соответствует audit event.'
    );
  }
  const intentId = digest([
    STATUS_TRANSITION_INTENT_SCHEMA_VERSION,
    event.eventId,
    targetUpdatedAt,
  ]);
  if (value.intentId !== intentId) {
    fail(
      'RULE_STATUS_TRANSITION_INTENT_CORRUPTED',
      'Status transition intent имеет неверный fingerprint.'
    );
  }
  return structuredClone({
    schemaVersion: STATUS_TRANSITION_INTENT_SCHEMA_VERSION,
    intentId,
    ruleId,
    fromStatus,
    toStatus,
    action,
    previewId,
    reasonCode,
    ownerComment,
    targetUpdatedAt,
    event,
  });
}

function createStatusTransitionIntent({ event } = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    fail(
      'RULE_STATUS_TRANSITION_INTENT_INVALID',
      'Audit event обязателен для transition intent.'
    );
  }
  const targetUpdatedAt = event.recordedAt;
  return validateStatusTransitionIntent({
    schemaVersion: STATUS_TRANSITION_INTENT_SCHEMA_VERSION,
    intentId: digest([
      STATUS_TRANSITION_INTENT_SCHEMA_VERSION,
      event.eventId,
      targetUpdatedAt,
    ]),
    ruleId: event.ruleId,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    action: event.action,
    previewId: event.previewId,
    reasonCode: event.reasonCode,
    ownerComment: event.ownerComment,
    targetUpdatedAt,
    event,
  });
}

function fsyncDirectory(directoryPath, fsModule) {
  const descriptor = fsModule.openSync(directoryPath, 'r');
  try {
    fsModule.fsyncSync(descriptor);
  } finally {
    fsModule.closeSync(descriptor);
  }
}

function loadStatusTransitionIntent({
  directoryPath,
  ruleId,
  fsModule = fs,
} = {}) {
  const filePath = intentFilePath(directoryPath, ruleId);
  try {
    return validateStatusTransitionIntent(JSON.parse(
      fsModule.readFileSync(filePath, 'utf8')
    ));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof OwnerRuleStatusTransitionIntentError) throw error;
    fail(
      'RULE_STATUS_TRANSITION_INTENT_CORRUPTED',
      'Status transition intent повреждён.',
      error
    );
  }
}

function saveStatusTransitionIntent({
  directoryPath,
  intent,
  fsModule = fs,
} = {}) {
  const validated = validateStatusTransitionIntent(intent);
  const filePath = intentFilePath(directoryPath, validated.ruleId);
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}-${
      crypto.randomBytes(6).toString('hex')
    }.tmp`
  );
  let descriptor;
  try {
    fsModule.mkdirSync(directory, { recursive: true });
    descriptor = fsModule.openSync(temporaryPath, 'wx', 0o600);
    fsModule.writeFileSync(
      descriptor,
      `${JSON.stringify(validated, null, 2)}\n`,
      'utf8'
    );
    fsModule.fsyncSync(descriptor);
    fsModule.closeSync(descriptor);
    descriptor = undefined;
    fsModule.linkSync(temporaryPath, filePath);
    fsyncDirectory(directory, fsModule);
    fsModule.unlinkSync(temporaryPath);
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
    if (error.code === 'EEXIST') {
      const existing = loadStatusTransitionIntent({
        directoryPath,
        ruleId: validated.ruleId,
        fsModule,
      });
      if (existing?.intentId === validated.intentId) return existing;
      fail(
        'RULE_STATUS_TRANSITION_IN_PROGRESS',
        'Для правила уже выполняется status transition.',
        error
      );
    }
    if (error instanceof OwnerRuleStatusTransitionIntentError) throw error;
    fail(
      'RULE_STATUS_TRANSITION_STORAGE_UNAVAILABLE',
      'Не удалось атомарно сохранить status transition intent.',
      error
    );
  }
}

function deleteStatusTransitionIntent({
  directoryPath,
  ruleId,
  fsModule = fs,
} = {}) {
  const filePath = intentFilePath(directoryPath, ruleId);
  try {
    fsModule.unlinkSync(filePath);
    fsyncDirectory(path.dirname(filePath), fsModule);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    fail(
      'RULE_STATUS_TRANSITION_STORAGE_UNAVAILABLE',
      'Не удалось завершить status transition intent.',
      error
    );
  }
}

module.exports = {
  STATUS_TRANSITION_INTENT_SCHEMA_VERSION,
  OwnerRuleStatusTransitionIntentError,
  createStatusTransitionIntent,
  deleteStatusTransitionIntent,
  intentFilePath,
  loadStatusTransitionIntent,
  saveStatusTransitionIntent,
  validateStatusTransitionIntent,
};
