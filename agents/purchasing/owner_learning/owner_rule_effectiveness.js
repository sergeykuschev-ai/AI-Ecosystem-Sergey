const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RULE_EFFECTIVENESS_SCHEMA_VERSION =
  'owner-learning-rule-effectiveness-events-v0.9.3';
const DEFAULT_RULE_EFFECTIVENESS_PATH = path.resolve(
  __dirname,
  '../../../data/purchasing/owner-learning-rule-effectiveness-events.json'
);
const EVALUATION_STATUSES = Object.freeze([
  'EVALUATED',
  'NOT_EVALUATED',
  'UNAVAILABLE',
]);
const EFFECT_STATUSES = Object.freeze([
  'APPLIED_EFFECT',
  'MATCHED_NO_CHANGE',
  'NO_MATCH',
  'FALLBACK_TO_BASELINE',
  'NOT_ACTIVE',
  'UNAVAILABLE',
]);
const CLASSIFICATIONS = Object.freeze([
  'EFFECTIVE',
  'OCCASIONAL',
  'NO_EFFECT_YET',
  'STALE',
  'REVIEW_RECOMMENDED',
  'INSUFFICIENT_DATA',
]);
const EXPLANATION_CODES = Object.freeze([
  'RULE_CHANGED_ORDER',
  'RULE_MATCHED_WITHOUT_CHANGE',
  'RULE_DID_NOT_MATCH',
  'RULE_EFFECT_RATE_HIGH',
  'RULE_EFFECT_RATE_LOW',
  'RULE_HAS_NO_EFFECT_YET',
  'RULE_LAST_EFFECT_RECENT',
  'RULE_LAST_EFFECT_STALE',
  'RULE_FALLBACK_OCCURRED',
  'RULE_HAS_CONSECUTIVE_NO_EFFECT',
  'RULE_DATA_QUALITY_ISSUES',
  'RULE_EFFECTIVENESS_INSUFFICIENT_DATA',
  'RULE_REQUIRES_MANUAL_REVIEW',
  'EFFECTIVENESS_IS_OBSERVATIONAL_ONLY',
]);
const FORBIDDEN_METADATA_KEY =
  /(authorization|credential|password|secret|token|api[-_]?key|stableitemkey|ownercomment|candidatepayload|evidenceids|stack|path|result|workingorder)/i;

class OwnerRuleEffectivenessError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerRuleEffectivenessError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new OwnerRuleEffectivenessError(
    code,
    message,
    cause ? { cause } : {}
  );
}

function plain(value, fieldName) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      `${fieldName} должен быть объектом.`
    );
  }
  return value;
}

function text(value, fieldName, options = {}) {
  const {
    maximum = 512,
    nullable = false,
    allowPath = false,
  } = options;
  if (nullable && (value === null || value === undefined || value === '')) {
    return null;
  }
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > maximum ||
    value.includes('\0')
  ) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      `${fieldName} имеет неверное значение.`
    );
  }
  const normalized = value.trim();
  if (
    !allowPath &&
    (
      normalized.startsWith('/') ||
      normalized.startsWith('file://') ||
      /^[a-zA-Z]:[\\/]/.test(normalized)
    )
  ) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      `${fieldName} содержит локальный путь.`
    );
  }
  return normalized;
}

function enumValue(value, allowed, fieldName) {
  const normalized = text(value, fieldName).toUpperCase();
  if (!allowed.includes(normalized)) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      `${fieldName} не поддерживается.`
    );
  }
  return normalized;
}

function isoDate(value, fieldName) {
  const normalized = text(value, fieldName);
  if (
    !normalized.endsWith('Z') ||
    !Number.isFinite(Date.parse(normalized))
  ) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      `${fieldName} должен быть ISO UTC datetime.`
    );
  }
  return new Date(Date.parse(normalized)).toISOString();
}

function hash(value) {
  return crypto.createHash('sha256')
    .update(
      typeof value === 'string' ? value : JSON.stringify(value),
      'utf8'
    )
    .digest('hex');
}

function fingerprint(value, fieldName) {
  const normalized = text(value, fieldName, { maximum: 128 });
  if (!/^[0-9a-f]{64}$/i.test(normalized)) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      `${fieldName} должен быть SHA-256 fingerprint.`
    );
  }
  return normalized.toLowerCase();
}

function finiteNumber(value, fieldName, nullable = true) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      `${fieldName} должен быть конечным числом или null.`
    );
  }
  return Object.is(value, -0) ? 0 : value;
}

function count(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      `${fieldName} должен быть неотрицательным целым числом.`
    );
  }
  return value;
}

function safeMetadata(value, fieldName = 'metadata', seen = new Set(), depth = 0) {
  if (depth > 5) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      `${fieldName} превышает безопасную глубину.`
    );
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    return text(value, fieldName, { maximum: 512 });
  }
  if (!value || typeof value !== 'object' || seen.has(value)) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      `${fieldName} содержит небезопасное значение.`
    );
  }
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (value.length > 50) {
      fail(
        'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
        `${fieldName} превышает допустимый размер.`
      );
    }
    result = value.map((item, index) =>
      safeMetadata(item, `${fieldName}[${index}]`, seen, depth + 1)
    );
  } else {
    plain(value, fieldName);
    result = {};
    const keys = Object.keys(value).sort();
    if (keys.length > 50) {
      fail(
        'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
        `${fieldName} превышает допустимый размер.`
      );
    }
    for (const key of keys) {
      if (FORBIDDEN_METADATA_KEY.test(key)) {
        fail(
          'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
          `${fieldName} содержит запрещённое поле.`
        );
      }
      result[key] = safeMetadata(
        value[key],
        `${fieldName}.${key}`,
        seen,
        depth + 1
      );
    }
  }
  seen.delete(value);
  return result;
}

function normalizeScopeSnapshot(value) {
  const source = plain(value, 'scopeSnapshot');
  return {
    displayPrimary: text(
      source.displayPrimary,
      'scopeSnapshot.displayPrimary',
      { maximum: 512, nullable: true }
    ),
    displaySecondary: text(
      source.displaySecondary,
      'scopeSnapshot.displaySecondary',
      { maximum: 512, nullable: true }
    ),
    stableItemKeyHash: fingerprint(
      source.stableItemKeyHash,
      'scopeSnapshot.stableItemKeyHash'
    ),
  };
}

function normalizeImpact(value) {
  const source = plain(value, 'impact');
  return {
    affectedRows: count(source.affectedRows, 'impact.affectedRows'),
    decisionChanges: count(
      source.decisionChanges,
      'impact.decisionChanges'
    ),
    quantityChanges: count(
      source.quantityChanges,
      'impact.quantityChanges'
    ),
    quantityBefore: finiteNumber(
      source.quantityBefore,
      'impact.quantityBefore'
    ),
    quantityAfter: finiteNumber(
      source.quantityAfter,
      'impact.quantityAfter'
    ),
    quantityDelta: finiteNumber(
      source.quantityDelta,
      'impact.quantityDelta'
    ),
    orderAmountBefore: finiteNumber(
      source.orderAmountBefore,
      'impact.orderAmountBefore'
    ),
    orderAmountAfter: finiteNumber(
      source.orderAmountAfter,
      'impact.orderAmountAfter'
    ),
    orderAmountDelta: finiteNumber(
      source.orderAmountDelta,
      'impact.orderAmountDelta'
    ),
    financialStatusBefore: text(
      source.financialStatusBefore,
      'impact.financialStatusBefore',
      { maximum: 128, nullable: true }
    ),
    financialStatusAfter: text(
      source.financialStatusAfter,
      'impact.financialStatusAfter',
      { maximum: 128, nullable: true }
    ),
    financiallyPermitted:
      typeof source.financiallyPermitted === 'boolean'
        ? source.financiallyPermitted
        : null,
  };
}

function normalizeFallback(value) {
  const source = plain(value, 'fallback');
  if (typeof source.occurred !== 'boolean') {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      'fallback.occurred должен быть boolean.'
    );
  }
  const reasonCode = text(
    source.reasonCode,
    'fallback.reasonCode',
    { maximum: 128, nullable: true }
  );
  return {
    occurred: source.occurred,
    reasonCode,
  };
}

function eventIdentity(source) {
  return hash([
    RULE_EFFECTIVENESS_SCHEMA_VERSION,
    source.runId,
    source.ruleId,
    source.registryFingerprint,
    source.runFingerprint,
    source.effectStatus,
    source.applicationMode,
  ]);
}

function normalizeEvent(value, options = {}) {
  const source = plain(value, 'event');
  if (
    source.schemaVersion !== RULE_EFFECTIVENESS_SCHEMA_VERSION
  ) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_SCHEMA_UNSUPPORTED',
      'Effectiveness event имеет неизвестную schemaVersion.'
    );
  }
  const normalized = {
    schemaVersion: RULE_EFFECTIVENESS_SCHEMA_VERSION,
    eventId: fingerprint(source.eventId, 'eventId'),
    recordedAt: isoDate(source.recordedAt, 'recordedAt'),
    runId: text(source.runId, 'runId', { maximum: 128 }),
    supplier: text(source.supplier, 'supplier', {
      maximum: 512,
      nullable: true,
    }),
    ruleId: text(source.ruleId, 'ruleId', { maximum: 128 }),
    candidateId: text(source.candidateId, 'candidateId', {
      maximum: 128,
      nullable: true,
    }),
    ruleStatus: enumValue(
      source.ruleStatus,
      ['ACTIVE', 'DISABLED'],
      'ruleStatus'
    ),
    ruleType: text(source.ruleType, 'ruleType', { maximum: 128 }),
    decision: enumValue(
      source.decision,
      ['BUY', 'SKIP', 'DEFER'],
      'decision'
    ),
    evaluationStatus: enumValue(
      source.evaluationStatus,
      EVALUATION_STATUSES,
      'evaluationStatus'
    ),
    effectStatus: enumValue(
      source.effectStatus,
      EFFECT_STATUSES,
      'effectStatus'
    ),
    scopeSnapshot: normalizeScopeSnapshot(source.scopeSnapshot),
    impact: normalizeImpact(source.impact),
    fallback: normalizeFallback(source.fallback),
    applicationMode: enumValue(
      source.applicationMode,
      ['APPLY_SAFE'],
      'applicationMode'
    ),
    registryFingerprint: fingerprint(
      source.registryFingerprint,
      'registryFingerprint'
    ),
    runFingerprint: fingerprint(
      source.runFingerprint,
      'runFingerprint'
    ),
    metadata: safeMetadata(
      source.metadata === undefined ? {} : source.metadata
    ),
  };
  if (
    normalized.effectStatus === 'FALLBACK_TO_BASELINE' &&
    normalized.fallback.occurred !== true
  ) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      'Fallback event должен иметь fallback.occurred=true.'
    );
  }
  if (
    normalized.effectStatus !== 'FALLBACK_TO_BASELINE' &&
    normalized.fallback.occurred
  ) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      'fallback.occurred допустим только для fallback event.'
    );
  }
  if (
    options.verifyId !== false &&
    normalized.eventId !== eventIdentity(normalized)
  ) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      'eventId не соответствует содержимому event.'
    );
  }
  return normalized;
}

function createRuleEffectivenessEvent(input = {}) {
  const source = structuredClone(plain(input, 'input'));
  const event = {
    schemaVersion: RULE_EFFECTIVENESS_SCHEMA_VERSION,
    eventId: '0'.repeat(64),
    recordedAt: source.recordedAt,
    runId: source.runId,
    supplier: source.supplier ?? null,
    ruleId: source.ruleId,
    candidateId: source.candidateId ?? null,
    ruleStatus: source.ruleStatus,
    ruleType: source.ruleType,
    decision: source.decision,
    evaluationStatus: source.evaluationStatus,
    effectStatus: source.effectStatus,
    scopeSnapshot: source.scopeSnapshot,
    impact: source.impact,
    fallback: source.fallback,
    applicationMode: source.applicationMode,
    registryFingerprint: source.registryFingerprint,
    runFingerprint: source.runFingerprint,
    metadata: source.metadata ?? {},
  };
  const normalized = normalizeEvent(event, { verifyId: false });
  normalized.eventId = eventIdentity(normalized);
  return normalizeEvent(normalized);
}

function emptyRuleEffectivenessEvents() {
  return {
    schemaVersion: RULE_EFFECTIVENESS_SCHEMA_VERSION,
    updatedAt: null,
    events: [],
  };
}

function validateJournal(value) {
  const source = plain(value, 'journal');
  if (
    source.schemaVersion !== RULE_EFFECTIVENESS_SCHEMA_VERSION
  ) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_SCHEMA_UNSUPPORTED',
      'Версия effectiveness journal не поддерживается.'
    );
  }
  if (!Array.isArray(source.events)) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_STORAGE_CORRUPTED',
      'Effectiveness journal events должен быть массивом.'
    );
  }
  const events = source.events.map(event => normalizeEvent(event));
  const eventIds = new Set();
  const runRuleKeys = new Set();
  for (const event of events) {
    const runRuleKey = `${event.ruleId}\0${event.runFingerprint}`;
    if (
      eventIds.has(event.eventId) ||
      runRuleKeys.has(runRuleKey)
    ) {
      fail(
        'OWNER_RULE_EFFECTIVENESS_STORAGE_CORRUPTED',
        'Effectiveness journal содержит дубли.'
      );
    }
    eventIds.add(event.eventId);
    runRuleKeys.add(runRuleKey);
  }
  return {
    schemaVersion: RULE_EFFECTIVENESS_SCHEMA_VERSION,
    updatedAt:
      source.updatedAt === null || source.updatedAt === undefined
        ? null
        : isoDate(source.updatedAt, 'updatedAt'),
    events,
  };
}

function loadRuleEffectivenessEvents({
  filePath = DEFAULT_RULE_EFFECTIVENESS_PATH,
  fsModule = fs,
} = {}) {
  const resolved = path.resolve(
    text(filePath, 'filePath', { maximum: 4096, allowPath: true })
  );
  let content;
  try {
    content = fsModule.readFileSync(resolved, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return emptyRuleEffectivenessEvents();
    fail(
      'OWNER_RULE_EFFECTIVENESS_STORAGE_CORRUPTED',
      'Effectiveness journal недоступен.',
      error
    );
  }
  try {
    return validateJournal(JSON.parse(content));
  } catch (error) {
    if (error instanceof OwnerRuleEffectivenessError) throw error;
    fail(
      'OWNER_RULE_EFFECTIVENESS_STORAGE_CORRUPTED',
      'Effectiveness journal повреждён и не был перезаписан.',
      error
    );
  }
}

function atomicWriteJournal(filePath, journal, options = {}) {
  const fsModule = options.fsModule || fs;
  const validated = validateJournal(journal);
  const resolved = path.resolve(filePath);
  const directory = path.dirname(resolved);
  const temporary = path.join(
    directory,
    `.${path.basename(resolved)}.${process.pid}-${
      options.randomSuffix || crypto.randomBytes(6).toString('hex')
    }.tmp`
  );
  let descriptor;
  try {
    fsModule.mkdirSync(directory, { recursive: true });
    descriptor = fsModule.openSync(temporary, 'wx', 0o600);
    fsModule.writeFileSync(
      descriptor,
      `${JSON.stringify(validated, null, 2)}\n`,
      'utf8'
    );
    fsModule.fsyncSync(descriptor);
    fsModule.closeSync(descriptor);
    descriptor = undefined;
    fsModule.renameSync(temporary, resolved);
    const directoryDescriptor = fsModule.openSync(directory, 'r');
    try {
      fsModule.fsyncSync(directoryDescriptor);
    } finally {
      fsModule.closeSync(directoryDescriptor);
    }
    return validated;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fsModule.closeSync(descriptor);
      } catch {}
    }
    try {
      if (fsModule.existsSync(temporary)) fsModule.unlinkSync(temporary);
    } catch {}
    fail(
      'OWNER_RULE_EFFECTIVENESS_WRITE_FAILED',
      'Не удалось атомарно сохранить effectiveness journal.',
      error
    );
  }
}

function appendRuleEffectivenessEvent({
  filePath = DEFAULT_RULE_EFFECTIVENESS_PATH,
  event,
  fsModule = fs,
  randomSuffix,
} = {}) {
  const normalized = normalizeEvent(event);
  const journal = loadRuleEffectivenessEvents({ filePath, fsModule });
  const existing = journal.events.find(item =>
    item.eventId === normalized.eventId ||
    (
      item.ruleId === normalized.ruleId &&
      item.runFingerprint === normalized.runFingerprint
    )
  );
  if (existing) {
    return { added: false, event: existing, journal };
  }
  const next = {
    schemaVersion: RULE_EFFECTIVENESS_SCHEMA_VERSION,
    updatedAt: normalized.recordedAt,
    events: [...journal.events, normalized],
  };
  return {
    added: true,
    event: normalized,
    journal: atomicWriteJournal(filePath, next, {
      fsModule,
      randomSuffix,
    }),
  };
}

function normalizeDateFilter(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = text(value, name);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      `${name} должен быть датой.`
    );
  }
  return timestamp;
}

function findRuleEffectivenessEvents({
  events,
  ruleId,
  filters = {},
} = {}) {
  if (!Array.isArray(events)) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      'events должен быть массивом.'
    );
  }
  plain(filters, 'filters');
  const normalizedRuleId = text(ruleId, 'ruleId', { maximum: 128 });
  const allowedFilters = new Set([
    'dateFrom',
    'dateTo',
    'effectStatus',
    'evaluationStatus',
    'decision',
    'ruleStatus',
  ]);
  for (const name of Object.keys(filters)) {
    if (!allowedFilters.has(name)) {
      fail(
        'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
        `Фильтр ${name} не поддерживается.`
      );
    }
  }
  const dateFrom = normalizeDateFilter(filters.dateFrom, 'dateFrom');
  const dateTo = normalizeDateFilter(filters.dateTo, 'dateTo');
  if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      'dateFrom не может быть позже dateTo.'
    );
  }
  const normalizedEnums = {
    effectStatus: filters.effectStatus === undefined
      ? null
      : enumValue(
        filters.effectStatus,
        EFFECT_STATUSES,
        'effectStatus'
      ),
    evaluationStatus: filters.evaluationStatus === undefined
      ? null
      : enumValue(
        filters.evaluationStatus,
        EVALUATION_STATUSES,
        'evaluationStatus'
      ),
    decision: filters.decision === undefined
      ? null
      : enumValue(
        filters.decision,
        ['BUY', 'SKIP', 'DEFER'],
        'decision'
      ),
    ruleStatus: filters.ruleStatus === undefined
      ? null
      : enumValue(
        filters.ruleStatus,
        ['ACTIVE', 'DISABLED'],
        'ruleStatus'
      ),
  };
  return events.flatMap(raw => {
    let event;
    try {
      event = normalizeEvent(raw);
    } catch {
      return [];
    }
    const timestamp = Date.parse(event.recordedAt);
    if (event.ruleId !== normalizedRuleId) return [];
    if (dateFrom !== null && timestamp < dateFrom) return [];
    if (dateTo !== null && timestamp > dateTo) return [];
    for (const [name, value] of Object.entries(normalizedEnums)) {
      if (value && event[name] !== value) return [];
    }
    return [event];
  }).sort((left, right) =>
    Date.parse(left.recordedAt) - Date.parse(right.recordedAt) ||
    left.eventId.localeCompare(right.eventId)
  );
}

function normalizedSummaryOptions(options = {}) {
  plain(options, 'options');
  const asOf = isoDate(options.asOf, 'options.asOf');
  const integer = (name, fallback, minimum = 1) => {
    const value = options[name] === undefined ? fallback : options[name];
    if (!Number.isInteger(value) || value < minimum) {
      fail(
        'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
        `options.${name} имеет неверное значение.`
      );
    }
    return value;
  };
  return {
    asOf,
    staleAfterDays: integer('staleAfterDays', 90),
    reviewAfterConsecutiveNoEffect: integer(
      'reviewAfterConsecutiveNoEffect',
      5
    ),
    minEvaluatedRuns: integer('minEvaluatedRuns', 3),
  };
}

function roundRate(value) {
  return value === null ? null : Number(value.toFixed(4));
}

function daysBetween(later, earlier) {
  if (!later || !earlier) return null;
  return Math.max(
    0,
    Math.floor((Date.parse(later) - Date.parse(earlier)) / 86400000)
  );
}

function getRuleEffectivenessClassification(summary, options = {}) {
  const normalized = {
    staleAfterDays: options.staleAfterDays ?? 90,
    reviewAfterConsecutiveNoEffect:
      options.reviewAfterConsecutiveNoEffect ?? 5,
    minEvaluatedRuns: options.minEvaluatedRuns ?? 3,
  };
  if (
    summary.population.fallbackRuns > 0 ||
    summary.activity.consecutiveNoEffectRuns >=
      normalized.reviewAfterConsecutiveNoEffect ||
    summary.quality.invalidEvents > 0 ||
    summary.quality.missingImpactValues > 0
  ) {
    return 'REVIEW_RECOMMENDED';
  }
  if (
    summary.effects.appliedEffectRuns > 0 &&
    summary.activity.daysSinceLastApplied >
      normalized.staleAfterDays
  ) {
    return 'STALE';
  }
  if (
    summary.population.evaluatedRuns <
      normalized.minEvaluatedRuns
  ) {
    return 'INSUFFICIENT_DATA';
  }
  if (
    summary.effects.effectRate >= 0.5 &&
    summary.population.fallbackRuns === 0
  ) {
    return 'EFFECTIVE';
  }
  if (
    summary.effects.effectRate > 0 &&
    summary.effects.effectRate < 0.5
  ) {
    return 'OCCASIONAL';
  }
  if (
    summary.effects.appliedEffectRuns === 0 &&
    (
      summary.effects.noMatchRuns > 0 ||
      summary.effects.matchedNoChangeRuns > 0
    )
  ) {
    return 'NO_EFFECT_YET';
  }
  return 'INSUFFICIENT_DATA';
}

function explanationCodes(summary) {
  const codes = [];
  const add = code => {
    if (!codes.includes(code)) codes.push(code);
  };
  if (summary.effects.appliedEffectRuns > 0) add('RULE_CHANGED_ORDER');
  if (summary.effects.matchedNoChangeRuns > 0) {
    add('RULE_MATCHED_WITHOUT_CHANGE');
  }
  if (summary.effects.noMatchRuns > 0) add('RULE_DID_NOT_MATCH');
  if (summary.effects.effectRate >= 0.5) add('RULE_EFFECT_RATE_HIGH');
  if (
    summary.effects.effectRate !== null &&
    summary.effects.effectRate < 0.5
  ) {
    add('RULE_EFFECT_RATE_LOW');
  }
  if (
    summary.population.evaluatedRuns > 0 &&
    summary.effects.appliedEffectRuns === 0
  ) {
    add('RULE_HAS_NO_EFFECT_YET');
  }
  if (summary.activity.lastAppliedAt) {
    add(
      summary.classification === 'STALE'
        ? 'RULE_LAST_EFFECT_STALE'
        : 'RULE_LAST_EFFECT_RECENT'
    );
  }
  if (summary.population.fallbackRuns > 0) {
    add('RULE_FALLBACK_OCCURRED');
  }
  if (summary.activity.consecutiveNoEffectRuns > 0) {
    add('RULE_HAS_CONSECUTIVE_NO_EFFECT');
  }
  if (
    summary.quality.invalidEvents > 0 ||
    summary.quality.missingImpactValues > 0
  ) {
    add('RULE_DATA_QUALITY_ISSUES');
  }
  if (summary.classification === 'INSUFFICIENT_DATA') {
    add('RULE_EFFECTIVENESS_INSUFFICIENT_DATA');
  }
  if (summary.classification === 'REVIEW_RECOMMENDED') {
    add('RULE_REQUIRES_MANUAL_REVIEW');
  }
  add('EFFECTIVENESS_IS_OBSERVATIONAL_ONLY');
  return codes;
}

function summarizeRuleEffectiveness({
  events,
  ruleId,
  options,
} = {}) {
  if (!Array.isArray(events)) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      'events должен быть массивом.'
    );
  }
  const normalizedRuleId = text(ruleId, 'ruleId', { maximum: 128 });
  const normalizedOptions = normalizedSummaryOptions(options);
  const valid = [];
  let invalidEvents = 0;
  let duplicateEvents = 0;
  const seenIds = new Set();
  const seenRunRules = new Set();
  for (const raw of events) {
    let event;
    try {
      event = normalizeEvent(raw);
    } catch {
      if (raw?.ruleId === normalizedRuleId) invalidEvents += 1;
      continue;
    }
    if (event.ruleId !== normalizedRuleId) continue;
    const runRuleKey = `${event.ruleId}\0${event.runFingerprint}`;
    if (
      seenIds.has(event.eventId) ||
      seenRunRules.has(runRuleKey)
    ) {
      duplicateEvents += 1;
      continue;
    }
    seenIds.add(event.eventId);
    seenRunRules.add(runRuleKey);
    valid.push(event);
  }
  valid.sort((left, right) =>
    Date.parse(left.recordedAt) - Date.parse(right.recordedAt) ||
    left.eventId.localeCompare(right.eventId)
  );
  const evaluated = valid.filter(
    event => event.evaluationStatus === 'EVALUATED'
  );
  const applied = evaluated.filter(
    event => event.effectStatus === 'APPLIED_EFFECT'
  );
  const matched = evaluated.filter(
    event => event.effectStatus === 'MATCHED_NO_CHANGE'
  );
  const noMatch = evaluated.filter(
    event => event.effectStatus === 'NO_MATCH'
  );
  const fallback = valid.filter(
    event => event.effectStatus === 'FALLBACK_TO_BASELINE'
  );
  const numericImpactFields = [
    'quantityBefore',
    'quantityAfter',
    'quantityDelta',
    'orderAmountBefore',
    'orderAmountAfter',
    'orderAmountDelta',
  ];
  const missingImpactValues = valid.reduce(
    (total, event) => total + numericImpactFields.filter(
      name => event.impact[name] === null
    ).length,
    0
  );
  const sum = (source, selector) =>
    source.reduce((total, value) => total + selector(value), 0);
  const quantityDelta = sum(
    valid,
    event => event.impact.quantityDelta ?? 0
  );
  const amountDelta = sum(
    valid,
    event => event.impact.orderAmountDelta ?? 0
  );
  let consecutiveNoEffectRuns = 0;
  for (let index = evaluated.length - 1; index >= 0; index -= 1) {
    if (evaluated[index].effectStatus === 'APPLIED_EFFECT') break;
    consecutiveNoEffectRuns += 1;
  }
  const firstEvaluatedAt = evaluated[0]?.recordedAt || null;
  const lastEvaluatedAt = evaluated.at(-1)?.recordedAt || null;
  const lastAppliedAt = applied.at(-1)?.recordedAt || null;
  const warnings = [];
  if (duplicateEvents > 0) warnings.push('DUPLICATE_EVENTS_IGNORED');
  if (invalidEvents > 0) warnings.push('INVALID_EVENTS_IGNORED');
  if (missingImpactValues > 0) {
    warnings.push('MISSING_IMPACT_VALUES');
  }
  const summary = {
    ruleId: normalizedRuleId,
    population: {
      totalEvents: valid.length,
      evaluatedRuns: evaluated.length,
      unavailableRuns: valid.filter(
        event => event.evaluationStatus === 'UNAVAILABLE'
      ).length,
      fallbackRuns: fallback.length,
    },
    effects: {
      appliedEffectRuns: applied.length,
      matchedNoChangeRuns: matched.length,
      noMatchRuns: noMatch.length,
      effectRate: evaluated.length === 0
        ? null
        : roundRate(applied.length / evaluated.length),
      matchRate: evaluated.length === 0
        ? null
        : roundRate((applied.length + matched.length) / evaluated.length),
    },
    impact: {
      totalAffectedRows: sum(valid, event => event.impact.affectedRows),
      totalDecisionChanges: sum(
        valid,
        event => event.impact.decisionChanges
      ),
      totalQuantityChanges: sum(
        valid,
        event => event.impact.quantityChanges
      ),
      totalQuantityDelta: quantityDelta,
      averageQuantityDelta: valid.length === 0
        ? null
        : quantityDelta / valid.length,
      totalOrderAmountDelta: amountDelta,
      averageOrderAmountDelta: valid.length === 0
        ? null
        : amountDelta / valid.length,
      positiveAmountDeltaRuns: valid.filter(
        event => (event.impact.orderAmountDelta ?? 0) > 0
      ).length,
      negativeAmountDeltaRuns: valid.filter(
        event => (event.impact.orderAmountDelta ?? 0) < 0
      ).length,
      zeroAmountDeltaRuns: valid.filter(
        event => event.impact.orderAmountDelta === 0
      ).length,
    },
    activity: {
      firstEvaluatedAt,
      lastEvaluatedAt,
      lastAppliedAt,
      daysSinceLastApplied: daysBetween(
        normalizedOptions.asOf,
        lastAppliedAt
      ),
      consecutiveNoEffectRuns,
    },
    quality: {
      duplicateEvents,
      invalidEvents,
      missingImpactValues,
      warnings,
    },
    classification: null,
    explanationCodes: [],
  };
  summary.classification = getRuleEffectivenessClassification(
    summary,
    normalizedOptions
  );
  summary.explanationCodes = explanationCodes(summary);
  return summary;
}

function summarizeAllRuleEffectiveness({
  events,
  options,
} = {}) {
  if (!Array.isArray(events)) {
    fail(
      'OWNER_RULE_EFFECTIVENESS_INVALID_INPUT',
      'events должен быть массивом.'
    );
  }
  const ruleIds = Array.from(new Set(events.flatMap(event =>
    typeof event?.ruleId === 'string' && event.ruleId.trim()
      ? [event.ruleId.trim()]
      : []
  ))).sort();
  return ruleIds.map(ruleId =>
    summarizeRuleEffectiveness({ events, ruleId, options })
  );
}

module.exports = {
  CLASSIFICATIONS,
  DEFAULT_RULE_EFFECTIVENESS_PATH,
  EFFECT_STATUSES,
  EVALUATION_STATUSES,
  EXPLANATION_CODES,
  RULE_EFFECTIVENESS_SCHEMA_VERSION,
  OwnerRuleEffectivenessError,
  appendRuleEffectivenessEvent,
  createRuleEffectivenessEvent,
  emptyRuleEffectivenessEvents,
  findRuleEffectivenessEvents,
  getRuleEffectivenessClassification,
  loadRuleEffectivenessEvents,
  summarizeAllRuleEffectiveness,
  summarizeRuleEffectiveness,
  validateJournal,
};
