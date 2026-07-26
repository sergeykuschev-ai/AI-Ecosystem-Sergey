const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const STATUS_EVENTS_SCHEMA_VERSION =
  'owner-learning-rule-status-events-v0.9.2';
const ACTIONS = Object.freeze(['ACTIVATE', 'DEACTIVATE']);
const REASON_CODES = Object.freeze([
  'READY_TO_APPLY',
  'TEMPORARILY_DISABLE',
  'RESULT_NOT_EXPECTED',
  'NEEDS_MORE_REVIEW',
  'SEASONAL_PAUSE',
  'DATA_CHANGED',
  'OWNER_EXPERIENCE',
  'OTHER',
  'NOT_SPECIFIED',
]);
const SUPPORTED_STATUSES = Object.freeze(['ACTIVE', 'DISABLED']);
const SUPPORTED_DECISIONS = Object.freeze(['BUY', 'SKIP', 'DEFER']);
const MAX_OWNER_COMMENT_LENGTH = 1000;
const SAFE_METADATA_FIELDS = new Set(['repair', 'transitionSource']);

class OwnerRuleStatusError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerRuleStatusError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new OwnerRuleStatusError(code, message, { cause });
}

function text(value, fieldName, maximum = 512) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > maximum ||
    value.includes('\0')
  ) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      `${fieldName} имеет неверное значение.`
    );
  }
  return value.trim();
}

function isoDate(value, fieldName) {
  const normalized = text(value, fieldName);
  if (
    !normalized.endsWith('Z') ||
    !Number.isFinite(Date.parse(normalized))
  ) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
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

function emptyRuleStatusEvents() {
  return {
    schemaVersion: STATUS_EVENTS_SCHEMA_VERSION,
    updatedAt: null,
    events: [],
  };
}

function validateRuleStatusTransition({ rule, targetStatus } = {}) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'Правило должно быть объектом.'
    );
  }
  const ruleId = text(rule.ruleId, 'ruleId', 128);
  const stableItemKey = text(rule.stableItemKey, 'stableItemKey', 1024);
  const status = text(rule.status, 'status').toUpperCase();
  const target = text(targetStatus, 'targetStatus').toUpperCase();
  const decision = text(
    rule.action?.decision ?? rule.approvedDecision,
    'decision'
  ).toUpperCase();
  const candidateId = text(
    rule.provenance?.candidateId,
    'provenance.candidateId'
  );
  const materialized = (
    rule.provenance?.source === 'OWNER_LEARNING_CANDIDATE' &&
    rule.source === 'OWNER_LEARNING_CANDIDATE' &&
    rule.ruleType === 'ITEM_DECISION_OVERRIDE' &&
    rule.scopeType === 'ITEM' &&
    rule.scopeKey === stableItemKey
  );
  if (!materialized) {
    fail(
      'OWNER_RULE_STATUS_TRANSITION_INVALID',
      'Через этот flow можно управлять только материализованным item rule.'
    );
  }
  if (
    !SUPPORTED_STATUSES.includes(status) ||
    !SUPPORTED_STATUSES.includes(target)
  ) {
    fail(
      'OWNER_RULE_STATUS_TRANSITION_INVALID',
      'Статус правила или целевой статус не поддерживается.'
    );
  }
  if (!SUPPORTED_DECISIONS.includes(decision)) {
    fail(
      'OWNER_RULE_STATUS_TRANSITION_INVALID',
      'Решение правила не поддерживается.'
    );
  }
  if (
    rule.approvedDecision !== decision ||
    rule.action?.quantityValue !== null ||
    rule.action?.quantityStrategy !== (
      decision === 'BUY'
        ? 'KEEP_AGENT_QUANTITY'
        : 'NO_QUANTITY_CHANGE'
    )
  ) {
    fail(
      'OWNER_RULE_STATUS_TRANSITION_INVALID',
      'Материализованное правило повреждено.'
    );
  }
  if (
    !(
      (status === 'DISABLED' && target === 'ACTIVE') ||
      (status === 'ACTIVE' && target === 'DISABLED')
    )
  ) {
    fail(
      'OWNER_RULE_STATUS_TRANSITION_INVALID',
      `Переход ${status} → ${target} запрещён.`
    );
  }
  return {
    ruleId,
    candidateId,
    stableItemKey,
    decision,
    fromStatus: status,
    toStatus: target,
    action: target === 'ACTIVE' ? 'ACTIVATE' : 'DEACTIVATE',
  };
}

function safeOwnerComment(value) {
  if (value === undefined || value === null || value === '') return null;
  if (
    typeof value !== 'string' ||
    value.length > MAX_OWNER_COMMENT_LENGTH ||
    value.includes('\0')
  ) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'Комментарий владельца превышает допустимую длину.'
    );
  }
  return value.trim() || null;
}

function safeMetadata(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'metadata должен быть безопасным объектом.'
    );
  }
  for (const name of Object.keys(value)) {
    if (!SAFE_METADATA_FIELDS.has(name)) {
      fail(
        'OWNER_RULE_STATUS_INVALID_INPUT',
        `metadata.${name} не поддерживается.`
      );
    }
  }
  if (
    value.repair !== undefined &&
    typeof value.repair !== 'boolean'
  ) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'metadata.repair должен быть boolean.'
    );
  }
  if (
    value.transitionSource !== undefined &&
    value.transitionSource !== 'OWNER_RULE_STATUS_API'
  ) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'metadata.transitionSource не поддерживается.'
    );
  }
  return {
    ...(value.repair === true ? { repair: true } : {}),
    ...(value.transitionSource
      ? { transitionSource: value.transitionSource }
      : {}),
  };
}

function finiteNumber(value, fieldName) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      `${fieldName} должен быть числом или null.`
    );
  }
  return value;
}

function nonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      `${fieldName} должен быть неотрицательным целым числом.`
    );
  }
  return value;
}

function safeWarnings(value) {
  if (!Array.isArray(value) || value.length > 50) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'warnings должен быть ограниченным массивом.'
    );
  }
  return value.map((warning, index) => {
    if (typeof warning === 'string') {
      return text(warning, `warnings[${index}]`, 256);
    }
    if (
      !warning ||
      typeof warning !== 'object' ||
      Array.isArray(warning)
    ) {
      fail(
        'OWNER_RULE_STATUS_INVALID_INPUT',
        `warnings[${index}] имеет неверное значение.`
      );
    }
    return {
      code: text(warning.code, `warnings[${index}].code`, 128),
      message: text(
        warning.message,
        `warnings[${index}].message`,
        512
      ),
    };
  });
}

function safePreviewSnapshot(value, transition) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'Актуальный preview обязателен для изменения статуса.'
    );
  }
  const previewId = text(value.previewId, 'previewSnapshot.previewId', 128);
  const ruleId = text(value.ruleId, 'previewSnapshot.ruleId', 128);
  const currentRuleStatus = text(
    value.currentRuleStatus,
    'previewSnapshot.currentRuleStatus'
  ).toUpperCase();
  const targetRuleStatus = text(
    value.targetRuleStatus,
    'previewSnapshot.targetRuleStatus'
  ).toUpperCase();
  if (
    previewId !== text(value.previewId, 'previewId', 128) ||
    ruleId !== transition.ruleId ||
    currentRuleStatus !== transition.fromStatus ||
    targetRuleStatus !== transition.toStatus
  ) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'Preview не соответствует переходу статуса.'
    );
  }
  return {
    previewId,
    previewedAt: isoDate(
      value.previewedAt,
      'previewSnapshot.previewedAt'
    ),
    ruleId,
    currentRuleStatus,
    targetRuleStatus,
    affectedItems: nonNegativeInteger(
      value.affectedItems,
      'previewSnapshot.affectedItems'
    ),
    affectedRows: nonNegativeInteger(
      value.affectedRows,
      'previewSnapshot.affectedRows'
    ),
    decisionChanges: nonNegativeInteger(
      value.decisionChanges,
      'previewSnapshot.decisionChanges'
    ),
    quantityChanges: nonNegativeInteger(
      value.quantityChanges,
      'previewSnapshot.quantityChanges'
    ),
    orderAmountBefore: finiteNumber(
      value.orderAmountBefore,
      'previewSnapshot.orderAmountBefore'
    ),
    orderAmountAfter: finiteNumber(
      value.orderAmountAfter,
      'previewSnapshot.orderAmountAfter'
    ),
    orderAmountDelta: finiteNumber(
      value.orderAmountDelta,
      'previewSnapshot.orderAmountDelta'
    ),
    unitsBefore: finiteNumber(
      value.unitsBefore,
      'previewSnapshot.unitsBefore'
    ),
    unitsAfter: finiteNumber(
      value.unitsAfter,
      'previewSnapshot.unitsAfter'
    ),
    unitsDelta: finiteNumber(
      value.unitsDelta,
      'previewSnapshot.unitsDelta'
    ),
    financialStatusBefore:
      value.financialStatusBefore === null
        ? null
        : text(
          value.financialStatusBefore,
          'previewSnapshot.financialStatusBefore',
          128
        ),
    financialStatusAfter:
      value.financialStatusAfter === null
        ? null
        : text(
          value.financialStatusAfter,
          'previewSnapshot.financialStatusAfter',
          128
        ),
    financiallyPermitted: value.financiallyPermitted === true,
    warnings: safeWarnings(value.warnings),
  };
}

function createRuleStatusEvent(input = {}) {
  if (input.confirmation !== true) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'Изменение статуса требует явного confirmation.'
    );
  }
  const transition = validateRuleStatusTransition({
    rule: input.rule,
    targetStatus: input.targetStatus,
  });
  const recordedAt = isoDate(input.recordedAt, 'recordedAt');
  const reasonCode = text(
    input.reasonCode ?? 'NOT_SPECIFIED',
    'reasonCode'
  ).toUpperCase();
  if (!REASON_CODES.includes(reasonCode)) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'reasonCode не поддерживается.'
    );
  }
  const previewSnapshot = safePreviewSnapshot(
    input.previewSnapshot,
    transition
  );
  const eventId = digest([
    STATUS_EVENTS_SCHEMA_VERSION,
    recordedAt,
    transition.ruleId,
    transition.fromStatus,
    transition.toStatus,
    transition.action,
    reasonCode,
    previewSnapshot.previewId,
  ]);
  return {
    schemaVersion: STATUS_EVENTS_SCHEMA_VERSION,
    eventId,
    recordedAt,
    ruleId: transition.ruleId,
    candidateId: transition.candidateId,
    fromStatus: transition.fromStatus,
    toStatus: transition.toStatus,
    action: transition.action,
    actor: 'OWNER',
    reasonCode,
    ownerComment: safeOwnerComment(input.ownerComment),
    previewId: previewSnapshot.previewId,
    previewSnapshot,
    ruleSnapshot: {
      ruleType: input.rule.ruleType,
      stableItemKeyHash: digest(transition.stableItemKey),
      decision: transition.decision,
      quantityStrategy: input.rule.action.quantityStrategy,
      previousStatus: transition.fromStatus,
      newStatus: transition.toStatus,
      provenanceSource: input.rule.provenance.source,
    },
    metadata: safeMetadata(input.metadata),
  };
}

function validateJournal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      'OWNER_RULE_STATUS_STORAGE_CORRUPTED',
      'Журнал статусов правил повреждён.'
    );
  }
  if (value.schemaVersion !== STATUS_EVENTS_SCHEMA_VERSION) {
    fail(
      'OWNER_RULE_STATUS_SCHEMA_UNSUPPORTED',
      'Версия схемы журнала статусов правил не поддерживается.'
    );
  }
  if (
    value.updatedAt !== null &&
    value.updatedAt !== undefined
  ) {
    isoDate(value.updatedAt, 'updatedAt');
  }
  if (!Array.isArray(value.events)) {
    fail(
      'OWNER_RULE_STATUS_STORAGE_CORRUPTED',
      'Журнал статусов правил повреждён.'
    );
  }
  const eventIds = new Set();
  for (const event of value.events) {
    if (
      !event ||
      typeof event !== 'object' ||
      event.schemaVersion !== STATUS_EVENTS_SCHEMA_VERSION ||
      typeof event.eventId !== 'string' ||
      eventIds.has(event.eventId)
    ) {
      fail(
        'OWNER_RULE_STATUS_STORAGE_CORRUPTED',
        'Журнал статусов правил содержит некорректное событие.'
      );
    }
    eventIds.add(event.eventId);
  }
  return structuredClone({
    schemaVersion: STATUS_EVENTS_SCHEMA_VERSION,
    updatedAt: value.updatedAt || null,
    events: value.events,
  });
}

function loadRuleStatusEvents({ filePath, fsModule = fs } = {}) {
  const resolvedPath = path.resolve(text(filePath, 'filePath', 4096));
  try {
    return validateJournal(JSON.parse(
      fsModule.readFileSync(resolvedPath, 'utf8')
    ));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyRuleStatusEvents();
    if (error instanceof OwnerRuleStatusError) throw error;
    fail(
      'OWNER_RULE_STATUS_STORAGE_CORRUPTED',
      'Журнал статусов правил повреждён и не был перезаписан.',
      error
    );
  }
}

function atomicWrite(filePath, content, fsModule) {
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
    fsModule.writeFileSync(descriptor, content, 'utf8');
    fsModule.fsyncSync(descriptor);
    fsModule.closeSync(descriptor);
    descriptor = undefined;
    fsModule.renameSync(temporaryPath, filePath);
    const directoryDescriptor = fsModule.openSync(directory, 'r');
    try {
      fsModule.fsyncSync(directoryDescriptor);
    } finally {
      fsModule.closeSync(directoryDescriptor);
    }
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
    throw error;
  }
}

function appendRuleStatusEvent({
  filePath,
  event,
  fsModule = fs,
} = {}) {
  const resolvedPath = path.resolve(text(filePath, 'filePath', 4096));
  const journal = loadRuleStatusEvents({
    filePath: resolvedPath,
    fsModule,
  });
  if (journal.events.some(item => item.eventId === event?.eventId)) {
    return { added: false, journal, event: structuredClone(event) };
  }
  if (
    !event ||
    typeof event !== 'object' ||
    event.schemaVersion !== STATUS_EVENTS_SCHEMA_VERSION
  ) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'Событие статуса правила некорректно.'
    );
  }
  const next = {
    schemaVersion: STATUS_EVENTS_SCHEMA_VERSION,
    updatedAt: event.recordedAt,
    events: [...journal.events, structuredClone(event)],
  };
  try {
    atomicWrite(
      resolvedPath,
      `${JSON.stringify(next, null, 2)}\n`,
      fsModule
    );
  } catch (error) {
    fail(
      'OWNER_RULE_STATUS_WRITE_FAILED',
      'Не удалось атомарно записать событие статуса правила.',
      error
    );
  }
  return {
    added: true,
    journal: structuredClone(next),
    event: structuredClone(event),
  };
}

function getCurrentRuleStatusHistory({ events, ruleId } = {}) {
  const normalizedRuleId = text(ruleId, 'ruleId', 128);
  if (!Array.isArray(events)) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'events должен быть массивом.'
    );
  }
  return events
    .filter(event => event?.ruleId === normalizedRuleId)
    .map(event => structuredClone(event))
    .sort((left, right) =>
      left.recordedAt.localeCompare(right.recordedAt) ||
      left.eventId.localeCompare(right.eventId)
    );
}

function summarizeRuleStatusEvents(events) {
  if (!Array.isArray(events)) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'events должен быть массивом.'
    );
  }
  const ruleIds = new Set();
  let activations = 0;
  let deactivations = 0;
  let lastEvent = null;
  for (const event of events) {
    if (!event || !ACTIONS.includes(event.action)) continue;
    ruleIds.add(event.ruleId);
    if (event.action === 'ACTIVATE') activations += 1;
    if (event.action === 'DEACTIVATE') deactivations += 1;
    if (
      !lastEvent ||
      event.recordedAt > lastEvent.recordedAt ||
      (
        event.recordedAt === lastEvent.recordedAt &&
        event.eventId > lastEvent.eventId
      )
    ) {
      lastEvent = event;
    }
  }
  return {
    totalEvents: activations + deactivations,
    activations,
    deactivations,
    affectedRules: ruleIds.size,
    lastStatusChangeAt: lastEvent?.recordedAt || null,
    lastStatusAction: lastEvent?.action || null,
  };
}

module.exports = {
  ACTIONS,
  MAX_OWNER_COMMENT_LENGTH,
  REASON_CODES,
  STATUS_EVENTS_SCHEMA_VERSION,
  OwnerRuleStatusError,
  appendRuleStatusEvent,
  createRuleStatusEvent,
  emptyRuleStatusEvents,
  getCurrentRuleStatusHistory,
  loadRuleStatusEvents,
  summarizeRuleStatusEvents,
  validateRuleStatusTransition,
};
