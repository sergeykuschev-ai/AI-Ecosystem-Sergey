const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeAgentRecommendation,
} = require('./owner_learning_report');

const HISTORY_SCHEMA_VERSION = 'owner-decision-history-v0.7.1';
const DEFAULT_HISTORY_PATH = path.resolve(
  __dirname,
  '../../../data/purchasing/owner-decision-history.json'
);
const DECISION_ID_PREFIX = 'owner-decision-';
const SOURCES = Object.freeze([
  'OWNER_REVIEW',
  'APPROVED_RULE',
  'MANUAL_OVERRIDE',
  'IMPORTED_HISTORY',
]);
const OWNER_DECISIONS = Object.freeze([
  'BUY',
  'SKIP',
  'DEFER',
  'REVIEW',
]);
const OWNER_REVIEW_REASON_CODES = Object.freeze([
  'HIGH_STOCK',
  'LOW_DEMAND',
  'SEASONAL',
  'MANDATORY',
  'NEW_PRODUCT',
  'CUSTOMER_REQUEST',
  'MINMAX_ERROR',
  'POLICY_ERROR',
  'ALREADY_ORDERED',
  'WAIT_NEXT_DELIVERY',
  'TEST_PRODUCT',
  'SUPPLIER_LIMITATION',
  'PRICE_TOO_HIGH',
  'LOW_MARGIN',
  'MANUAL_EXPERIENCE',
  'OTHER',
]);
const LEGACY_REASON_CODES = Object.freeze([
  'TOO_MUCH_STOCK',
  'LOW_SALES',
  'STRATEGIC_ITEM',
  'REQUIRED_ASSORTMENT',
  'SEASONAL',
  'SUPPLIER_CONSTRAINT',
  'PRICE_TOO_HIGH',
  'OWNER_EXPERIENCE',
  'OTHER',
  'NOT_SPECIFIED',
]);
const REASON_CODES = Object.freeze(Array.from(new Set([
  ...OWNER_REVIEW_REASON_CODES,
  ...LEGACY_REASON_CODES,
])));
const APPLICATION_MODES = Object.freeze([
  'OFF',
  'PREVIEW',
  'APPLY_SAFE',
]);
const FORBIDDEN_METADATA_KEY =
  /(authorization|credential|password|secret|token|api[-_]?key)/i;

class OwnerDecisionHistoryError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerDecisionHistoryError';
    this.code = code;
  }
}

function historyError(code, message) {
  return new OwnerDecisionHistoryError(code, message);
}

function optionalString(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw historyError(
      'DECISION_HISTORY_ENTRY_INVALID',
      `Owner Decision History: ${fieldName} должен быть строкой.`
    );
  }
  const normalized = value.trim();
  if (normalized === '') return null;
  if (
    normalized.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(normalized) ||
    normalized.startsWith('file://')
  ) {
    throw historyError(
      'DECISION_HISTORY_UNSAFE_DATA',
      `Owner Decision History: ${fieldName} содержит локальный путь.`
    );
  }
  return normalized;
}

function requiredString(value, fieldName) {
  const normalized = optionalString(value, fieldName);
  if (!normalized) {
    throw historyError(
      'DECISION_HISTORY_ENTRY_INVALID',
      `Owner Decision History: ${fieldName} обязателен.`
    );
  }
  return normalized;
}

function normalizedEnum(value, values, fieldName, {
  optional = false,
  defaultValue = null,
} = {}) {
  const normalized = optionalString(value, fieldName)?.toUpperCase() ||
    defaultValue;
  if (normalized === null && optional) return null;
  if (!values.includes(normalized)) {
    throw historyError(
      'DECISION_HISTORY_ENTRY_INVALID',
      `Owner Decision History: ${fieldName} содержит неизвестное значение.`
    );
  }
  return normalized;
}

function requiredIsoDate(value, fieldName) {
  const normalized = requiredString(value, fieldName);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw historyError(
      'DECISION_HISTORY_ENTRY_INVALID',
      `Owner Decision History: ${fieldName} должен быть ISO-датой.`
    );
  }
  return normalized;
}

function optionalNonNegativeNumber(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw historyError(
      'DECISION_HISTORY_ENTRY_INVALID',
      `Owner Decision History: ${fieldName} должен быть неотрицательным числом.`
    );
  }
  return value;
}

function plainObject(value, fieldName) {
  if (value === null || value === undefined) return {};
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw historyError(
      'DECISION_HISTORY_ENTRY_INVALID',
      `Owner Decision History: ${fieldName} должен быть объектом.`
    );
  }
  return value;
}

function safeMetadataValue(value, fieldName, seen = new Set()) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return optionalString(value, fieldName);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw historyError(
        'DECISION_HISTORY_UNSAFE_DATA',
        `Owner Decision History: ${fieldName} содержит некорректное число.`
      );
    }
    return value;
  }
  if (typeof value !== 'object' || value === undefined) {
    throw historyError(
      'DECISION_HISTORY_UNSAFE_DATA',
      `Owner Decision History: ${fieldName} содержит несериализуемое значение.`
    );
  }
  if (seen.has(value)) {
    throw historyError(
      'DECISION_HISTORY_UNSAFE_DATA',
      `Owner Decision History: ${fieldName} содержит циклическую ссылку.`
    );
  }
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((item, index) =>
      safeMetadataValue(item, `${fieldName}[${index}]`, seen)
    );
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw historyError(
        'DECISION_HISTORY_UNSAFE_DATA',
        `Owner Decision History: ${fieldName} содержит небезопасный объект.`
      );
    }
    result = {};
    for (const key of Object.keys(value).sort()) {
      if (FORBIDDEN_METADATA_KEY.test(key)) {
        throw historyError(
          'DECISION_HISTORY_UNSAFE_DATA',
          'Owner Decision History: metadata содержит запрещённое поле.'
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

function normalizeAgentState(value) {
  if (value === null || value === undefined) return null;
  const source = requiredString(value, 'agentRecommendation');
  const normalized = normalizeAgentRecommendation(source);
  if (!normalized) {
    throw historyError(
      'DECISION_HISTORY_ENTRY_INVALID',
      'Owner Decision History: agentRecommendation не поддерживается.'
    );
  }
  return normalized;
}

function normalizeFinancialContext(value) {
  const context = plainObject(value, 'financialContext');
  return {
    analyzerOrderAmount: optionalNonNegativeNumber(
      context.analyzerOrderAmount,
      'financialContext.analyzerOrderAmount'
    ),
    workingOrderAmount: optionalNonNegativeNumber(
      context.workingOrderAmount,
      'financialContext.workingOrderAmount'
    ),
    appliedWorkingOrderAmount: optionalNonNegativeNumber(
      context.appliedWorkingOrderAmount,
      'financialContext.appliedWorkingOrderAmount'
    ),
    financialStatus: optionalString(
      context.financialStatus,
      'financialContext.financialStatus'
    )?.toUpperCase() || null,
    currency: optionalString(
      context.currency,
      'financialContext.currency'
    )?.toUpperCase() || null,
  };
}

function normalizeInventoryContext(value) {
  const context = plainObject(value, 'inventoryContext');
  return {
    freeStock: optionalNonNegativeNumber(
      context.freeStock,
      'inventoryContext.freeStock'
    ),
    reserve: optionalNonNegativeNumber(
      context.reserve,
      'inventoryContext.reserve'
    ),
    incomingQuantity: optionalNonNegativeNumber(
      context.incomingQuantity,
      'inventoryContext.incomingQuantity'
    ),
    daysOfStock: optionalNonNegativeNumber(
      context.daysOfStock,
      'inventoryContext.daysOfStock'
    ),
  };
}

function normalizeSalesContext(value) {
  const context = plainObject(value, 'salesContext');
  return {
    sales7d: optionalNonNegativeNumber(
      context.sales7d,
      'salesContext.sales7d'
    ),
    sales14d: optionalNonNegativeNumber(
      context.sales14d,
      'salesContext.sales14d'
    ),
    sales30d: optionalNonNegativeNumber(
      context.sales30d,
      'salesContext.sales30d'
    ),
    averageDailySales: optionalNonNegativeNumber(
      context.averageDailySales,
      'salesContext.averageDailySales'
    ),
  };
}

function decisionIdPayload(entry) {
  const payload = [
    entry.schemaVersion,
    entry.recordedAt,
    entry.source,
    entry.runId,
    entry.stableItemKey,
    entry.ownerDecision,
    entry.ownerQuantity,
    entry.ruleId,
    entry.applicationMode,
  ];
  if (entry.decidedBy !== null) {
    payload.push(
      entry.decidedBy,
      entry.reasonCode,
      entry.ownerComment
    );
  }
  return payload;
}

function buildDecisionId(entry) {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(decisionIdPayload(entry)), 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `${DECISION_ID_PREFIX}${digest}`;
}

function createDecisionHistoryEntry(input = {}) {
  const source = plainObject(input, 'input');
  const entry = {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    decisionId: null,
    recordedAt: requiredIsoDate(source.recordedAt, 'recordedAt'),
    source: normalizedEnum(source.source, SOURCES, 'source'),
    runId: optionalString(source.runId, 'runId'),
    supplier: optionalString(source.supplier, 'supplier'),
    stableItemKey: requiredString(
      source.stableItemKey,
      'stableItemKey'
    ),
    sku: optionalString(source.sku, 'sku'),
    productName: optionalString(source.productName, 'productName'),
    brand: optionalString(source.brand, 'brand'),
    category: optionalString(source.category, 'category'),
    agentRecommendation: normalizeAgentState(
      source.agentRecommendation
    ),
    agentQuantity: optionalNonNegativeNumber(
      source.agentQuantity,
      'agentQuantity'
    ),
    ownerDecision: normalizedEnum(
      source.ownerDecision,
      OWNER_DECISIONS,
      'ownerDecision'
    ),
    ownerQuantity: optionalNonNegativeNumber(
      source.ownerQuantity,
      'ownerQuantity'
    ),
    decidedBy: optionalString(source.decidedBy, 'decidedBy'),
    reasonCode: normalizedEnum(
      source.reasonCode,
      REASON_CODES,
      'reasonCode',
      { defaultValue: 'NOT_SPECIFIED' }
    ),
    ownerComment: optionalString(source.ownerComment, 'ownerComment'),
    ruleId: optionalString(source.ruleId, 'ruleId'),
    applicationMode: normalizedEnum(
      source.applicationMode,
      APPLICATION_MODES,
      'applicationMode',
      { optional: true }
    ),
    financialContext: normalizeFinancialContext(
      source.financialContext
    ),
    inventoryContext: normalizeInventoryContext(
      source.inventoryContext
    ),
    salesContext: normalizeSalesContext(source.salesContext),
    metadata: safeMetadataValue(
      plainObject(source.metadata, 'metadata'),
      'metadata'
    ),
  };
  entry.decisionId = buildDecisionId(entry);
  return entry;
}

function emptyDecisionHistory() {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    updatedAt: null,
    entries: [],
  };
}

function validateDecisionHistoryEntry(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw historyError(
      'DECISION_HISTORY_INVALID',
      'Owner Decision History содержит некорректную запись.'
    );
  }
  if (value.schemaVersion !== HISTORY_SCHEMA_VERSION) {
    throw historyError(
      'DECISION_HISTORY_SCHEMA_UNSUPPORTED',
      'Owner Decision History entry имеет неизвестную schemaVersion.'
    );
  }
  const normalized = createDecisionHistoryEntry(value);
  if (value.decisionId !== normalized.decisionId) {
    throw historyError(
      'DECISION_HISTORY_INVALID',
      'Owner Decision History содержит некорректный decisionId.'
    );
  }
  return normalized;
}

function validateDecisionHistory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw historyError(
      'DECISION_HISTORY_INVALID',
      'Owner Decision History должен быть объектом.'
    );
  }
  if (value.schemaVersion !== HISTORY_SCHEMA_VERSION) {
    throw historyError(
      'DECISION_HISTORY_SCHEMA_UNSUPPORTED',
      'Owner Decision History имеет неизвестную schemaVersion.'
    );
  }
  if (!Array.isArray(value.entries)) {
    throw historyError(
      'DECISION_HISTORY_INVALID',
      'Owner Decision History: entries должен быть массивом.'
    );
  }
  const updatedAt = value.updatedAt === null ||
    value.updatedAt === undefined
    ? null
    : requiredIsoDate(value.updatedAt, 'updatedAt');
  const entries = value.entries.map(validateDecisionHistoryEntry);
  const decisionIds = new Set();
  for (const entry of entries) {
    if (decisionIds.has(entry.decisionId)) {
      throw historyError(
        'DECISION_HISTORY_INVALID',
        'Owner Decision History содержит повторный decisionId.'
      );
    }
    decisionIds.add(entry.decisionId);
  }
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    updatedAt,
    entries,
  };
}

function logHistoryError(error, logger = console) {
  if (typeof logger?.error === 'function') {
    logger.error(
      `[${error.code || 'DECISION_HISTORY_ERROR'}] ` +
      'Owner Decision History недоступен.'
    );
  }
}

function loadDecisionHistory({
  filePath = DEFAULT_HISTORY_PATH,
  fsModule = fs,
  logger = console,
} = {}) {
  const resolvedPath = path.resolve(filePath);
  let source;
  try {
    source = fsModule.readFileSync(resolvedPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return emptyDecisionHistory();
    const wrapped = new OwnerDecisionHistoryError(
      'DECISION_HISTORY_READ_FAILED',
      'Не удалось прочитать Owner Decision History.',
      { cause: error }
    );
    logHistoryError(wrapped, logger);
    throw wrapped;
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const wrapped = new OwnerDecisionHistoryError(
      'DECISION_HISTORY_CORRUPTED',
      'Owner Decision History повреждён и не был перезаписан.',
      { cause: error }
    );
    logHistoryError(wrapped, logger);
    throw wrapped;
  }
  try {
    return validateDecisionHistory(parsed);
  } catch (error) {
    logHistoryError(error, logger);
    throw error;
  }
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

function atomicWriteDecisionHistory(
  filePath,
  history,
  options = {}
) {
  const fsModule = options.fsModule || fs;
  const validated = validateDecisionHistory(history);
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
    if (error instanceof OwnerDecisionHistoryError) throw error;
    throw new OwnerDecisionHistoryError(
      'DECISION_HISTORY_WRITE_FAILED',
      'Не удалось атомарно сохранить Owner Decision History.',
      { cause: error }
    );
  }
}

function latestIsoDate(left, right) {
  if (!left) return right;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function appendDecisionHistoryEntry({
  filePath = DEFAULT_HISTORY_PATH,
  entry,
  fsModule = fs,
  logger = console,
  randomSuffix,
} = {}) {
  const normalizedEntry = validateDecisionHistoryEntry(entry);
  const history = loadDecisionHistory({
    filePath,
    fsModule,
    logger,
  });
  const existing = history.entries.find(
    item => item.decisionId === normalizedEntry.decisionId
  );
  if (existing) {
    return {
      added: false,
      entry: existing,
      history,
    };
  }
  const nextHistory = {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    updatedAt: latestIsoDate(
      history.updatedAt,
      normalizedEntry.recordedAt
    ),
    entries: [...history.entries, normalizedEntry],
  };
  const saved = atomicWriteDecisionHistory(
    filePath,
    nextHistory,
    { fsModule, randomSuffix }
  );
  return {
    added: true,
    entry: normalizedEntry,
    history: saved,
  };
}

function findDecisionHistoryByStableItemKey({
  history,
  stableItemKey,
} = {}) {
  const validated = validateDecisionHistory(
    history || emptyDecisionHistory()
  );
  const key = requiredString(stableItemKey, 'stableItemKey');
  return validated.entries.filter(entry =>
    entry.stableItemKey === key
  );
}

function emptyCounts(values) {
  return Object.fromEntries(values.map(value => [value, 0]));
}

function summarizeDecisionHistory(history) {
  const validated = validateDecisionHistory(
    history || emptyDecisionHistory()
  );
  const decisionsByType = emptyCounts(OWNER_DECISIONS);
  const decisionsByReason = emptyCounts(REASON_CODES);
  const decisionsBySource = emptyCounts(SOURCES);
  const itemCounts = new Map();
  let firstRecordedAt = null;
  let lastRecordedAt = null;
  for (const entry of validated.entries) {
    decisionsByType[entry.ownerDecision] += 1;
    decisionsByReason[entry.reasonCode] += 1;
    decisionsBySource[entry.source] += 1;
    itemCounts.set(
      entry.stableItemKey,
      (itemCounts.get(entry.stableItemKey) || 0) + 1
    );
    if (
      firstRecordedAt === null ||
      Date.parse(entry.recordedAt) < Date.parse(firstRecordedAt)
    ) {
      firstRecordedAt = entry.recordedAt;
    }
    if (
      lastRecordedAt === null ||
      Date.parse(entry.recordedAt) > Date.parse(lastRecordedAt)
    ) {
      lastRecordedAt = entry.recordedAt;
    }
  }
  const itemsWithRepeatedDecisions = Array.from(itemCounts)
    .filter(([, count]) => count > 1)
    .map(([stableItemKey, decisionsCount]) => ({
      stableItemKey,
      decisionsCount,
    }))
    .sort((left, right) =>
      left.stableItemKey.localeCompare(
        right.stableItemKey,
        'ru'
      )
    );
  return {
    totalEntries: validated.entries.length,
    uniqueItems: itemCounts.size,
    decisionsByType,
    decisionsByReason,
    decisionsBySource,
    itemsWithRepeatedDecisions,
    firstRecordedAt,
    lastRecordedAt,
  };
}

module.exports = {
  APPLICATION_MODES,
  DEFAULT_HISTORY_PATH,
  HISTORY_SCHEMA_VERSION,
  OWNER_DECISIONS,
  OWNER_REVIEW_REASON_CODES,
  REASON_CODES,
  SOURCES,
  OwnerDecisionHistoryError,
  appendDecisionHistoryEntry,
  atomicWriteDecisionHistory,
  buildDecisionId,
  createDecisionHistoryEntry,
  emptyDecisionHistory,
  findDecisionHistoryByStableItemKey,
  loadDecisionHistory,
  summarizeDecisionHistory,
  validateDecisionHistory,
  validateDecisionHistoryEntry,
};
