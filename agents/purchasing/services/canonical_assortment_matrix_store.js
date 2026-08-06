'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  CanonicalAssortmentMatrixError,
  validateCanonicalMatrix,
} = require('./canonical_assortment_matrix');

const DEFAULT_MATRIX_PATH = path.resolve(
  __dirname,
  '../../../data/purchasing/miska-canonical-assortment-matrix.json'
);
const DEFAULT_HISTORY_PATH = path.resolve(
  __dirname,
  '../../../data/purchasing/miska-canonical-assortment-matrix-history.json'
);

function storageError(code, message, cause) {
  return new CanonicalAssortmentMatrixError(code, message, { cause });
}

function readJson(filePath, fsModule = fs) {
  let text;
  try {
    text = fsModule.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw storageError(
      'CANONICAL_MATRIX_READ_FAILED',
      `Не удалось прочитать каноническую матрицу: ${filePath}.`,
      error
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw storageError(
      'CANONICAL_MATRIX_INVALID_JSON',
      `Файл канонической матрицы повреждён: ${filePath}.`,
      error
    );
  }
}

function loadCanonicalAssortmentMatrix(filePath = DEFAULT_MATRIX_PATH, options = {}) {
  const resolvedPath = path.resolve(filePath);
  const fsModule = options.fsModule || fs;
  const raw = readJson(resolvedPath, fsModule);
  if (raw === null) return null;
  return {
    path: resolvedPath,
    matrix: validateCanonicalMatrix(raw),
  };
}

function atomicWriteJson(filePath, value, fsModule = fs) {
  const directory = path.dirname(filePath);
  fsModule.mkdirSync(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}-${Date.now()}.tmp`
  );
  try {
    fsModule.writeFileSync(
      temporary,
      `${JSON.stringify(value, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' }
    );
    fsModule.renameSync(temporary, filePath);
  } catch (error) {
    try {
      if (fsModule.existsSync(temporary)) fsModule.unlinkSync(temporary);
    } catch {}
    throw storageError(
      'CANONICAL_MATRIX_WRITE_FAILED',
      `Не удалось сохранить каноническую матрицу: ${filePath}.`,
      error
    );
  }
}

function comparableItem(item) {
  const {
    rule_changed_at: ignoredChangedAt,
    rule_changed_by: ignoredChangedBy,
    ...comparable
  } = item;
  return comparable;
}

function sameItem(left, right) {
  return JSON.stringify(comparableItem(left)) === JSON.stringify(comparableItem(right));
}

function validateHistory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw storageError('INVALID_CANONICAL_MATRIX_HISTORY', 'История должна быть объектом.');
  }
  if (value.version !== 1 || !Array.isArray(value.entries)) {
    throw storageError(
      'INVALID_CANONICAL_MATRIX_HISTORY',
      'История должна иметь version=1 и массив entries.'
    );
  }
  return value;
}

function readHistory(historyPath, fsModule) {
  try {
    return validateHistory(readJson(historyPath, fsModule) || { version: 1, entries: [] });
  } catch (error) {
    if (error.code === 'CANONICAL_MATRIX_INVALID_JSON') throw error;
    if (error.code === 'INVALID_CANONICAL_MATRIX_HISTORY') throw error;
    return { version: 1, entries: [] };
  }
}

function updateCanonicalMatrixRule(input = {}, options = {}) {
  const fsModule = options.fsModule || fs;
  const matrixPath = path.resolve(input.matrixPath || DEFAULT_MATRIX_PATH);
  const historyPath = path.resolve(input.historyPath || DEFAULT_HISTORY_PATH);

  const loaded = loadCanonicalAssortmentMatrix(matrixPath, { fsModule });
  if (!loaded) {
    throw storageError(
      'CANONICAL_MATRIX_NOT_FOUND',
      `Каноническая матрица не найдена: ${matrixPath}.`
    );
  }

  if (typeof input.reason !== 'string' || input.reason.trim() === '') {
    throw storageError('INVALID_CANONICAL_MATRIX_CHANGE', 'reason обязателен.');
  }
  if (typeof input.changedBy !== 'string' || input.changedBy.trim() === '') {
    throw storageError('INVALID_CANONICAL_MATRIX_CHANGE', 'changed_by обязателен.');
  }

  const changedAt = input.changedAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(changedAt))) {
    throw storageError('INVALID_CANONICAL_MATRIX_CHANGE', 'changed_at должен быть ISO timestamp.');
  }

  const index = loaded.matrix.items.findIndex(
    candidate => candidate.sku_id.toUpperCase() === input.skuId.toUpperCase()
  );
  const oldValue = index === -1 ? null : loaded.matrix.items[index];
  const nextItem = validateCanonicalItem(
    { ...input.rule, rule_changed_at: changedAt, rule_changed_by: input.changedBy },
    index === -1 ? loaded.matrix.items.length : index
  );

  if (oldValue && sameItem(oldValue, nextItem)) {
    return { changed: false, matrix: loaded.matrix, historyEntry: null };
  }

  const items = [...loaded.matrix.items];
  if (index === -1) items.push(nextItem);
  else items[index] = nextItem;

  const nextMatrix = validateCanonicalMatrix({
    version: 1,
    updated_at: changedAt,
    store: loaded.matrix.store,
    active: loaded.matrix.active,
    items,
  });

  const history = readHistory(historyPath, fsModule);
  const historyEntry = {
    sku_id: nextItem.sku_id,
    old_value: oldValue,
    new_value: nextItem,
    reason: input.reason.trim(),
    changed_by: input.changedBy.trim(),
    changed_at: changedAt,
    source_run_id: input.sourceRunId || null,
  };
  const nextHistory = validateHistory({
    version: 1,
    entries: [...history.entries, historyEntry],
  });

  atomicWriteJson(matrixPath, nextMatrix, fsModule);
  atomicWriteJson(historyPath, nextHistory, fsModule);

  return { changed: true, matrix: nextMatrix, historyEntry };
}

module.exports = {
  DEFAULT_HISTORY_PATH,
  DEFAULT_MATRIX_PATH,
  atomicWriteJson,
  loadCanonicalAssortmentMatrix,
  updateCanonicalMatrixRule,
};
