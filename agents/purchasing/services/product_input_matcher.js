const { normalize } = require('../parsers/minmax_parser');

const MATCH_TYPE_PRIORITY = Object.freeze({
  barcode: 4,
  internal_id: 3,
  supplier_article: 2,
  normalized_name: 1,
});

const MATCH_CONFIDENCE = Object.freeze({
  barcode: 'high',
  internal_id: 'high',
  supplier_article: 'medium',
  normalized_name: 'low',
});

function normalizeCompositePart(value) {
  return normalize(value).replace(/\|/g, ' ');
}

function supplierArticleKey(supplier, article) {
  if (!supplier || !article) return null;
  return `${normalizeCompositePart(supplier)}|${normalizeCompositePart(article)}`;
}

function normalizedNameKey(supplier, name) {
  if (!name) return null;
  const normalizedName = normalizeCompositePart(name);
  return supplier
    ? `${normalizeCompositePart(supplier)}|${normalizedName}`
    : normalizedName;
}

function recordMatchKey(record) {
  const matchKey = record.matchKey;

  if (record.matchType === 'supplier_article' && matchKey && typeof matchKey === 'object') {
    return supplierArticleKey(matchKey.supplier, matchKey.article);
  }
  if (record.matchType === 'normalized_name' && matchKey && typeof matchKey === 'object') {
    return normalizedNameKey(matchKey.supplier, matchKey.name);
  }
  if (typeof matchKey !== 'string' || !matchKey.trim()) return null;
  return normalize(matchKey);
}

function rowMatchKey(row, matchType, recordKey) {
  const hints = row.matchingHints || {};

  if (matchType === 'barcode') return normalize(hints.barcode);
  if (matchType === 'internal_id') return normalize(hints.internalProductId);
  if (matchType === 'supplier_article') {
    return supplierArticleKey(hints.supplier, hints.article);
  }
  if (matchType === 'normalized_name') {
    const supplierScoped = normalizedNameKey(
      hints.supplier,
      hints.normalizedName || row.name
    );
    const nameOnly = normalizedNameKey(null, hints.normalizedName || row.name);
    return recordKey && recordKey.includes('|') ? supplierScoped : nameOnly;
  }
  return null;
}

function validateRecords(records, sourceName) {
  if (!Array.isArray(records)) {
    throw new TypeError(`${sourceName} products must be an array.`);
  }

  records.forEach((record, index) => {
    if (!record || typeof record !== 'object') {
      throw new TypeError(`${sourceName} product ${index + 1} must be an object.`);
    }
    if (!Object.hasOwn(MATCH_TYPE_PRIORITY, record.matchType)) {
      throw new TypeError(
        `${sourceName} product ${index + 1} has unsupported matchType.`
      );
    }
    if (!recordMatchKey(record)) {
      throw new TypeError(`${sourceName} product ${index + 1} requires matchKey.`);
    }
  });
}

function matchProductInputs(rows, records, sourceName = 'External input') {
  if (!Array.isArray(rows)) {
    throw new TypeError('Product input matcher requires product rows.');
  }
  validateRecords(records, sourceName);

  const candidatesByRow = new Map();
  const recordResults = [];

  records.forEach((record, recordIndex) => {
    const key = recordMatchKey(record);
    const matches = rows.filter(row => rowMatchKey(row, record.matchType, key) === key);
    const requiresUniqueMatch =
      record.matchType === 'supplier_article' ||
      record.matchType === 'normalized_name';
    const ambiguous = requiresUniqueMatch && matches.length > 1;
    const acceptedMatches = ambiguous ? [] : matches;

    recordResults.push({
      recordIndex,
      matchType: record.matchType,
      matchKey: key,
      matchedRowIdentities: acceptedMatches.map(row => row.rowIdentity),
      candidateRowIdentities: matches.map(row => row.rowIdentity),
      status: ambiguous
        ? 'ambiguous'
        : acceptedMatches.length > 0
          ? 'matched'
          : 'unmatched',
    });

    for (const row of acceptedMatches) {
      if (!candidatesByRow.has(row.rowIdentity)) {
        candidatesByRow.set(row.rowIdentity, []);
      }
      candidatesByRow.get(row.rowIdentity).push({
        record,
        recordIndex,
        method: record.matchType,
        confidence: MATCH_CONFIDENCE[record.matchType],
        priority: MATCH_TYPE_PRIORITY[record.matchType],
      });
    }
  });

  const matchesByRowIdentity = new Map();
  const rowDiagnostics = [];

  for (const row of rows) {
    const candidates = candidatesByRow.get(row.rowIdentity) || [];
    if (candidates.length === 0) continue;
    const highestPriority = Math.max(...candidates.map(candidate => candidate.priority));
    const strongest = candidates.filter(candidate => candidate.priority === highestPriority);

    if (strongest.length !== 1) {
      rowDiagnostics.push({
        rowIdentity: row.rowIdentity,
        rowNumber: row.rowNumber,
        reason: 'multiple_equal_strength_input_matches',
        recordIndexes: strongest.map(candidate => candidate.recordIndex),
      });
      continue;
    }

    matchesByRowIdentity.set(row.rowIdentity, strongest[0]);
  }

  return {
    matchesByRowIdentity,
    recordResults,
    rowDiagnostics,
  };
}

module.exports = {
  MATCH_TYPE_PRIORITY,
  MATCH_CONFIDENCE,
  normalizeCompositePart,
  supplierArticleKey,
  normalizedNameKey,
  recordMatchKey,
  rowMatchKey,
  matchProductInputs,
};
