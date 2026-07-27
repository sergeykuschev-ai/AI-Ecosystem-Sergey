const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PREVIEW_STORAGE_SCHEMA_VERSION =
  'owner-learning-rule-activation-previews-v0.9.2';
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const BANNED_KEYS =
  /^(?:fullOrder|workingOrder|workingOrderProducts|result|ownerComment|stableItemKey|scopeKey|evidence|evidenceIds|path|absolutePath|stack|stackTrace|secret|token)$/i;

class OwnerRuleActivationPreviewStorageError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'OwnerRuleActivationPreviewStorageError';
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new OwnerRuleActivationPreviewStorageError(
    code,
    message,
    { cause }
  );
}

function emptyActivationPreviews() {
  return {
    schemaVersion: PREVIEW_STORAGE_SCHEMA_VERSION,
    updatedAt: null,
    previews: [],
  };
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

function assertSafePayload(value, fieldName = 'impactSnapshot', depth = 0) {
  if (depth > 8) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      `${fieldName} имеет слишком глубокую структуру.`
    );
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    (
      typeof value === 'number' &&
      Number.isFinite(value)
    )
  ) {
    return;
  }
  if (typeof value === 'string') {
    if (
      value.length > 2048 ||
      value.includes('\0') ||
      value.startsWith('/') ||
      value.startsWith('file://') ||
      /^[a-zA-Z]:[\\/]/.test(value)
    ) {
      fail(
        'OWNER_RULE_STATUS_INVALID_INPUT',
        `${fieldName} содержит небезопасное значение.`
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) {
      fail(
        'OWNER_RULE_STATUS_INVALID_INPUT',
        `${fieldName} превышает допустимый размер.`
      );
    }
    value.forEach((item, index) =>
      assertSafePayload(item, `${fieldName}[${index}]`, depth + 1)
    );
    return;
  }
  if (!value || typeof value !== 'object') {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      `${fieldName} содержит неподдерживаемое значение.`
    );
  }
  for (const [name, item] of Object.entries(value)) {
    if (BANNED_KEYS.test(name)) {
      fail(
        'OWNER_RULE_STATUS_INVALID_INPUT',
        `${fieldName}.${name} запрещено хранить в preview.`
      );
    }
    assertSafePayload(item, `${fieldName}.${name}`, depth + 1);
  }
}

function normalizePreviewRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'Preview record должен быть объектом.'
    );
  }
  const targetStatus = text(value.targetStatus, 'targetStatus').toUpperCase();
  if (!['ACTIVE', 'DISABLED'].includes(targetStatus)) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'targetStatus не поддерживается.'
    );
  }
  const createdAt = isoDate(value.createdAt, 'createdAt');
  const expiresAt = isoDate(value.expiresAt, 'expiresAt');
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'expiresAt должен быть позже createdAt.'
    );
  }
  const criticalWarnings = Array.isArray(value.criticalWarnings)
    ? value.criticalWarnings.map((warning, index) =>
      text(warning, `criticalWarnings[${index}]`, 128)
    )
    : null;
  if (!criticalWarnings || criticalWarnings.length > 20) {
    fail(
      'OWNER_RULE_STATUS_INVALID_INPUT',
      'criticalWarnings должен быть ограниченным массивом.'
    );
  }
  assertSafePayload(value.impactSnapshot);
  return {
    previewId: text(value.previewId, 'previewId', 128),
    createdAt,
    expiresAt,
    ruleId: text(value.ruleId, 'ruleId', 128),
    targetStatus,
    runId: text(value.runId, 'runId', 128),
    registryFingerprint: text(
      value.registryFingerprint,
      'registryFingerprint',
      128
    ),
    runFingerprint: text(
      value.runFingerprint,
      'runFingerprint',
      128
    ),
    financiallyPermitted: value.financiallyPermitted === true,
    criticalWarnings,
    impactSnapshot: structuredClone(value.impactSnapshot),
  };
}

function validateStorage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      'RULE_ACTIVATION_PREVIEW_UNAVAILABLE',
      'Preview storage повреждено.'
    );
  }
  if (value.schemaVersion !== PREVIEW_STORAGE_SCHEMA_VERSION) {
    fail(
      'RULE_ACTIVATION_PREVIEW_UNAVAILABLE',
      'Версия preview storage не поддерживается.'
    );
  }
  if (
    value.updatedAt !== null &&
    value.updatedAt !== undefined
  ) {
    isoDate(value.updatedAt, 'updatedAt');
  }
  if (!Array.isArray(value.previews)) {
    fail(
      'RULE_ACTIVATION_PREVIEW_UNAVAILABLE',
      'Preview storage повреждено.'
    );
  }
  const previews = value.previews.map(normalizePreviewRecord);
  const ids = new Set();
  for (const preview of previews) {
    if (ids.has(preview.previewId)) {
      fail(
        'RULE_ACTIVATION_PREVIEW_UNAVAILABLE',
        'Preview storage содержит дубли.'
      );
    }
    ids.add(preview.previewId);
  }
  return {
    schemaVersion: PREVIEW_STORAGE_SCHEMA_VERSION,
    updatedAt: value.updatedAt || null,
    previews,
  };
}

function loadActivationPreviews({ filePath, fsModule = fs } = {}) {
  const resolvedPath = path.resolve(text(filePath, 'filePath', 4096));
  try {
    return validateStorage(JSON.parse(
      fsModule.readFileSync(resolvedPath, 'utf8')
    ));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyActivationPreviews();
    if (error instanceof OwnerRuleActivationPreviewStorageError) {
      throw error;
    }
    fail(
      'RULE_ACTIVATION_PREVIEW_UNAVAILABLE',
      'Preview storage повреждено и не было перезаписано.',
      error
    );
  }
}

function atomicWrite(filePath, value, fsModule) {
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
      `${JSON.stringify(value, null, 2)}\n`,
      'utf8'
    );
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
    fail(
      'RULE_ACTIVATION_PREVIEW_UNAVAILABLE',
      'Не удалось атомарно сохранить preview.',
      error
    );
  }
}

function saveActivationPreview({
  filePath,
  preview,
  now = () => new Date(),
  fsModule = fs,
} = {}) {
  const resolvedPath = path.resolve(text(filePath, 'filePath', 4096));
  const normalized = normalizePreviewRecord(preview);
  const storage = loadActivationPreviews({
    filePath: resolvedPath,
    fsModule,
  });
  const nowDate = now();
  const nowIso = (
    nowDate instanceof Date ? nowDate : new Date(nowDate)
  ).toISOString();
  const retained = storage.previews.filter(
    item =>
      Date.parse(item.expiresAt) > Date.parse(nowIso) &&
      item.previewId !== normalized.previewId
  );
  const next = {
    schemaVersion: PREVIEW_STORAGE_SCHEMA_VERSION,
    updatedAt: nowIso,
    previews: [...retained, normalized],
  };
  atomicWrite(resolvedPath, next, fsModule);
  return { added: true, storage: structuredClone(next) };
}

function getActivationPreview({
  filePath,
  previewId,
  now = () => new Date(),
  fsModule = fs,
} = {}) {
  const storage = loadActivationPreviews({ filePath, fsModule });
  const normalizedId = text(previewId, 'previewId', 128);
  const preview = storage.previews.find(
    item => item.previewId === normalizedId
  );
  if (!preview) {
    fail('PREVIEW_REQUIRED', 'Актуальный preview обязателен.');
  }
  const nowDate = now();
  const timestamp = (
    nowDate instanceof Date ? nowDate : new Date(nowDate)
  ).getTime();
  if (timestamp >= Date.parse(preview.expiresAt)) {
    fail('PREVIEW_EXPIRED', 'Preview истёк.');
  }
  return structuredClone(preview);
}

function cleanupExpiredActivationPreviews({
  filePath,
  now = () => new Date(),
  fsModule = fs,
} = {}) {
  const resolvedPath = path.resolve(text(filePath, 'filePath', 4096));
  const storage = loadActivationPreviews({
    filePath: resolvedPath,
    fsModule,
  });
  const nowDate = now();
  const nowIso = (
    nowDate instanceof Date ? nowDate : new Date(nowDate)
  ).toISOString();
  const previews = storage.previews.filter(
    item => Date.parse(item.expiresAt) > Date.parse(nowIso)
  );
  const removed = storage.previews.length - previews.length;
  if (removed > 0) {
    atomicWrite(resolvedPath, {
      schemaVersion: PREVIEW_STORAGE_SCHEMA_VERSION,
      updatedAt: nowIso,
      previews,
    }, fsModule);
  }
  return { removed, retained: previews.length };
}

module.exports = {
  PREVIEW_STORAGE_SCHEMA_VERSION,
  PREVIEW_TTL_MS,
  OwnerRuleActivationPreviewStorageError,
  cleanupExpiredActivationPreviews,
  emptyActivationPreviews,
  getActivationPreview,
  loadActivationPreviews,
  normalizePreviewRecord,
  saveActivationPreview,
};
