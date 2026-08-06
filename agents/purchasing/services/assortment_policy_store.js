'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  AssortmentPolicyError,
  normalizeSku,
  validateAssortmentPolicyRule,
  validateAssortmentPolicyStore,
} = require('./assortment_policy');
const {
  toAssortmentPolicyRule,
} = require('./canonical_assortment_matrix');
const {
  loadCanonicalAssortmentMatrix,
} = require('./canonical_assortment_matrix_store');

const DEFAULT_POLICY_PATH = path.resolve(
  __dirname,
  '../../../data/purchasing/miska-assortment-policy.json'
);
const DEFAULT_HISTORY_PATH = path.resolve(
  __dirname,
  '../../../data/purchasing/miska-assortment-policy-history.json'
);
const DEFAULT_CANONICAL_MATRIX_PATH = path.resolve(
  __dirname,
  '../../../data/purchasing/miska-canonical-assortment-matrix.json'
);

function storageError(code, message, cause) {
  return new AssortmentPolicyError(code, message, { cause });
}

function readJson(filePath, fsModule = fs) {
  let text;
  try {
    text = fsModule.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw storageError(
      error.code === 'ENOENT' ? 'ASSORTMENT_POLICY_NOT_FOUND' : 'ASSORTMENT_POLICY_READ_FAILED',
      `Не удалось прочитать assortment policy: ${filePath}.`,
      error
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw storageError(
      'ASSORTMENT_POLICY_INVALID_JSON',
      `Файл assortment policy повреждён: ${filePath}.`,
      error
    );
  }
}

function loadAssortmentPolicy(filePath = DEFAULT_POLICY_PATH, options = {}) {
  const resolvedPath = path.resolve(filePath);
  const value = readJson(resolvedPath, options.fsModule || fs);
  return {
    path: resolvedPath,
    store: validateAssortmentPolicyStore(value),
  };
}

function validateHistory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw storageError('INVALID_ASSORTMENT_POLICY_HISTORY', 'История assortment policy должна быть объектом.');
  }
  if (value.version !== 1 || !Array.isArray(value.entries)) {
    throw storageError('INVALID_ASSORTMENT_POLICY_HISTORY', 'История assortment policy должна иметь version=1 и массив entries.');
  }
  return value;
}

function atomicWriteJson(filePath, value, fsModule = fs) {
  const directory = path.dirname(filePath);
  fsModule.mkdirSync(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}-${Date.now()}.tmp`
  );
  try {
    fsModule.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    fsModule.renameSync(temporary, filePath);
  } catch (error) {
    try {
      if (fsModule.existsSync(temporary)) fsModule.unlinkSync(temporary);
    } catch {}
    throw storageError('ASSORTMENT_POLICY_WRITE_FAILED', `Не удалось сохранить assortment policy: ${filePath}.`, error);
  }
}

function comparableRule(rule) {
  const { updated_at: ignored, ...comparable } = rule;
  return comparable;
}

function sameRule(left, right) {
  return JSON.stringify(comparableRule(left)) === JSON.stringify(comparableRule(right));
}

function updateAssortmentPolicyRule(input = {}, options = {}) {
  const fsModule = options.fsModule || fs;
  const policyPath = path.resolve(input.policyPath || DEFAULT_POLICY_PATH);
  const historyPath = path.resolve(input.historyPath || DEFAULT_HISTORY_PATH);
  const loaded = loadAssortmentPolicy(policyPath, { fsModule });
  const rule = validateAssortmentPolicyRule(input.rule);
  if (typeof input.reason !== 'string' || input.reason.trim() === '') {
    throw storageError('INVALID_ASSORTMENT_POLICY_CHANGE', 'reason обязателен для изменения assortment policy.');
  }
  if (typeof input.changedBy !== 'string' || input.changedBy.trim() === '') {
    throw storageError('INVALID_ASSORTMENT_POLICY_CHANGE', 'changed_by обязателен для изменения assortment policy.');
  }
  const changedAt = input.changedAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(changedAt))) {
    throw storageError('INVALID_ASSORTMENT_POLICY_CHANGE', 'changed_at должен содержать ISO timestamp.');
  }
  const index = loaded.store.rules.findIndex(
    candidate => normalizeSku(candidate.sku) === normalizeSku(rule.sku)
  );
  const oldValue = index === -1 ? null : loaded.store.rules[index];
  if (oldValue && sameRule(oldValue, rule)) {
    return { changed: false, store: loaded.store, historyEntry: null };
  }
  const nextRule = { ...rule, updated_at: changedAt };
  const rules = [...loaded.store.rules];
  if (index === -1) rules.push(nextRule);
  else rules[index] = nextRule;
  const nextStore = validateAssortmentPolicyStore({
    version: 1,
    updated_at: changedAt,
    rules,
  });
  let history;
  try {
    history = validateHistory(readJson(historyPath, fsModule));
  } catch (error) {
    if (error.code !== 'ASSORTMENT_POLICY_NOT_FOUND') throw error;
    history = { version: 1, updated_at: changedAt, entries: [] };
  }
  const historyEntry = {
    sku: nextRule.sku,
    old_value: oldValue,
    new_value: nextRule,
    reason: input.reason.trim(),
    changed_by: input.changedBy.trim(),
    changed_at: changedAt,
    source_run_id: input.sourceRunId || null,
  };
  const nextHistory = validateHistory({
    version: 1,
    updated_at: changedAt,
    entries: [...history.entries, historyEntry],
  });
  atomicWriteJson(policyPath, nextStore, fsModule);
  atomicWriteJson(historyPath, nextHistory, fsModule);
  return { changed: true, store: nextStore, historyEntry };
}

function loadAssortmentPolicySource(options = {}) {
  const fsModule = options.fsModule || fs;
  const canonicalPath = options.canonicalPath || DEFAULT_CANONICAL_MATRIX_PATH;
  const legacyPath = options.legacyPath || DEFAULT_POLICY_PATH;

  const canonical = loadCanonicalAssortmentMatrix(canonicalPath, { fsModule });
  if (canonical && canonical.matrix.active !== false) {
    return {
      path: canonical.path,
      source: 'canonical-matrix',
      store: {
        schema_version: canonical.matrix.schema_version,
        version: 1,
        updated_at: canonical.matrix.updated_at,
        rules: canonical.matrix.items.map(toAssortmentPolicyRule),
      },
    };
  }

  const legacy = loadAssortmentPolicy(legacyPath, { fsModule });
  return {
    path: legacy.path,
    source: 'legacy-policy',
    store: legacy.store,
  };
}

module.exports = {
  DEFAULT_CANONICAL_MATRIX_PATH,
  DEFAULT_HISTORY_PATH,
  DEFAULT_POLICY_PATH,
  atomicWriteJson,
  loadAssortmentPolicy,
  loadAssortmentPolicySource,
  sameRule,
  updateAssortmentPolicyRule,
  validateHistory,
};
