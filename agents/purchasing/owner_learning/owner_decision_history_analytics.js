const {
  OWNER_DECISIONS,
  REASON_CODES,
  SOURCES,
} = require('./owner_decision_history');
const {
  normalizeAgentRecommendation,
} = require('./owner_learning_report');

const ANALYTICS_SCHEMA_VERSION =
  'owner-decision-history-analytics-v0.7.3';
const UNKNOWN_GROUP = '__UNKNOWN__';
const DEFAULT_OPTIONS = Object.freeze({
  minOccurrences: 3,
  dominantShareThreshold: 0.75,
  maxItems: null,
});
const AGENT_RECOMMENDATIONS = Object.freeze([
  'BUY',
  'SKIP',
  'DEFER',
]);
const MAX_EVIDENCE_DECISION_IDS = 20;

class OwnerDecisionHistoryAnalyticsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OwnerDecisionHistoryAnalyticsError';
    this.code = code;
  }
}

function validationError(message) {
  return new OwnerDecisionHistoryAnalyticsError(
    'OWNER_DECISION_ANALYTICS_INVALID_INPUT',
    message
  );
}

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function pathLike(value) {
  return value.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith('file://');
}

function safeText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized === '' || pathLike(normalized)) return null;
  return normalized;
}

function safeFilterText(value, fieldName) {
  const normalized = safeText(value);
  if (!normalized) {
    throw validationError(
      `Фильтр ${fieldName} должен быть непустой безопасной строкой.`
    );
  }
  return normalized;
}

function normalizedEnum(value, allowed) {
  const normalized = safeText(value)?.toUpperCase() || null;
  return normalized && allowed.includes(normalized)
    ? normalized
    : null;
}

function normalizedFilterEnum(value, allowed, fieldName) {
  const normalized = safeFilterText(value, fieldName).toUpperCase();
  if (!allowed.includes(normalized)) {
    throw validationError(
      `Фильтр ${fieldName} содержит неподдерживаемое значение.`
    );
  }
  return normalized;
}

function finiteNonNegative(value) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : null;
}

function utcTimestamp(value) {
  const normalized = safeText(value);
  if (!normalized) return null;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function dateBoundary(value, fieldName, endOfDay) {
  const normalized = safeFilterText(value, fieldName);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const suffix = endOfDay
      ? 'T23:59:59.999Z'
      : 'T00:00:00.000Z';
    const timestamp = Date.parse(`${normalized}${suffix}`);
    if (
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== normalized
    ) {
      throw validationError(
        `Фильтр ${fieldName} содержит некорректную дату.`
      );
    }
    return { source: normalized, timestamp };
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw validationError(
      `Фильтр ${fieldName} содержит некорректную дату.`
    );
  }
  return { source: normalized, timestamp };
}

function normalizeFilters(filters = {}) {
  if (filters === null || filters === undefined) filters = {};
  if (!isPlainObject(filters)) {
    throw validationError('filters должен быть объектом.');
  }
  const normalized = {};
  const applied = {};
  if (filters.source !== undefined && filters.source !== null) {
    normalized.source = normalizedFilterEnum(
      filters.source,
      SOURCES,
      'source'
    );
    applied.source = normalized.source;
  }
  for (const field of [
    'supplier',
    'brand',
    'category',
    'stableItemKey',
  ]) {
    if (filters[field] !== undefined && filters[field] !== null) {
      normalized[field] = safeFilterText(filters[field], field);
      applied[field] = normalized[field];
    }
  }
  if (
    filters.ownerDecision !== undefined &&
    filters.ownerDecision !== null
  ) {
    normalized.ownerDecision = normalizedFilterEnum(
      filters.ownerDecision,
      OWNER_DECISIONS,
      'ownerDecision'
    );
    applied.ownerDecision = normalized.ownerDecision;
  }
  if (filters.reasonCode !== undefined && filters.reasonCode !== null) {
    normalized.reasonCode = normalizedFilterEnum(
      filters.reasonCode,
      REASON_CODES,
      'reasonCode'
    );
    applied.reasonCode = normalized.reasonCode;
  }
  if (filters.dateFrom !== undefined && filters.dateFrom !== null) {
    normalized.dateFrom = dateBoundary(
      filters.dateFrom,
      'dateFrom',
      false
    );
    applied.dateFrom = normalized.dateFrom.source;
  }
  if (filters.dateTo !== undefined && filters.dateTo !== null) {
    normalized.dateTo = dateBoundary(
      filters.dateTo,
      'dateTo',
      true
    );
    applied.dateTo = normalized.dateTo.source;
  }
  if (
    normalized.dateFrom &&
    normalized.dateTo &&
    normalized.dateFrom.timestamp > normalized.dateTo.timestamp
  ) {
    throw validationError('dateFrom не может быть позже dateTo.');
  }
  return { normalized, applied };
}

function normalizeOptions(options = {}) {
  if (options === null || options === undefined) options = {};
  if (!isPlainObject(options)) {
    throw validationError('options должен быть объектом.');
  }
  const minOccurrences = options.minOccurrences ??
    DEFAULT_OPTIONS.minOccurrences;
  if (!Number.isInteger(minOccurrences) || minOccurrences < 1) {
    throw validationError(
      'minOccurrences должен быть положительным целым числом.'
    );
  }
  const dominantShareThreshold = options.dominantShareThreshold ??
    DEFAULT_OPTIONS.dominantShareThreshold;
  if (
    typeof dominantShareThreshold !== 'number' ||
    !Number.isFinite(dominantShareThreshold) ||
    dominantShareThreshold < 0 ||
    dominantShareThreshold > 1
  ) {
    throw validationError(
      'dominantShareThreshold должен быть числом от 0 до 1.'
    );
  }
  const maxItems = options.maxItems ?? DEFAULT_OPTIONS.maxItems;
  if (
    maxItems !== null &&
    (!Number.isInteger(maxItems) || maxItems < 1)
  ) {
    throw validationError(
      'maxItems должен быть положительным целым числом или null.'
    );
  }
  let generatedAt = null;
  if (options.generatedAt !== undefined && options.generatedAt !== null) {
    const timestamp = utcTimestamp(options.generatedAt);
    if (timestamp === null) {
      throw validationError('generatedAt должен быть ISO-датой.');
    }
    generatedAt = new Date(timestamp).toISOString();
  }
  return {
    minOccurrences,
    dominantShareThreshold,
    maxItems,
    generatedAt,
  };
}

function historyEntries(history) {
  if (history === null || history === undefined) return [];
  if (Array.isArray(history)) return history;
  if (!isPlainObject(history) || !Array.isArray(history.entries)) {
    throw validationError(
      'history должен быть массивом записей или объектом с entries.'
    );
  }
  return history.entries;
}

function normalizeEntry(value, index) {
  const entry = isPlainObject(value) ? value : {};
  const ownerDecisionText = safeText(entry.ownerDecision);
  const reasonText = safeText(entry.reasonCode);
  const sourceText = safeText(entry.source);
  const recordedAtTimestamp = utcTimestamp(entry.recordedAt);
  const stableItemKey = safeText(entry.stableItemKey);
  const brand = safeText(entry.brand);
  const supplier = safeText(entry.supplier);
  const category = safeText(entry.category);
  const agentRecommendation = normalizeAgentRecommendation(
    safeText(entry.agentRecommendation)
  );
  return {
    inputIndex: index,
    decisionId: safeText(entry.decisionId),
    recordedAt: recordedAtTimestamp === null
      ? null
      : new Date(recordedAtTimestamp).toISOString(),
    recordedAtTimestamp,
    sourceText,
    source: normalizedEnum(sourceText, SOURCES),
    stableItemKey,
    sku: safeText(entry.sku),
    productName: safeText(entry.productName),
    brand,
    supplier,
    category,
    ownerDecisionText,
    ownerDecision: normalizedEnum(
      ownerDecisionText,
      OWNER_DECISIONS
    ),
    reasonText,
    reasonCode: normalizedEnum(reasonText, REASON_CODES),
    agentRecommendation,
    agentQuantity: finiteNonNegative(entry.agentQuantity),
    ownerQuantity: finiteNonNegative(entry.ownerQuantity),
  };
}

function groupValue(value) {
  return value || UNKNOWN_GROUP;
}

function entryMatches(entry, filters) {
  if (filters.source && entry.source !== filters.source) return false;
  if (
    filters.supplier &&
    groupValue(entry.supplier) !== filters.supplier
  ) return false;
  if (filters.brand && groupValue(entry.brand) !== filters.brand) {
    return false;
  }
  if (
    filters.category &&
    groupValue(entry.category) !== filters.category
  ) return false;
  if (
    filters.stableItemKey &&
    entry.stableItemKey !== filters.stableItemKey
  ) return false;
  if (
    filters.ownerDecision &&
    entry.ownerDecision !== filters.ownerDecision
  ) return false;
  if (
    filters.reasonCode &&
    entry.reasonCode !== filters.reasonCode
  ) return false;
  if (
    filters.dateFrom &&
    (
      entry.recordedAtTimestamp === null ||
      entry.recordedAtTimestamp < filters.dateFrom.timestamp
    )
  ) return false;
  if (
    filters.dateTo &&
    (
      entry.recordedAtTimestamp === null ||
      entry.recordedAtTimestamp > filters.dateTo.timestamp
    )
  ) return false;
  return true;
}

function emptyCounts(keys) {
  return Object.fromEntries(keys.map(key => [key, 0]));
}

function countBy(entries, field, keys) {
  const counts = emptyCounts(keys);
  for (const entry of entries) {
    if (entry[field] && Object.hasOwn(counts, entry[field])) {
      counts[entry[field]] += 1;
    }
  }
  return counts;
}

function roundRatio(value) {
  return Math.round(value * 10000) / 10000;
}

function ratio(numerator, denominator) {
  return denominator === 0
    ? null
    : roundRatio(numerator / denominator);
}

function average(values) {
  const usable = values.filter(value =>
    typeof value === 'number' && Number.isFinite(value)
  );
  if (usable.length === 0) return null;
  return roundRatio(
    usable.reduce((sum, value) => sum + value, 0) / usable.length
  );
}

function comparableDecision(entry) {
  return AGENT_RECOMMENDATIONS.includes(entry.agentRecommendation) &&
    AGENT_RECOMMENDATIONS.includes(entry.ownerDecision);
}

function comparableQuantity(entry) {
  return entry.agentRecommendation === 'BUY' &&
    entry.ownerDecision === 'BUY' &&
    entry.agentQuantity !== null &&
    entry.ownerQuantity !== null;
}

function agreementAnalysis(entries) {
  const result = {
    comparableEntries: 0,
    agreements: 0,
    disagreements: 0,
    agreementRate: null,
    quantityComparableEntries: 0,
    exactQuantityMatches: 0,
    quantityMatchRate: null,
    ownerIncreasedQuantity: 0,
    ownerDecreasedQuantity: 0,
    ownerChangedDecision: 0,
  };
  for (const entry of entries) {
    if (comparableDecision(entry)) {
      result.comparableEntries += 1;
      if (entry.agentRecommendation === entry.ownerDecision) {
        result.agreements += 1;
      } else {
        result.disagreements += 1;
        result.ownerChangedDecision += 1;
      }
    }
    if (comparableQuantity(entry)) {
      result.quantityComparableEntries += 1;
      if (entry.ownerQuantity === entry.agentQuantity) {
        result.exactQuantityMatches += 1;
      } else if (entry.ownerQuantity > entry.agentQuantity) {
        result.ownerIncreasedQuantity += 1;
      } else {
        result.ownerDecreasedQuantity += 1;
      }
    }
  }
  result.agreementRate = ratio(
    result.agreements,
    result.comparableEntries
  );
  result.quantityMatchRate = ratio(
    result.exactQuantityMatches,
    result.quantityComparableEntries
  );
  return result;
}

function positiveCounts(counts) {
  return Object.entries(counts).filter(([, count]) => count > 0);
}

function dominant(counts) {
  const values = positiveCounts(counts).sort(
    (left, right) =>
      right[1] - left[1] ||
      left[0].localeCompare(right[0], 'en')
  );
  return values[0]
    ? { value: values[0][0], count: values[0][1] }
    : { value: null, count: 0 };
}

function reasonDistribution(entries) {
  const counts = countBy(entries, 'reasonCode', REASON_CODES);
  return positiveCounts(counts)
    .map(([reasonCode, count]) => ({
      reasonCode,
      count,
      share: ratio(count, entries.length),
    }))
    .sort((left, right) =>
      right.count - left.count ||
      left.reasonCode.localeCompare(right.reasonCode, 'en')
    );
}

function representative(entries, field) {
  const counts = new Map();
  for (const entry of entries) {
    const value = entry[field];
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts)
    .sort((left, right) =>
      right[1] - left[1] ||
      left[0].localeCompare(right[0], 'ru')
    )[0]?.[0] || null;
}

function dateRange(entries) {
  const timestamps = entries
    .map(entry => entry.recordedAtTimestamp)
    .filter(value => value !== null)
    .sort((left, right) => left - right);
  return {
    firstRecordedAt: timestamps.length > 0
      ? new Date(timestamps[0]).toISOString()
      : null,
    lastRecordedAt: timestamps.length > 0
      ? new Date(timestamps.at(-1)).toISOString()
      : null,
  };
}

function quantityDeltaAverage(entries) {
  return average(entries
    .filter(comparableQuantity)
    .map(entry => entry.ownerQuantity - entry.agentQuantity));
}

function commonGroupAnalytics(entries) {
  const decisionsByType = countBy(
    entries,
    'ownerDecision',
    OWNER_DECISIONS
  );
  const reasonsByType = countBy(entries, 'reasonCode', REASON_CODES);
  const agreement = agreementAnalysis(entries);
  return {
    totalEntries: entries.length,
    decisionsByType,
    reasonsByType,
    agreements: agreement.agreements,
    disagreements: agreement.disagreements,
    agreementRate: agreement.agreementRate,
    averageOwnerQuantity: average(
      entries.map(entry => entry.ownerQuantity)
    ),
    averageQuantityDelta: quantityDeltaAverage(entries),
    dominantOwnerDecision: dominant(decisionsByType).value,
    dominantReason: dominant(reasonsByType).value,
  };
}

function groupEntries(entries, field) {
  const groups = new Map();
  for (const entry of entries) {
    const key = groupValue(entry[field]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return groups;
}

function sortedAnalytics(values, keyField) {
  return values.sort((left, right) =>
    right.totalEntries - left.totalEntries ||
    left[keyField].localeCompare(right[keyField], 'ru')
  );
}

function buildItemAnalytics(entries, maxItems) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.stableItemKey) continue;
    if (!groups.has(entry.stableItemKey)) {
      groups.set(entry.stableItemKey, []);
    }
    groups.get(entry.stableItemKey).push(entry);
  }
  const values = Array.from(groups, ([stableItemKey, group]) => {
    const decisionsByType = countBy(
      group,
      'ownerDecision',
      OWNER_DECISIONS
    );
    const reasonsByType = countBy(group, 'reasonCode', REASON_CODES);
    const agentRecommendationsByType = {
      ...countBy(
        group,
        'agentRecommendation',
        AGENT_RECOMMENDATIONS
      ),
      UNKNOWN: group.filter(
        entry => !entry.agentRecommendation
      ).length,
    };
    const agreement = agreementAnalysis(group);
    const decisionDominant = dominant(decisionsByType);
    return {
      stableItemKey,
      sku: representative(group, 'sku'),
      productName: representative(group, 'productName'),
      brand: representative(group, 'brand'),
      category: representative(group, 'category'),
      supplier: representative(group, 'supplier'),
      totalEntries: group.length,
      decisionsByType,
      reasonsByType,
      agentRecommendationsByType,
      agreements: agreement.agreements,
      disagreements: agreement.disagreements,
      agreementRate: agreement.agreementRate,
      averageAgentQuantity: average(
        group.map(entry => entry.agentQuantity)
      ),
      averageOwnerQuantity: average(
        group.map(entry => entry.ownerQuantity)
      ),
      ownerQuantityDeltaAverage: quantityDeltaAverage(group),
      ...dateRange(group),
      repeatedSameDecisionCount: decisionDominant.count,
      dominantOwnerDecision: decisionDominant.value,
      dominantReason: dominant(reasonsByType).value,
    };
  });
  sortedAnalytics(values, 'stableItemKey');
  return maxItems === null ? values : values.slice(0, maxItems);
}

function buildBrandAnalytics(entries) {
  return sortedAnalytics(
    Array.from(groupEntries(entries, 'brand'), ([brand, group]) => ({
      brand,
      uniqueItems: new Set(
        group.map(entry => entry.stableItemKey).filter(Boolean)
      ).size,
      ...commonGroupAnalytics(group),
    })),
    'brand'
  );
}

function buildSupplierAnalytics(entries) {
  return sortedAnalytics(
    Array.from(
      groupEntries(entries, 'supplier'),
      ([supplier, group]) => ({
        supplier,
        uniqueBrands: new Set(
          group.map(entry => entry.brand).filter(Boolean)
        ).size,
        uniqueItems: new Set(
          group.map(entry => entry.stableItemKey).filter(Boolean)
        ).size,
        ...commonGroupAnalytics(group),
      })
    ),
    'supplier'
  );
}

function buildCategoryAnalytics(entries) {
  return sortedAnalytics(
    Array.from(
      groupEntries(entries, 'category'),
      ([category, group]) => ({
        category,
        uniqueItems: new Set(
          group.map(entry => entry.stableItemKey).filter(Boolean)
        ).size,
        ...commonGroupAnalytics(group),
      })
    ),
    'category'
  );
}

function evidenceDecisionIds(entries) {
  return Array.from(new Set(
    entries.map(entry => entry.decisionId).filter(Boolean)
  ))
    .sort((left, right) => left.localeCompare(right, 'en'))
    .slice(0, MAX_EVIDENCE_DECISION_IDS);
}

function pattern({
  patternType,
  scopeType,
  scopeKey,
  occurrences,
  dominantValue,
  share,
  entries,
}) {
  return {
    patternType,
    scopeType,
    scopeKey,
    occurrences,
    dominantValue,
    share: roundRatio(share),
    evidenceDecisionIds: evidenceDecisionIds(entries),
    ...dateRange(entries),
  };
}

function valueEntries(entries, field, value) {
  return entries.filter(entry => entry[field] === value);
}

function repeatedItemPatterns(entries, minOccurrences) {
  const patterns = [];
  for (const [stableItemKey, group] of groupEntries(
    entries.filter(entry => entry.stableItemKey),
    'stableItemKey'
  )) {
    const decisionCounts = countBy(
      group,
      'ownerDecision',
      OWNER_DECISIONS
    );
    const decisionDominant = dominant(decisionCounts);
    const validDecisionCount = positiveCounts(decisionCounts)
      .reduce((sum, value) => sum + value[1], 0);
    if (decisionDominant.count >= minOccurrences) {
      const supporting = valueEntries(
        group,
        'ownerDecision',
        decisionDominant.value
      );
      patterns.push(pattern({
        patternType: 'SAME_ITEM_SAME_DECISION',
        scopeType: 'ITEM',
        scopeKey: stableItemKey,
        occurrences: decisionDominant.count,
        dominantValue: decisionDominant.value,
        share: decisionDominant.count / validDecisionCount,
        entries: supporting,
      }));
    }
    const reasonCounts = countBy(group, 'reasonCode', REASON_CODES);
    const reasonDominant = dominant(reasonCounts);
    const validReasonCount = positiveCounts(reasonCounts)
      .reduce((sum, value) => sum + value[1], 0);
    if (reasonDominant.count >= minOccurrences) {
      const supporting = valueEntries(
        group,
        'reasonCode',
        reasonDominant.value
      );
      patterns.push(pattern({
        patternType: 'SAME_ITEM_SAME_REASON',
        scopeType: 'ITEM',
        scopeKey: stableItemKey,
        occurrences: reasonDominant.count,
        dominantValue: reasonDominant.value,
        share: reasonDominant.count / validReasonCount,
        entries: supporting,
      }));
    }
    const comparable = group.filter(comparableDecision);
    const disagreements = comparable.filter(entry =>
      entry.agentRecommendation !== entry.ownerDecision
    );
    if (disagreements.length >= minOccurrences) {
      const transitionCounts = new Map();
      for (const entry of disagreements) {
        const transition =
          `${entry.agentRecommendation}->${entry.ownerDecision}`;
        transitionCounts.set(
          transition,
          (transitionCounts.get(transition) || 0) + 1
        );
      }
      const transition = Array.from(transitionCounts)
        .sort((left, right) =>
          right[1] - left[1] ||
          left[0].localeCompare(right[0], 'en')
        )[0][0];
      patterns.push(pattern({
        patternType: 'AGENT_DISAGREEMENT_REPEAT',
        scopeType: 'ITEM',
        scopeKey: stableItemKey,
        occurrences: disagreements.length,
        dominantValue: transition,
        share: disagreements.length / comparable.length,
        entries: disagreements,
      }));
    }
  }
  return patterns;
}

function groupBiasPatterns({
  entries,
  field,
  patternType,
  scopeType,
  minOccurrences,
  dominantShareThreshold,
}) {
  const patterns = [];
  for (const [scopeKey, group] of groupEntries(entries, field)) {
    if (scopeKey === UNKNOWN_GROUP) continue;
    const counts = countBy(
      group,
      'ownerDecision',
      OWNER_DECISIONS
    );
    const validCount = positiveCounts(counts)
      .reduce((sum, value) => sum + value[1], 0);
    const decisionDominant = dominant(counts);
    const share = validCount === 0
      ? 0
      : decisionDominant.count / validCount;
    if (
      validCount < minOccurrences ||
      share < dominantShareThreshold
    ) continue;
    const supporting = valueEntries(
      group,
      'ownerDecision',
      decisionDominant.value
    );
    patterns.push(pattern({
      patternType,
      scopeType,
      scopeKey,
      occurrences: decisionDominant.count,
      dominantValue: decisionDominant.value,
      share,
      entries: supporting,
    }));
  }
  return patterns;
}

function repeatedDecisionPatterns(entries, options) {
  const patterns = [
    ...repeatedItemPatterns(entries, options.minOccurrences),
    ...groupBiasPatterns({
      entries,
      field: 'brand',
      patternType: 'BRAND_DECISION_BIAS',
      scopeType: 'BRAND',
      minOccurrences: options.minOccurrences,
      dominantShareThreshold: options.dominantShareThreshold,
    }),
    ...groupBiasPatterns({
      entries,
      field: 'supplier',
      patternType: 'SUPPLIER_DECISION_BIAS',
      scopeType: 'SUPPLIER',
      minOccurrences: options.minOccurrences,
      dominantShareThreshold: options.dominantShareThreshold,
    }),
  ];
  return patterns.sort((left, right) =>
    right.occurrences - left.occurrences ||
    left.patternType.localeCompare(right.patternType, 'en') ||
    left.scopeKey.localeCompare(right.scopeKey, 'ru')
  );
}

function buildDataQuality(entries) {
  const seenDecisionIds = new Set();
  const quality = {
    entriesMissingStableItemKey: 0,
    entriesMissingBrand: 0,
    entriesMissingSupplier: 0,
    entriesMissingReason: 0,
    entriesWithoutAgentRecommendation: 0,
    entriesWithoutOwnerQuantity: 0,
    duplicateDecisionIds: 0,
    unsupportedDecisionValues: 0,
    unsupportedReasonValues: 0,
    invalidRecordedAt: 0,
    warnings: [],
  };
  for (const entry of entries) {
    if (!entry.stableItemKey) quality.entriesMissingStableItemKey += 1;
    if (!entry.brand) quality.entriesMissingBrand += 1;
    if (!entry.supplier) quality.entriesMissingSupplier += 1;
    if (
      !entry.reasonCode ||
      entry.reasonCode === 'NOT_SPECIFIED'
    ) quality.entriesMissingReason += 1;
    if (!entry.agentRecommendation) {
      quality.entriesWithoutAgentRecommendation += 1;
    }
    if (entry.ownerQuantity === null) {
      quality.entriesWithoutOwnerQuantity += 1;
    }
    if (entry.decisionId) {
      if (seenDecisionIds.has(entry.decisionId)) {
        quality.duplicateDecisionIds += 1;
      }
      seenDecisionIds.add(entry.decisionId);
    }
    if (entry.ownerDecisionText && !entry.ownerDecision) {
      quality.unsupportedDecisionValues += 1;
    }
    if (entry.reasonText && !entry.reasonCode) {
      quality.unsupportedReasonValues += 1;
    }
    if (entry.recordedAtTimestamp === null) {
      quality.invalidRecordedAt += 1;
    }
  }
  const warningFields = [
    ['entriesMissingStableItemKey', 'MISSING_STABLE_ITEM_KEY'],
    ['entriesMissingBrand', 'MISSING_BRAND'],
    ['entriesMissingSupplier', 'MISSING_SUPPLIER'],
    ['entriesMissingReason', 'MISSING_REASON'],
    ['entriesWithoutAgentRecommendation', 'MISSING_AGENT_RECOMMENDATION'],
    ['entriesWithoutOwnerQuantity', 'MISSING_OWNER_QUANTITY'],
    ['duplicateDecisionIds', 'DUPLICATE_DECISION_ID'],
    ['unsupportedDecisionValues', 'UNSUPPORTED_DECISION_VALUE'],
    ['unsupportedReasonValues', 'UNSUPPORTED_REASON_VALUE'],
    ['invalidRecordedAt', 'INVALID_RECORDED_AT'],
  ];
  quality.warnings = warningFields
    .filter(([field]) => quality[field] > 0)
    .map(([, warning]) => warning);
  return quality;
}

function analyzeOwnerDecisionHistory({
  history,
  filters = {},
  options = {},
} = {}) {
  const rawEntries = historyEntries(history);
  const normalizedEntries = rawEntries.map(normalizeEntry);
  const normalizedFilters = normalizeFilters(filters);
  const normalizedOptions = normalizeOptions(options);
  const entries = normalizedEntries.filter(entry =>
    entryMatches(entry, normalizedFilters.normalized)
  );
  const ownerDecisionDistribution = countBy(
    entries,
    'ownerDecision',
    OWNER_DECISIONS
  );
  const sourceDistribution = countBy(entries, 'source', SOURCES);
  const itemAnalytics = buildItemAnalytics(
    entries,
    normalizedOptions.maxItems
  );
  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    generatedAt: normalizedOptions.generatedAt ||
      new Date().toISOString(),
    filtersApplied: normalizedFilters.applied,
    population: {
      totalEntries: rawEntries.length,
      filteredEntries: entries.length,
      uniqueItems: new Set(
        entries.map(entry => entry.stableItemKey).filter(Boolean)
      ).size,
      uniqueBrands: new Set(
        entries.map(entry => entry.brand).filter(Boolean)
      ).size,
      uniqueSuppliers: new Set(
        entries.map(entry => entry.supplier).filter(Boolean)
      ).size,
    },
    ownerDecisionDistribution,
    sourceDistribution,
    reasonDistribution: reasonDistribution(entries),
    agreementAnalysis: agreementAnalysis(entries),
    itemAnalytics,
    brandAnalytics: buildBrandAnalytics(entries),
    supplierAnalytics: buildSupplierAnalytics(entries),
    categoryAnalytics: buildCategoryAnalytics(entries),
    repeatedDecisionPatterns: repeatedDecisionPatterns(
      entries,
      normalizedOptions
    ),
    dataQuality: buildDataQuality(entries),
  };
}

function getItemDecisionAnalytics({ history, stableItemKey } = {}) {
  const report = analyzeOwnerDecisionHistory({
    history,
    filters: { stableItemKey },
  });
  return report.itemAnalytics[0] || null;
}

function getBrandDecisionAnalytics({ history, brand } = {}) {
  const report = analyzeOwnerDecisionHistory({
    history,
    filters: { brand },
  });
  return report.brandAnalytics.find(
    item => item.brand === report.filtersApplied.brand
  ) || null;
}

function getSupplierDecisionAnalytics({ history, supplier } = {}) {
  const report = analyzeOwnerDecisionHistory({
    history,
    filters: { supplier },
  });
  return report.supplierAnalytics.find(
    item => item.supplier === report.filtersApplied.supplier
  ) || null;
}

function getDecisionReasonAnalytics({ history } = {}) {
  return analyzeOwnerDecisionHistory({ history }).reasonDistribution;
}

module.exports = {
  ANALYTICS_SCHEMA_VERSION,
  DEFAULT_OPTIONS,
  UNKNOWN_GROUP,
  OwnerDecisionHistoryAnalyticsError,
  analyzeOwnerDecisionHistory,
  getBrandDecisionAnalytics,
  getDecisionReasonAnalytics,
  getItemDecisionAnalytics,
  getSupplierDecisionAnalytics,
};
