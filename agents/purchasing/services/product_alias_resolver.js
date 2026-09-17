'use strict';

// Confirmed supplier-product alias layer.
//
// Aliases live OUTSIDE the canonical assortment matrix
// (data/purchasing/miska-product-aliases.json) so that the matrix itself is
// never extended with unapproved items. Only aliases with
// status "confirmed" are applied automatically; "proposed" aliases are kept
// for the owner's decision and never affect matching.
//
// Safety invariants enforced here and in the matcher:
// - an alias is scoped to one supplier (compared via canonicalSupplierName,
//   so writing variants of the Валта legal name is safe);
// - one external identifier resolves to exactly one canonical SKU;
// - the alias's external identifier must be unique within the report rows,
//   so a duplicated article (e.g. Мнямс 34002 shared by several products)
//   can never be auto-resolved by an article alias;
// - the alias target must exist in the loaded matrix exactly once;
// - a weaker match never overrides a strong-identifier ambiguity: the alias
//   pass only fills rows the article/name passes left unmatched, and an
//   article-typed alias is skipped when the article is duplicated in rows.

const fs = require('node:fs');
const path = require('node:path');
const { canonicalSupplierName } = require('./demand_engine');
const { normalize } = require('../parsers/minmax_parser');

const ALIAS_SCHEMA_VERSION = 1;
const DEFAULT_ALIAS_PATH = path.resolve(
  __dirname,
  '../../../data/purchasing/miska-product-aliases.json'
);

const ALIAS_STATUSES = Object.freeze(['confirmed', 'proposed']);
const EXTERNAL_ID_TYPES = Object.freeze([
  'barcode',
  'internalProductId',
  'supplierSku',
  'article',
  'productName',
]);

class ProductAliasError extends Error {
  constructor(message, code, cause = null) {
    super(message);
    this.name = 'ProductAliasError';
    this.code = code;
    this.cause = cause;
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validateAliasRecord(record, index) {
  const where = `alias[${index}]`;
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new ProductAliasError(`${where} должен быть объектом.`, 'INVALID_ALIAS_RECORD');
  }
  if (!nonEmptyString(record.supplier)) {
    throw new ProductAliasError(`${where}.supplier обязателен.`, 'INVALID_ALIAS_SUPPLIER');
  }
  if (!EXTERNAL_ID_TYPES.includes(record.externalIdType)) {
    throw new ProductAliasError(
      `${where}.externalIdType должен быть одним из: ${EXTERNAL_ID_TYPES.join(', ')}.`,
      'INVALID_ALIAS_ID_TYPE'
    );
  }
  if (!nonEmptyString(record.externalId)) {
    throw new ProductAliasError(`${where}.externalId обязателен.`, 'INVALID_ALIAS_ID');
  }
  if (!nonEmptyString(record.canonicalSkuId)) {
    throw new ProductAliasError(`${where}.canonicalSkuId обязателен.`, 'INVALID_ALIAS_TARGET');
  }
  if (!nonEmptyString(record.canonicalName)) {
    throw new ProductAliasError(`${where}.canonicalName обязателен.`, 'INVALID_ALIAS_TARGET_NAME');
  }
  if (!nonEmptyString(record.source)) {
    throw new ProductAliasError(`${where}.source обязателен.`, 'INVALID_ALIAS_SOURCE');
  }
  if (!Array.isArray(record.evidence) || record.evidence.length === 0 ||
      record.evidence.some(entry => !nonEmptyString(entry))) {
    throw new ProductAliasError(
      `${where}.evidence должен быть непустым массивом строк.`,
      'INVALID_ALIAS_EVIDENCE'
    );
  }
  if (!ALIAS_STATUSES.includes(record.status)) {
    throw new ProductAliasError(
      `${where}.status должен быть "confirmed" или "proposed".`,
      'INVALID_ALIAS_STATUS'
    );
  }
  if (!nonEmptyString(record.createdAt) || Number.isNaN(Date.parse(record.createdAt))) {
    throw new ProductAliasError(
      `${where}.createdAt должен быть валидной ISO-датой.`,
      'INVALID_ALIAS_CREATED_AT'
    );
  }
}

function loadProductAliases(filePath = DEFAULT_ALIAS_PATH) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return {
      schemaVersion: ALIAS_SCHEMA_VERSION,
      store: null,
      sourcePath: resolved,
      aliases: [],
      diagnostics: [{ code: 'ALIAS_FILE_NOT_FOUND', message: `Файл алиасов не найден: ${resolved}` }],
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new ProductAliasError(
      `Файл алиасов «${resolved}» содержит некорректный JSON: ${error.message}.`,
      'INVALID_ALIAS_JSON',
      error
    );
  }
  const aliases = parsed.aliases;
  if (!Array.isArray(aliases)) {
    throw new ProductAliasError(
      `Файл алиасов «${resolved}» должен содержать массив "aliases".`,
      'INVALID_ALIAS_SCHEMA'
    );
  }
  aliases.forEach(validateAliasRecord);
  return {
    schemaVersion: ALIAS_SCHEMA_VERSION,
    store: parsed.store || null,
    sourcePath: resolved,
    aliases,
    diagnostics: [],
  };
}

function normalizeAliasIdentifierValue(externalIdType, value) {
  if (value === null || value === undefined) return '';
  if (externalIdType === 'productName') {
    return normalize(value)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return String(value).trim();
}

function aliasExternalKey(record) {
  return `${record.externalIdType}:${canonicalSupplierName(record.supplier)}:` +
    `${normalizeAliasIdentifierValue(record.externalIdType, record.externalId)}`;
}

function aliasTargetKey(record) {
  return String(record.canonicalSkuId).trim();
}

// Conflicting aliases (same external identifier pointing at different
// canonical SKUs, or the same canonical SKU claimed by contradictory records)
// are excluded from the index and reported; they can never auto-apply.
function buildAliasIndex(aliasData) {
  const data = aliasData || { aliases: [] };
  const diagnostics = [...(data.diagnostics || [])];
  const byExternal = new Map();
  for (const record of data.aliases || []) {
    const key = aliasExternalKey(record);
    if (!byExternal.has(key)) byExternal.set(key, []);
    byExternal.get(key).push(record);
  }
  const confirmedByExternal = new Map();
  const proposedByExternal = new Map();
  for (const [key, records] of byExternal.entries()) {
    const targets = new Set(records.map(aliasTargetKey));
    if (targets.size > 1) {
      diagnostics.push({
        code: 'ALIAS_CONFLICT',
        externalKey: key,
        targets: [...targets],
        message: 'Внешний идентификатор указывает на несколько canonical SKU; алиасы исключены.',
      });
      continue;
    }
    const confirmed = records.filter(record => record.status === 'confirmed');
    const proposed = records.filter(record => record.status === 'proposed');
    if (confirmed.length > 0) confirmedByExternal.set(key, confirmed[0]);
    if (proposed.length > 0 && confirmed.length === 0) proposedByExternal.set(key, proposed[0]);
  }
  return {
    confirmedByExternal,
    proposedByExternal,
    diagnostics,
    size: confirmedByExternal.size,
  };
}

function rowExternalId(row, externalIdType) {
  const hints = row.matchingHints || {};
  if (externalIdType === 'barcode') return hints.barcode || null;
  if (externalIdType === 'internalProductId') return hints.internalProductId || null;
  if (externalIdType === 'supplierSku') return hints.supplierSku || row.supplierSku || null;
  if (externalIdType === 'productName') return row.name || null;
  return row.article || null;
}

// Resolves a confirmed alias for a report row.
// `identifierCounts` maps "type:value" (normalized) -> number of rows carrying
// that identifier; the matcher builds it over all rows. An alias whose
// external identifier is not unique across the report is not applied.
// `matrixItemsByAliasTarget` must contain the alias target exactly once.
function resolveConfirmedAlias(index, row, identifierCounts, matrixItemsByAliasTarget) {
  if (!index || !row) return null;
  const supplierKey = canonicalSupplierName(row.supplier);
  for (const idType of EXTERNAL_ID_TYPES) {
    const value = rowExternalId(row, idType);
    if (!nonEmptyString(String(value || ''))) continue;
    const normalizedValue = normalizeAliasIdentifierValue(idType, value);
    if (!normalizedValue) continue;
    const key = `${idType}:${supplierKey}:${normalizedValue}`;
    const record = index.confirmedByExternal.get(key);
    if (!record) continue;
    const countKey = `${idType}:${normalizedValue}`;
    if ((identifierCounts.get(countKey) || 0) !== 1) {
      return {
        applied: false,
        reason: 'alias_identifier_not_unique_in_report',
        alias: record,
      };
    }
    const targets = matrixItemsByAliasTarget.get(aliasTargetKey(record)) || [];
    if (targets.length !== 1) {
      return {
        applied: false,
        reason: 'alias_target_missing_or_duplicate_in_matrix',
        alias: record,
      };
    }
    return {
      applied: true,
      alias: record,
      item: targets[0],
      matchMethod: 'confirmed_alias',
    };
  }
  return null;
}

module.exports = {
  ALIAS_SCHEMA_VERSION,
  DEFAULT_ALIAS_PATH,
  ALIAS_STATUSES,
  EXTERNAL_ID_TYPES,
  ProductAliasError,
  loadProductAliases,
  buildAliasIndex,
  resolveConfirmedAlias,
  rowExternalId,
  normalizeAliasIdentifierValue,
};
