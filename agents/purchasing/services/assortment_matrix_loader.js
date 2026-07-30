const path = require('node:path');

const { normalize } = require('../parsers/minmax_parser');
const {
  loadRequiredJson,
} = require('../../../shared/config/json_config_loader');
const {
  ORDER_SAFETY_CODES,
  normalizeArticle: normalizeSafetyArticle,
  packagingMismatch,
} = require('./order_safety');

const ALLOWED_PRIORITIES = Object.freeze([
  'critical',
  'important',
  'standard',
]);
const ALLOWED_POLICY_STATUSES = Object.freeze([
  'approved',
  'placeholder',
  'requires_confirmation',
]);

class AssortmentMatrixError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AssortmentMatrixError';
    this.code = code;
  }
}

function normalizedName(value) {
  return normalize(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedArticle(value) {
  return normalizeSafetyArticle(value);
}

function requireNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AssortmentMatrixError(
      `Поле ${fieldName} должно быть непустой строкой.`,
      'INVALID_FIELD'
    );
  }
  return value.trim();
}

function optionalString(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new AssortmentMatrixError(
      `Поле ${fieldName} должно быть строкой.`,
      'INVALID_FIELD'
    );
  }
  return value.trim() || null;
}

function nonNegativeNumber(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new AssortmentMatrixError(
      `Поле ${fieldName} должно быть конечным числом не меньше нуля.`,
      'INVALID_FIELD'
    );
  }
  return value;
}

function validateAssortmentMatrix(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AssortmentMatrixError(
      'Ассортиментная матрица должна быть JSON-объектом.',
      'INVALID_STRUCTURE'
    );
  }
  if (!Number.isInteger(value.version) || value.version < 1) {
    throw new AssortmentMatrixError(
      'Поле version должно быть положительным целым числом.',
      'INVALID_VERSION'
    );
  }
  const updatedAt = requireNonEmptyString(value.updated_at, 'updated_at');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedAt)) {
    throw new AssortmentMatrixError(
      'Поле updated_at должно иметь формат YYYY-MM-DD.',
      'INVALID_UPDATED_AT'
    );
  }
  const store = requireNonEmptyString(value.store, 'store');
  if (!Array.isArray(value.items)) {
    throw new AssortmentMatrixError(
      'Поле items должно быть массивом.',
      'INVALID_ITEMS'
    );
  }

  const items = value.items.map((item, index) => {
    const prefix = `items[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new AssortmentMatrixError(
        `${prefix} должен быть объектом.`,
        'INVALID_ITEM'
      );
    }
    const article = optionalString(item.article, `${prefix}.article`);
    const name = requireNonEmptyString(item.name, `${prefix}.name`);
    const priority = requireNonEmptyString(item.priority, `${prefix}.priority`);
    if (!ALLOWED_PRIORITIES.includes(priority)) {
      throw new AssortmentMatrixError(
        `${prefix}.priority должен быть одним из: ${ALLOWED_PRIORITIES.join(', ')}.`,
        'INVALID_PRIORITY'
      );
    }
    const policyStatus = item.policy_status === undefined
      ? 'approved'
      : requireNonEmptyString(item.policy_status, `${prefix}.policy_status`);
    if (!ALLOWED_POLICY_STATUSES.includes(policyStatus)) {
      throw new AssortmentMatrixError(
        `${prefix}.policy_status должен быть одним из: ${ALLOWED_POLICY_STATUSES.join(', ')}.`,
        'INVALID_POLICY_STATUS'
      );
    }
    const minimumShelfStock = nonNegativeNumber(
      item.minimum_shelf_stock,
      `${prefix}.minimum_shelf_stock`
    );
    const targetStock = nonNegativeNumber(
      item.target_stock,
      `${prefix}.target_stock`
    );
    if (targetStock < minimumShelfStock) {
      throw new AssortmentMatrixError(
        `${prefix}.target_stock не может быть меньше minimum_shelf_stock.`,
        'INVALID_TARGET_STOCK'
      );
    }
    if (typeof item.allow_zero_stock !== 'boolean') {
      throw new AssortmentMatrixError(
        `${prefix}.allow_zero_stock должен быть boolean.`,
        'INVALID_FIELD'
      );
    }

    return {
      article,
      name,
      brand: optionalString(item.brand, `${prefix}.brand`),
      category: optionalString(item.category, `${prefix}.category`),
      priority,
      policy_status: policyStatus,
      minimum_shelf_stock: minimumShelfStock,
      target_stock: targetStock,
      allow_zero_stock: item.allow_zero_stock,
      notes: optionalString(item.notes, `${prefix}.notes`),
      normalized_article: article ? normalizedArticle(article) : null,
      normalized_name: normalizedName(name),
    };
  });

  return {
    version: value.version,
    updated_at: updatedAt,
    store,
    items,
  };
}

function loadAssortmentMatrix(filePath) {
  const resolvedPath = path.resolve(filePath);
  let parsed;
  try {
    parsed = loadRequiredJson(resolvedPath, {
      label: 'ассортиментная матрица',
    });
  } catch (error) {
    if (error.code === 'JSON_CONFIG_INVALID_JSON') {
      throw new AssortmentMatrixError(
        `Файл ассортиментной матрицы «${resolvedPath}» содержит некорректный JSON: ${error.cause.message}.`,
        'INVALID_JSON',
        error.cause
      );
    }
    const reason = error.cause?.code === 'ENOENT'
      ? 'файл не найден'
      : error.cause?.message || error.message;
    throw new AssortmentMatrixError(
      `Не удалось загрузить ассортиментную матрицу «${resolvedPath}»: ${reason}.`,
      'MATRIX_FILE_ERROR',
      error.cause || error
    );
  }

  return {
    matrix: validateAssortmentMatrix(parsed),
    sourcePath: resolvedPath,
  };
}

function valuesByKey(values, keyFor) {
  const index = new Map();
  values.forEach((value, valueIndex) => {
    const key = keyFor(value);
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ value, index: valueIndex });
  });
  return index;
}

function matchAssortmentMatrix(matrix, rows) {
  if (!matrix || !Array.isArray(matrix.items)) {
    throw new TypeError('Для сопоставления требуется валидированная матрица.');
  }
  if (!Array.isArray(rows)) {
    throw new TypeError('Для сопоставления требуется массив товарных строк.');
  }

  const rowsByArticle = valuesByKey(
    rows,
    row => normalizedArticle(row.article)
  );
  const rowsByName = valuesByKey(
    rows,
    row => normalizedName(row.name)
  );
  const itemsByArticle = valuesByKey(
    matrix.items,
    item => item.normalized_article
  );
  const proposedResults = matrix.items.map((item, itemIndex) => {
    const articleRows = item.normalized_article
      ? rowsByArticle.get(item.normalized_article) || []
      : [];
    const sameArticleItems = item.normalized_article
      ? itemsByArticle.get(item.normalized_article) || []
      : [];

    if (
      articleRows.length === 1 &&
      sameArticleItems.length === 1 &&
      !packagingMismatch(item.name, articleRows[0].value.name)
    ) {
      return {
        itemIndex,
        status: 'matched',
        matchMethod: 'article',
        row: articleRows[0].value,
        candidateRowIdentities: [articleRows[0].value.rowIdentity],
      };
    }

    const nameRows = rowsByName.get(item.normalized_name) || [];
    if (articleRows.length > 1 || sameArticleItems.length > 1) {
      return {
        itemIndex,
        status: 'ambiguous',
        matchMethod: null,
        row: null,
        reasonCode: ORDER_SAFETY_CODES.AMBIGUOUS_ARTICLE_MATCH,
        candidateRowIdentities: articleRows.map(
          candidate => candidate.value.rowIdentity
        ),
      };
    }

    if (articleRows.length === 1) {
      return {
        itemIndex,
        status: 'review_candidate',
        matchMethod: 'article',
        row: null,
        reasonCode: ORDER_SAFETY_CODES.PACKAGING_MISMATCH,
        candidateRowIdentities: [articleRows[0].value.rowIdentity],
      };
    }

    if (nameRows.length === 1) {
      return {
        itemIndex,
        status: 'review_candidate',
        matchMethod: 'normalized_name',
        row: null,
        reasonCode: nameRows[0].value.article
          ? ORDER_SAFETY_CODES.ARTICLE_NOT_FOUND
          : ORDER_SAFETY_CODES.ARTICLE_REQUIRED,
        candidateRowIdentities: [nameRows[0].value.rowIdentity],
      };
    }

    return {
      itemIndex,
      status: nameRows.length > 1 ? 'ambiguous' : 'unmatched',
      matchMethod: null,
      row: null,
      reasonCode: nameRows.length > 1
        ? ORDER_SAFETY_CODES.AMBIGUOUS_ARTICLE_MATCH
        : item.normalized_article
          ? ORDER_SAFETY_CODES.ARTICLE_NOT_FOUND
          : ORDER_SAFETY_CODES.ARTICLE_REQUIRED,
      candidateRowIdentities: nameRows.map(
        candidate => candidate.value.rowIdentity
      ),
    };
  });

  const itemResults = proposedResults;
  const matchesByRowIdentity = new Map();
  const reviewCandidatesByRowIdentity = new Map();
  for (const result of itemResults) {
    if (result.status === 'matched') {
      matchesByRowIdentity.set(result.row.rowIdentity, {
        itemIndex: result.itemIndex,
        item: matrix.items[result.itemIndex],
        row: result.row,
        matchMethod: result.matchMethod,
      });
      continue;
    }
    for (const rowIdentity of result.candidateRowIdentities) {
      const current = reviewCandidatesByRowIdentity.get(rowIdentity) || {
        reasonCodes: [],
        itemIndexes: [],
        matchMethods: [],
      };
      current.reasonCodes = Array.from(new Set([
        ...current.reasonCodes,
        result.reasonCode,
      ].filter(Boolean)));
      current.itemIndexes = Array.from(new Set([
        ...current.itemIndexes,
        result.itemIndex,
      ]));
      current.matchMethods = Array.from(new Set([
        ...current.matchMethods,
        result.matchMethod,
      ].filter(Boolean)));
      reviewCandidatesByRowIdentity.set(rowIdentity, current);
    }
  }

  return {
    itemResults,
    matchesByRowIdentity,
    reviewCandidatesByRowIdentity,
  };
}

function uniqueValue(rows, keyFor, expected) {
  return rows.filter(row => keyFor(row) === expected).length === 1;
}

function demandMatchForRow(row, rows) {
  const hints = row.matchingHints || {};
  if (
    hints.barcode &&
    uniqueValue(rows, candidate => normalize(candidate.matchingHints?.barcode), normalize(hints.barcode))
  ) {
    return { matchType: 'barcode', matchKey: hints.barcode };
  }
  if (
    hints.internalProductId &&
    uniqueValue(
      rows,
      candidate => normalize(candidate.matchingHints?.internalProductId),
      normalize(hints.internalProductId)
    )
  ) {
    return { matchType: 'internal_id', matchKey: hints.internalProductId };
  }
  const supplierArticle = hints.supplier && hints.article
    ? `${normalize(hints.supplier)}|${normalize(hints.article)}`
    : null;
  if (
    supplierArticle &&
    uniqueValue(
      rows,
      candidate => candidate.matchingHints?.supplier && candidate.matchingHints?.article
        ? `${normalize(candidate.matchingHints.supplier)}|${normalize(candidate.matchingHints.article)}`
        : null,
      supplierArticle
    )
  ) {
    return {
      matchType: 'supplier_article',
      matchKey: { supplier: hints.supplier, article: hints.article },
    };
  }
  if (uniqueValue(rows, candidate => normalizedName(candidate.name), normalizedName(row.name))) {
    return {
      matchType: 'normalized_name',
      matchKey: { name: row.name },
    };
  }
  return null;
}

function buildDemandAssortmentSource(matrix, rows, matchResult) {
  const products = [];
  for (const match of matchResult.matchesByRowIdentity.values()) {
    const demandMatch = demandMatchForRow(match.row, rows);
    if (!demandMatch) continue;
    products.push({
      ...demandMatch,
      mandatory: ['critical', 'important'].includes(match.item.priority),
      minDisplayStock: match.item.minimum_shelf_stock,
      assortmentPriority: match.item.priority === 'critical'
        ? 'critical'
        : match.item.priority === 'important'
          ? 'high'
          : 'normal',
      strategicSku: match.item.priority === 'critical',
      strategicBrand: false,
      matrixItemIndex: match.itemIndex,
    });
  }
  return {
    version: `miska-assortment-matrix-v${matrix.version}`,
    products,
  };
}

module.exports = {
  ALLOWED_PRIORITIES,
  ALLOWED_POLICY_STATUSES,
  AssortmentMatrixError,
  normalizedName,
  normalizedArticle,
  validateAssortmentMatrix,
  loadAssortmentMatrix,
  matchAssortmentMatrix,
  buildDemandAssortmentSource,
};
