const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MATERIALIZATION_JOURNAL_SCHEMA_VERSION =
  'owner-learning-rule-materializations-v0.9.0';
const DEFAULT_MATERIALIZATION_JOURNAL_PATH = path.resolve(
  __dirname,
  '../../../data/purchasing/owner-learning-rule-materializations.json'
);
const RESULT_STATUSES = Object.freeze([
  'CREATED',
  'ALREADY_MATERIALIZED',
]);
const RULE_STATUSES = Object.freeze(['DISABLED']);
const FORBIDDEN_METADATA_KEY =
  /(authorization|credential|password|secret|token|api[-_]?key)/i;

class OwnerRuleMaterializationJournalError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerRuleMaterializationJournalError';
    this.code = code;
  }
}

function journalError(code, message, cause) {
  return new OwnerRuleMaterializationJournalError(
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
    throw journalError(
      'RULE_MATERIALIZATION_JOURNAL_INVALID',
      `${fieldName} должен быть объектом.`
    );
  }
  return value;
}

function text(value, fieldName, maximum = 512) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > maximum
  ) {
    throw journalError(
      'RULE_MATERIALIZATION_JOURNAL_INVALID',
      `${fieldName} имеет неверное значение.`
    );
  }
  const normalized = value.trim();
  if (
    normalized.startsWith('/') ||
    normalized.startsWith('file://') ||
    /^[a-zA-Z]:[\\/]/.test(normalized)
  ) {
    throw journalError(
      'RULE_MATERIALIZATION_JOURNAL_INVALID',
      `${fieldName} содержит локальный путь.`
    );
  }
  return normalized;
}

function enumValue(value, allowed, fieldName) {
  const normalized = text(value, fieldName).toUpperCase();
  if (!allowed.includes(normalized)) {
    throw journalError(
      'RULE_MATERIALIZATION_JOURNAL_INVALID',
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
    throw journalError(
      'RULE_MATERIALIZATION_JOURNAL_INVALID',
      `${fieldName} должен быть ISO UTC datetime.`
    );
  }
  return new Date(Date.parse(normalized)).toISOString();
}

function score(value, fieldName) {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw journalError(
      'RULE_MATERIALIZATION_JOURNAL_INVALID',
      `${fieldName} должен быть целым числом от 0 до 100.`
    );
  }
  return value;
}

function safeMetadata(value, fieldName = 'metadata', seen = new Set()) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return text(value, fieldName);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) {
    throw journalError(
      'RULE_MATERIALIZATION_JOURNAL_INVALID',
      `${fieldName} содержит небезопасное значение.`
    );
  }
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((item, index) =>
      safeMetadata(item, `${fieldName}[${index}]`, seen)
    );
  } else {
    plain(value, fieldName);
    result = {};
    for (const key of Object.keys(value).sort()) {
      if (FORBIDDEN_METADATA_KEY.test(key)) {
        throw journalError(
          'RULE_MATERIALIZATION_JOURNAL_INVALID',
          `${fieldName} содержит запрещённое поле.`
        );
      }
      result[key] = safeMetadata(
        value[key],
        `${fieldName}.${key}`,
        seen
      );
    }
  }
  seen.delete(value);
  return result;
}

function normalizeSnapshot(value) {
  const source = plain(value, 'snapshot');
  return {
    patternType: text(source.patternType, 'snapshot.patternType'),
    proposedRuleType: text(
      source.proposedRuleType,
      'snapshot.proposedRuleType'
    ),
    proposedDecision: enumValue(
      source.proposedDecision,
      ['BUY', 'SKIP', 'DEFER'],
      'snapshot.proposedDecision'
    ),
    confidenceScore: score(
      source.confidenceScore,
      'snapshot.confidenceScore'
    ),
    confidenceLevel: text(
      source.confidenceLevel,
      'snapshot.confidenceLevel'
    ),
    priorityScore: score(
      source.priorityScore,
      'snapshot.priorityScore'
    ),
    priorityLevel: text(
      source.priorityLevel,
      'snapshot.priorityLevel'
    ),
  };
}

function normalizeEvent(value) {
  const source = plain(value, 'event');
  if (
    source.schemaVersion !==
      MATERIALIZATION_JOURNAL_SCHEMA_VERSION
  ) {
    throw journalError(
      'RULE_MATERIALIZATION_JOURNAL_SCHEMA_UNSUPPORTED',
      'Materialization event имеет неизвестную schemaVersion.'
    );
  }
  return {
    schemaVersion: MATERIALIZATION_JOURNAL_SCHEMA_VERSION,
    materializationId: text(
      source.materializationId,
      'materializationId',
      128
    ),
    recordedAt: isoDate(source.recordedAt, 'recordedAt'),
    candidateId: text(source.candidateId, 'candidateId', 128),
    lifecycleEventId: text(
      source.lifecycleEventId,
      'lifecycleEventId',
      128
    ),
    ruleId: text(source.ruleId, 'ruleId', 128),
    resultStatus: enumValue(
      source.resultStatus,
      RESULT_STATUSES,
      'resultStatus'
    ),
    ruleStatus: enumValue(
      source.ruleStatus,
      RULE_STATUSES,
      'ruleStatus'
    ),
    fingerprint: text(source.fingerprint, 'fingerprint', 128),
    snapshot: normalizeSnapshot(source.snapshot),
    metadata: safeMetadata(
      source.metadata === undefined ? {} : source.metadata
    ),
  };
}

function emptyMaterializationJournal() {
  return {
    schemaVersion: MATERIALIZATION_JOURNAL_SCHEMA_VERSION,
    updatedAt: null,
    events: [],
  };
}

function validateMaterializationJournal(value) {
  const source = plain(value, 'journal');
  if (
    source.schemaVersion !==
      MATERIALIZATION_JOURNAL_SCHEMA_VERSION
  ) {
    throw journalError(
      'RULE_MATERIALIZATION_JOURNAL_SCHEMA_UNSUPPORTED',
      'Materialization journal имеет неизвестную schemaVersion.'
    );
  }
  if (!Array.isArray(source.events)) {
    throw journalError(
      'RULE_MATERIALIZATION_JOURNAL_INVALID',
      'Materialization journal events должен быть массивом.'
    );
  }
  const events = source.events.map(normalizeEvent);
  const ids = new Set();
  const candidates = new Set();
  const rules = new Set();
  for (const event of events) {
    if (
      ids.has(event.materializationId) ||
      candidates.has(event.candidateId) ||
      rules.has(event.ruleId)
    ) {
      throw journalError(
        'RULE_MATERIALIZATION_JOURNAL_INVALID',
        'Materialization journal содержит дубли.'
      );
    }
    ids.add(event.materializationId);
    candidates.add(event.candidateId);
    rules.add(event.ruleId);
  }
  const updatedAt = source.updatedAt === null ||
      source.updatedAt === undefined
    ? null
    : isoDate(source.updatedAt, 'updatedAt');
  return {
    schemaVersion: MATERIALIZATION_JOURNAL_SCHEMA_VERSION,
    updatedAt,
    events,
  };
}

function loadMaterializationJournal({
  filePath = DEFAULT_MATERIALIZATION_JOURNAL_PATH,
  fsModule = fs,
} = {}) {
  let source;
  try {
    source = fsModule.readFileSync(path.resolve(filePath), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return emptyMaterializationJournal();
    throw journalError(
      'RULE_MATERIALIZATION_JOURNAL_CORRUPTED',
      'Materialization journal недоступен.',
      error
    );
  }
  try {
    return validateMaterializationJournal(JSON.parse(source));
  } catch (error) {
    if (error instanceof OwnerRuleMaterializationJournalError) throw error;
    throw journalError(
      'RULE_MATERIALIZATION_JOURNAL_CORRUPTED',
      'Materialization journal повреждён и не был перезаписан.',
      error
    );
  }
}

function writeMaterializationJournal(
  filePath,
  journal,
  { fsModule = fs, randomSuffix } = {}
) {
  const validated = validateMaterializationJournal(journal);
  const resolved = path.resolve(filePath);
  const directory = path.dirname(resolved);
  const temporary = path.join(
    directory,
    `.${path.basename(resolved)}.${process.pid}-${
      randomSuffix || crypto.randomBytes(6).toString('hex')
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
    throw journalError(
      'RULE_MATERIALIZATION_JOURNAL_WRITE_FAILED',
      'Не удалось атомарно сохранить materialization journal.',
      error
    );
  }
}

function appendMaterializationEvent({
  filePath = DEFAULT_MATERIALIZATION_JOURNAL_PATH,
  event,
  fsModule = fs,
  randomSuffix,
} = {}) {
  const normalized = normalizeEvent(event);
  const journal = loadMaterializationJournal({ filePath, fsModule });
  const existing = journal.events.find(item =>
    item.materializationId === normalized.materializationId ||
    item.candidateId === normalized.candidateId ||
    item.ruleId === normalized.ruleId
  );
  if (existing) {
    return { added: false, event: existing, journal };
  }
  const next = {
    schemaVersion: MATERIALIZATION_JOURNAL_SCHEMA_VERSION,
    updatedAt: normalized.recordedAt,
    events: [...journal.events, normalized],
  };
  return {
    added: true,
    event: normalized,
    journal: writeMaterializationJournal(filePath, next, {
      fsModule,
      randomSuffix,
    }),
  };
}

function findMaterializationByCandidate(journal, candidateId) {
  const validated = validateMaterializationJournal(journal);
  const normalized = text(candidateId, 'candidateId', 128);
  return validated.events.find(event =>
    event.candidateId === normalized
  ) || null;
}

function findMaterializationByRule(journal, ruleId) {
  const validated = validateMaterializationJournal(journal);
  const normalized = text(ruleId, 'ruleId', 128);
  return validated.events.find(event => event.ruleId === normalized) || null;
}

function summarizeMaterializations(journal) {
  const validated = validateMaterializationJournal(journal);
  return {
    totalEvents: validated.events.length,
    created: validated.events.filter(
      event => event.resultStatus === 'CREATED'
    ).length,
    repaired: validated.events.filter(
      event => event.resultStatus === 'ALREADY_MATERIALIZED'
    ).length,
    disabledRules: validated.events.filter(
      event => event.ruleStatus === 'DISABLED'
    ).length,
    firstRecordedAt: validated.events[0]?.recordedAt || null,
    lastRecordedAt: validated.events.at(-1)?.recordedAt || null,
  };
}

module.exports = {
  DEFAULT_MATERIALIZATION_JOURNAL_PATH,
  MATERIALIZATION_JOURNAL_SCHEMA_VERSION,
  OwnerRuleMaterializationJournalError,
  appendMaterializationEvent,
  emptyMaterializationJournal,
  findMaterializationByCandidate,
  findMaterializationByRule,
  loadMaterializationJournal,
  summarizeMaterializations,
  validateMaterializationJournal,
  writeMaterializationJournal,
};
