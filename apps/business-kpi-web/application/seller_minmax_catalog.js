'use strict';

const fs = require('node:fs/promises');
const readExcelFile = require('read-excel-file/node').default;

const DEFAULT_LIMIT = 8;
const PRODUCT_ROW_START = 3;

const MODULE_MATCHERS = Object.freeze({
  'KNOW-01': item => includesAll(item.name, ['award', 'sterilized']),
  'KNOW-02': item =>
    includesAll(item.name, ['award', 'monoprotein']) &&
    includesAny(item.name, ['кош', 'cat']),
  'KNOW-03': item => includesAll(item.name, ['award', 'urinary']),
  'KNOW-06': item => includesAny(item.name, ['мнямс', 'mnyams']),
  'KNOW-07': item =>
    includesAny(item.name, ["cat's choice", 'cats choice']) &&
    includesAny(item.name, ['тофу', 'древесн']),
  'KNOW-08': item => includesAny(item.name, ["cat's choice", 'cats choice']),
  'KNOW-09': item => includesAny(item.name, ['inspector', 'инспектор', 'барс']),
  'KNOW-10': item => includesAny(item.name, ['japan premium pet', 'premium pet']),
  'KNOW-22': item =>
    includesAny(item.name, ['craftia']) &&
    !includesAny(item.name, ['galena', 'вет диета', 'ветеринарная диета']),
  'KNOW-23': item => includesAny(item.name, ['bambini pets', 'bambini']),
  'KNOW-24': item =>
    includesAny(item.name, ['ферма кота федора', 'ферма кота фёдора']),
  'KNOW-25': item => includesAny(item.name, ['japan premium pet', 'premium pet']),
});

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#10;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value) {
  return decodeEntities(value).toLowerCase().replace(/ё/g, 'е');
}

function includesAny(value, tokens) {
  const text = normalize(value);
  return tokens.some(token => text.includes(normalize(token)));
}

function includesAll(value, tokens) {
  const text = normalize(value);
  return tokens.every(token => text.includes(normalize(token)));
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseMinMaxWorkbook(raw) {
  const sheet = Array.isArray(raw) && raw.length === 1 && raw[0]?.data
    ? raw[0]
    : null;
  const rows = sheet?.data || raw;
  if (!Array.isArray(rows)) {
    throw new TypeError('Min/Max workbook rows are unavailable.');
  }

  const items = rows.slice(PRODUCT_ROW_START)
    .filter(row => Array.isArray(row) && row[2] && row[3])
    .map((row, index) => ({
      rowNumber: index + PRODUCT_ROW_START + 1,
      article: row[1] ? decodeEntities(row[1]) : null,
      name: decodeEntities(row[2]),
      supplier: decodeEntities(row[3]),
      abc: row[4] ? decodeEntities(row[4]) : null,
      xyz: row[6] ? decodeEntities(row[6]) : null,
      price: finiteOrNull(row[7]),
      sales: finiteOrNull(row[35]),
      stockDays: finiteOrNull(row[42]),
      freeStock: finiteOrNull(row[43]),
      excessStock: finiteOrNull(row[44]),
      inTransit: finiteOrNull(row[45]),
      reserve: finiteOrNull(row[46]),
      autoMin: finiteOrNull(row[48]),
      manualMin: finiteOrNull(row[49]),
      needQty: finiteOrNull(row[50]),
      supplierOrderQty: finiteOrNull(row[51]),
      supplierOrderSum: finiteOrNull(row[52]),
    }));

  return {
    sheet: sheet?.sheet || null,
    totalItems: items.length,
    items,
  };
}

function abcRank(value) {
  const rank = { A: 0, B: 1, C: 2, D: 3 };
  return rank[String(value || '').toUpperCase()] ?? 9;
}

function sortTrainingItems(left, right) {
  const leftInStock = (left.freeStock || 0) > 0 ? 0 : 1;
  const rightInStock = (right.freeStock || 0) > 0 ? 0 : 1;
  return leftInStock - rightInStock ||
    abcRank(left.abc) - abcRank(right.abc) ||
    (right.sales || 0) - (left.sales || 0) ||
    (right.freeStock || 0) - (left.freeStock || 0) ||
    left.name.localeCompare(right.name, 'ru');
}

function matchesForModule(catalog, moduleCode, limit = DEFAULT_LIMIT) {
  const matcher = MODULE_MATCHERS[moduleCode];
  if (!matcher || !catalog?.items) return [];
  return catalog.items
    .filter(matcher)
    .sort(sortTrainingItems)
    .slice(0, limit);
}

function minMaxTaskContext(catalog, moduleCode, limit = DEFAULT_LIMIT) {
  const hasMatcher = Object.prototype.hasOwnProperty.call(MODULE_MATCHERS, moduleCode);
  if (!hasMatcher) return null;
  const matches = matchesForModule(catalog, moduleCode, limit);
  return {
    source: 'MINMAX',
    sourceLabel: 'Min/Max «Миски»',
    totalCatalogItems: catalog?.totalItems || 0,
    fileUpdatedAt: catalog?.fileUpdatedAt || null,
    matchedItems: matches.length,
    items: matches,
    productExamples: matches.map(item => item.name),
  };
}

let cache = null;

async function loadMinMaxCatalog(filePath, options = {}) {
  if (!filePath) return null;
  const statFn = options.stat || fs.stat;
  const reader = options.reader || readExcelFile;
  const stat = await statFn(filePath);
  const cacheKey = filePath + ':' + stat.mtimeMs + ':' + stat.size;
  if (!options.disableCache && cache?.key === cacheKey) return cache.value;

  const raw = await reader(filePath);
  const parsed = parseMinMaxWorkbook(raw);
  const value = {
    ...parsed,
    filePath,
    fileUpdatedAt: stat.mtime instanceof Date
      ? stat.mtime.toISOString()
      : new Date(stat.mtimeMs).toISOString(),
    fileSize: stat.size,
  };
  cache = { key: cacheKey, value };
  return value;
}

function applyMinMaxToTrainingTask(task, catalog) {
  if (!task || task.taskType !== 'KNOWLEDGE') return task;
  const context = minMaxTaskContext(catalog, task.code);
  if (!context) return task;
  return {
    ...task,
    productExamples: context.productExamples,
    minMax: {
      source: context.source,
      sourceLabel: context.sourceLabel,
      totalCatalogItems: context.totalCatalogItems,
      fileUpdatedAt: context.fileUpdatedAt,
      matchedItems: context.matchedItems,
      items: context.items,
    },
  };
}

module.exports = {
  MODULE_MATCHERS,
  decodeEntities,
  parseMinMaxWorkbook,
  matchesForModule,
  minMaxTaskContext,
  loadMinMaxCatalog,
  applyMinMaxToTrainingTask,
};
