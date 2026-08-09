const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  HISTORY_SCHEMA_VERSION,
  createDecisionHistoryEntry,
} = require('../owner_learning/owner_decision_history');
const {
  ANALYTICS_SCHEMA_VERSION,
  UNKNOWN_GROUP,
  OwnerDecisionHistoryAnalyticsError,
  analyzeOwnerDecisionHistory,
  getBrandDecisionAnalytics,
  getDecisionReasonAnalytics,
  getItemDecisionAnalytics,
  getSupplierDecisionAnalytics,
} = require(
  '../owner_learning/owner_decision_history_analytics'
);

function history(entries = []) {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    updatedAt: entries.at(-1)?.recordedAt || null,
    entries,
  };
}

function entry(sequence, overrides = {}) {
  const day = String(Math.min(sequence, 28)).padStart(2, '0');
  return createDecisionHistoryEntry({
    recordedAt: `2026-07-${day}T10:00:00.000Z`,
    source: 'OWNER_REVIEW',
    runId: `run-${sequence}`,
    supplier: 'Валта',
    stableItemKey: 'sku:SKU-1',
    sku: 'SKU-1',
    productName: 'Товар 1',
    brand: 'Alpha',
    category: 'Корм',
    agentRecommendation: 'BUY',
    agentQuantity: 5,
    ownerDecision: 'BUY',
    ownerQuantity: 5,
    reasonCode: 'OTHER',
    ownerComment: 'Скрытый комментарий',
    ruleId: null,
    applicationMode: 'PREVIEW',
    financialContext: {},
    inventoryContext: {},
    salesContext: {},
    metadata: { privateNote: 'Скрытые metadata' },
    ...overrides,
  });
}

function report(entries, overrides = {}) {
  return analyzeOwnerDecisionHistory({
    history: history(entries),
    options: {
      generatedAt: '2026-07-25T00:00:00.000Z',
      ...(overrides.options || {}),
    },
    filters: overrides.filters || {},
  });
}

function patternByType(result, patternType) {
  return result.repeatedDecisionPatterns.find(
    pattern => pattern.patternType === patternType
  );
}

function repeatedItemEntries({
  count = 3,
  ownerDecision = 'SKIP',
  reasonCode = 'LOW_SALES',
  agentRecommendation = 'BUY',
  stableItemKey = 'sku:SKU-1',
  brand = 'Alpha',
  supplier = 'Валта',
} = {}) {
  return Array.from({ length: count }, (_, index) => entry(index + 1, {
    stableItemKey,
    sku: stableItemKey.replace(/^sku:/, ''),
    ownerDecision,
    ownerQuantity: ownerDecision === 'BUY' ? 5 : 0,
    reasonCode,
    agentRecommendation,
    brand,
    supplier,
  }));
}

test('empty history produces a complete zero analytics report', () => {
  const result = report([]);

  assert.equal(result.schemaVersion, ANALYTICS_SCHEMA_VERSION);
  assert.deepEqual(result.population, {
    totalEntries: 0,
    filteredEntries: 0,
    uniqueItems: 0,
    uniqueBrands: 0,
    uniqueSuppliers: 0,
  });
  assert.deepEqual(result.ownerDecisionDistribution, {
    BUY: 0,
    SKIP: 0,
    DEFER: 0,
    REVIEW: 0,
    BUY_NOW: 0,
    POSTPONE: 0,
    REMOVE_FROM_MATRIX: 0,
  });
  assert.equal(result.agreementAnalysis.agreementRate, null);
  assert.deepEqual(result.itemAnalytics, []);
});

test('one BUY entry is counted without inventing patterns', () => {
  const result = report([entry(1)]);

  assert.equal(result.population.filteredEntries, 1);
  assert.equal(result.ownerDecisionDistribution.BUY, 1);
  assert.equal(result.sourceDistribution.OWNER_REVIEW, 1);
  assert.equal(result.repeatedDecisionPatterns.length, 0);
});

test('owner decision distribution keeps all supported decisions', () => {
  const entries = ['BUY', 'SKIP', 'DEFER', 'REVIEW', 'BUY_NOW', 'POSTPONE', 'REMOVE_FROM_MATRIX'].map(
    (ownerDecision, index) => entry(index + 1, {
      stableItemKey: `sku:SKU-${index + 1}`,
      sku: `SKU-${index + 1}`,
      ownerDecision,
      ownerQuantity: ownerDecision === 'BUY' || ownerDecision === 'BUY_NOW' ? 1 : 0,
    })
  );

  assert.deepEqual(report(entries).ownerDecisionDistribution, {
    BUY: 1,
    SKIP: 1,
    DEFER: 1,
    REVIEW: 1,
    BUY_NOW: 1,
    POSTPONE: 1,
    REMOVE_FROM_MATRIX: 1,
  });
});

test('item analytics merges runs by SKU and keeps the latest decision details', () => {
  const result = report([
    entry(1, {
      runId: 'run-old',
      stableItemKey: 'sku:SHARED',
      sku: 'SHARED',
      ownerDecision: 'SKIP',
      ownerQuantity: 0,
      reasonCode: 'HIGH_STOCK',
      ownerComment: 'Сначала пропустить',
    }),
    entry(2, {
      runId: 'run-new',
      stableItemKey: 'sku:SHARED',
      sku: 'SHARED',
      ownerDecision: 'BUY',
      ownerQuantity: 7,
      reasonCode: 'CUSTOMER_REQUEST',
      ownerComment: 'Заказать клиенту',
    }),
    entry(3, {
      stableItemKey: 'sku:SEPARATE',
      sku: 'SEPARATE',
      ownerDecision: 'DEFER',
      ownerQuantity: 0,
      reasonCode: 'WAIT_NEXT_DELIVERY',
      ownerComment: 'Другой товар',
    }),
  ]);
  const shared = result.itemAnalytics.find(
    item => item.stableItemKey === 'sku:SHARED'
  );
  const separate = result.itemAnalytics.find(
    item => item.stableItemKey === 'sku:SEPARATE'
  );

  assert.equal(result.itemAnalytics.length, 2);
  assert.equal(shared.totalEntries, 2);
  assert.deepEqual(shared.decisionsByType, {
    BUY: 1,
    SKIP: 1,
    DEFER: 0,
    REVIEW: 0,
    BUY_NOW: 0,
    POSTPONE: 0,
    REMOVE_FROM_MATRIX: 0,
  });
  assert.equal(shared.reasonsByType.HIGH_STOCK, 1);
  assert.equal(shared.reasonsByType.CUSTOMER_REQUEST, 1);
  assert.equal(shared.latestOwnerDecision, 'BUY');
  assert.equal(shared.latestOwnerQuantity, 7);
  assert.equal(shared.latestReasonCode, 'CUSTOMER_REQUEST');
  assert.equal(shared.latestOwnerComment, 'Заказать клиенту');
  assert.equal(shared.lastRecordedAt, '2026-07-02T10:00:00.000Z');
  assert.equal(separate.totalEntries, 1);
  assert.equal(separate.latestOwnerDecision, 'DEFER');
});

test('reason distribution contains count, share, and stable sorting', () => {
  const entries = [
    entry(1, { reasonCode: 'LOW_SALES' }),
    entry(2, { reasonCode: 'OTHER' }),
    entry(3, { reasonCode: 'LOW_SALES' }),
  ];

  const reasons = getDecisionReasonAnalytics({
    history: history(entries),
  });

  assert.deepEqual(reasons, [
    { reasonCode: 'LOW_SALES', count: 2, share: 0.6667 },
    { reasonCode: 'OTHER', count: 1, share: 0.3333 },
  ]);
});

test('matching recommendation and quantity are exact agreements', () => {
  const agreement = report([entry(1)]).agreementAnalysis;

  assert.deepEqual(agreement, {
    comparableEntries: 1,
    agreements: 1,
    disagreements: 0,
    agreementRate: 1,
    quantityComparableEntries: 1,
    exactQuantityMatches: 1,
    quantityMatchRate: 1,
    ownerIncreasedQuantity: 0,
    ownerDecreasedQuantity: 0,
    ownerChangedDecision: 0,
  });
});

test('BUY 5 versus BUY 8 agrees on decision and changes quantity', () => {
  const agreement = report([entry(1, {
    agentQuantity: 5,
    ownerQuantity: 8,
  })]).agreementAnalysis;

  assert.equal(agreement.agreements, 1);
  assert.equal(agreement.disagreements, 0);
  assert.equal(agreement.quantityComparableEntries, 1);
  assert.equal(agreement.exactQuantityMatches, 0);
  assert.equal(agreement.ownerIncreasedQuantity, 1);
  assert.equal(agreement.quantityMatchRate, 0);
});

test('BUY versus SKIP is a decision disagreement', () => {
  const agreement = report([entry(1, {
    agentRecommendation: 'BUY',
    ownerDecision: 'SKIP',
    ownerQuantity: 0,
  })]).agreementAnalysis;

  assert.equal(agreement.comparableEntries, 1);
  assert.equal(agreement.disagreements, 1);
  assert.equal(agreement.ownerChangedDecision, 1);
  assert.equal(agreement.quantityComparableEntries, 0);
  assert.equal(agreement.quantityMatchRate, null);
});

test('zero comparable population returns null rates', () => {
  const agreement = report([entry(1, {
    agentRecommendation: null,
    ownerDecision: 'REVIEW',
    ownerQuantity: null,
  })]).agreementAnalysis;

  assert.equal(agreement.comparableEntries, 0);
  assert.equal(agreement.agreementRate, null);
  assert.equal(agreement.quantityComparableEntries, 0);
  assert.equal(agreement.quantityMatchRate, null);
});

test('item analytics aggregates identity, decisions, and quantities', () => {
  const entries = [
    entry(1),
    entry(2, {
      ownerDecision: 'SKIP',
      ownerQuantity: 0,
      reasonCode: 'LOW_SALES',
    }),
  ];
  const item = getItemDecisionAnalytics({
    history: history(entries),
    stableItemKey: 'sku:SKU-1',
  });

  assert.equal(item.totalEntries, 2);
  assert.equal(item.sku, 'SKU-1');
  assert.deepEqual(item.decisionsByType, {
    BUY: 1,
    SKIP: 1,
    DEFER: 0,
    REVIEW: 0,
    BUY_NOW: 0,
    POSTPONE: 0,
    REMOVE_FROM_MATRIX: 0,
  });
  assert.equal(item.agreements, 1);
  assert.equal(item.disagreements, 1);
  assert.equal(item.agreementRate, 0.5);
  assert.equal(item.averageOwnerQuantity, 2.5);
  assert.equal(item.repeatedSameDecisionCount, 1);
  assert.equal(item.dominantOwnerDecision, 'BUY');
});

test('brand analytics aggregates unique items and dominant values', () => {
  const entries = [
    entry(1),
    entry(2, {
      stableItemKey: 'sku:SKU-2',
      sku: 'SKU-2',
      ownerDecision: 'SKIP',
      ownerQuantity: 0,
      reasonCode: 'LOW_SALES',
    }),
  ];
  const brand = getBrandDecisionAnalytics({
    history: history(entries),
    brand: 'Alpha',
  });

  assert.equal(brand.brand, 'Alpha');
  assert.equal(brand.totalEntries, 2);
  assert.equal(brand.uniqueItems, 2);
  assert.equal(brand.decisionsByType.BUY, 1);
  assert.equal(brand.decisionsByType.SKIP, 1);
  assert.equal(brand.dominantOwnerDecision, 'BUY');
});

test('supplier analytics includes unique brands and items', () => {
  const entries = [
    entry(1),
    entry(2, {
      stableItemKey: 'sku:SKU-2',
      sku: 'SKU-2',
      brand: 'Beta',
    }),
  ];
  const supplier = getSupplierDecisionAnalytics({
    history: history(entries),
    supplier: 'Валта',
  });

  assert.equal(supplier.supplier, 'Валта');
  assert.equal(supplier.totalEntries, 2);
  assert.equal(supplier.uniqueBrands, 2);
  assert.equal(supplier.uniqueItems, 2);
});

test('category analytics and category filter are deterministic', () => {
  const entries = [
    entry(1, { category: 'Корм' }),
    entry(2, {
      stableItemKey: 'sku:SKU-2',
      sku: 'SKU-2',
      category: 'Игрушки',
    }),
  ];
  const result = report(entries, {
    filters: { category: 'Игрушки' },
  });

  assert.equal(result.population.filteredEntries, 1);
  assert.equal(result.categoryAnalytics.length, 1);
  assert.equal(result.categoryAnalytics[0].category, 'Игрушки');
});

test('detects SAME_ITEM_SAME_DECISION', () => {
  const pattern = patternByType(
    report(repeatedItemEntries()),
    'SAME_ITEM_SAME_DECISION'
  );

  assert.equal(pattern.scopeKey, 'sku:SKU-1');
  assert.equal(pattern.occurrences, 3);
  assert.equal(pattern.dominantValue, 'SKIP');
  assert.equal(pattern.share, 1);
  assert.deepEqual(
    pattern.evidenceDecisionIds,
    [...pattern.evidenceDecisionIds].sort()
  );
});

test('detects SAME_ITEM_SAME_REASON', () => {
  const pattern = patternByType(
    report(repeatedItemEntries()),
    'SAME_ITEM_SAME_REASON'
  );

  assert.equal(pattern.occurrences, 3);
  assert.equal(pattern.dominantValue, 'LOW_SALES');
  assert.equal(pattern.share, 1);
});

test('detects BRAND_DECISION_BIAS', () => {
  const entries = [
    ...repeatedItemEntries({
      stableItemKey: 'sku:SKU-1',
      count: 2,
    }),
    entry(3, {
      stableItemKey: 'sku:SKU-2',
      sku: 'SKU-2',
      ownerDecision: 'SKIP',
      ownerQuantity: 0,
      reasonCode: 'LOW_SALES',
    }),
  ];
  const pattern = patternByType(
    report(entries),
    'BRAND_DECISION_BIAS'
  );

  assert.equal(pattern.scopeKey, 'Alpha');
  assert.equal(pattern.occurrences, 3);
  assert.equal(pattern.dominantValue, 'SKIP');
});

test('detects SUPPLIER_DECISION_BIAS', () => {
  const pattern = patternByType(
    report(repeatedItemEntries()),
    'SUPPLIER_DECISION_BIAS'
  );

  assert.equal(pattern.scopeKey, 'Валта');
  assert.equal(pattern.occurrences, 3);
  assert.equal(pattern.dominantValue, 'SKIP');
});

test('detects AGENT_DISAGREEMENT_REPEAT without judging correctness', () => {
  const pattern = patternByType(
    report(repeatedItemEntries()),
    'AGENT_DISAGREEMENT_REPEAT'
  );

  assert.equal(pattern.occurrences, 3);
  assert.equal(pattern.dominantValue, 'BUY->SKIP');
  assert.equal(pattern.share, 1);
});

test('minOccurrences prevents premature patterns', () => {
  const result = report(repeatedItemEntries(), {
    options: { minOccurrences: 4 },
  });

  assert.deepEqual(result.repeatedDecisionPatterns, []);
});

test('dominantShareThreshold is inclusive and configurable', () => {
  const entries = [
    ...repeatedItemEntries({ count: 3 }),
    entry(4, {
      stableItemKey: 'sku:SKU-2',
      sku: 'SKU-2',
      ownerDecision: 'BUY',
      ownerQuantity: 5,
    }),
  ];
  const inclusive = report(entries, {
    options: { dominantShareThreshold: 0.75 },
  });
  const strict = report(entries, {
    options: { dominantShareThreshold: 0.76 },
  });

  assert.ok(patternByType(inclusive, 'BRAND_DECISION_BIAS'));
  assert.equal(patternByType(strict, 'BRAND_DECISION_BIAS'), undefined);
});

test('supplier and source filters are applied before analytics', () => {
  const entries = [
    entry(1),
    entry(2, {
      supplier: 'Другой',
      source: 'APPROVED_RULE',
      ruleId: 'rule-2',
    }),
  ];
  const result = report(entries, {
    filters: {
      supplier: 'Другой',
      source: 'APPROVED_RULE',
    },
  });

  assert.equal(result.population.totalEntries, 2);
  assert.equal(result.population.filteredEntries, 1);
  assert.deepEqual(result.filtersApplied, {
    source: 'APPROVED_RULE',
    supplier: 'Другой',
  });
});

test('brand filter selects only exact normalized brand', () => {
  const result = report([
    entry(1),
    entry(2, { brand: 'Beta' }),
  ], {
    filters: { brand: 'Beta' },
  });

  assert.equal(result.population.filteredEntries, 1);
  assert.equal(result.brandAnalytics[0].brand, 'Beta');
});

test('ownerDecision filter excludes all other decisions', () => {
  const result = report([
    entry(1),
    entry(2, {
      ownerDecision: 'SKIP',
      ownerQuantity: 0,
    }),
  ], {
    filters: { ownerDecision: 'SKIP' },
  });

  assert.equal(result.population.filteredEntries, 1);
  assert.equal(result.ownerDecisionDistribution.SKIP, 1);
  assert.equal(result.ownerDecisionDistribution.BUY, 0);
});

test('reasonCode filter uses supported reason values', () => {
  const result = report([
    entry(1, { reasonCode: 'OTHER' }),
    entry(2, { reasonCode: 'LOW_SALES' }),
  ], {
    filters: { reasonCode: 'LOW_SALES' },
  });

  assert.equal(result.population.filteredEntries, 1);
  assert.deepEqual(result.reasonDistribution, [{
    reasonCode: 'LOW_SALES',
    count: 1,
    share: 1,
  }]);
});

test('dateFrom and dateTo include the complete UTC date', () => {
  const entries = [
    entry(1, { recordedAt: '2026-07-01T23:59:59.999Z' }),
    entry(2, { recordedAt: '2026-07-02T00:00:00.000Z' }),
    entry(3, { recordedAt: '2026-07-02T23:59:59.999Z' }),
    entry(4, { recordedAt: '2026-07-03T00:00:00.000Z' }),
  ];
  const result = report(entries, {
    filters: {
      dateFrom: '2026-07-02',
      dateTo: '2026-07-02',
    },
  });

  assert.equal(result.population.filteredEntries, 2);
  assert.deepEqual(result.filtersApplied, {
    dateFrom: '2026-07-02',
    dateTo: '2026-07-02',
  });
});

test('invalid date filters return a safe validation error', () => {
  assert.throws(
    () => report([], {
      filters: { dateFrom: '2026-02-30' },
    }),
    error =>
      error instanceof OwnerDecisionHistoryAnalyticsError &&
      error.code === 'OWNER_DECISION_ANALYTICS_INVALID_INPUT' &&
      !error.message.includes('/Users/')
  );
  assert.throws(
    () => report([], {
      filters: {
        dateFrom: '2026-07-03',
        dateTo: '2026-07-02',
      },
    }),
    /dateFrom/
  );
});

test('missing group values use __UNKNOWN__ without merging items', () => {
  const raw = {
    ...entry(1),
    brand: null,
    supplier: null,
    category: null,
  };
  const result = report([raw]);

  assert.equal(result.brandAnalytics[0].brand, UNKNOWN_GROUP);
  assert.equal(result.supplierAnalytics[0].supplier, UNKNOWN_GROUP);
  assert.equal(result.categoryAnalytics[0].category, UNKNOWN_GROUP);
  assert.equal(result.population.uniqueBrands, 0);
  assert.equal(result.population.uniqueSuppliers, 0);
  assert.equal(result.itemAnalytics[0].stableItemKey, 'sku:SKU-1');
});

test('data quality counts missing fields consistently', () => {
  const result = analyzeOwnerDecisionHistory({
    history: [{
      decisionId: 'quality-1',
      recordedAt: 'not-a-date',
      source: 'OWNER_REVIEW',
      stableItemKey: null,
      brand: '',
      supplier: null,
      ownerDecision: 'BUY',
      reasonCode: 'NOT_SPECIFIED',
      agentRecommendation: null,
      ownerQuantity: null,
    }],
    options: { generatedAt: '2026-07-25T00:00:00.000Z' },
  });
  const quality = result.dataQuality;

  assert.equal(quality.entriesMissingStableItemKey, 1);
  assert.equal(quality.entriesMissingBrand, 1);
  assert.equal(quality.entriesMissingSupplier, 1);
  assert.equal(quality.entriesMissingReason, 1);
  assert.equal(quality.entriesWithoutAgentRecommendation, 1);
  assert.equal(quality.entriesWithoutOwnerQuantity, 1);
  assert.equal(quality.invalidRecordedAt, 1);
  assert.ok(quality.warnings.includes('MISSING_STABLE_ITEM_KEY'));
});

test('duplicate decision IDs count only repeated occurrences', () => {
  const first = entry(1);
  const result = report([first, structuredClone(first)]);

  assert.equal(result.dataQuality.duplicateDecisionIds, 1);
  assert.ok(
    result.dataQuality.warnings.includes('DUPLICATE_DECISION_ID')
  );
});

test('unsupported decisions and reasons never create false matches', () => {
  const invalid = {
    ...entry(1),
    ownerDecision: 'UNKNOWN_DECISION',
    reasonCode: 'UNKNOWN_REASON',
  };
  const result = report([invalid]);

  assert.equal(result.dataQuality.unsupportedDecisionValues, 1);
  assert.equal(result.dataQuality.unsupportedReasonValues, 1);
  assert.equal(result.ownerDecisionDistribution.BUY, 0);
  assert.equal(result.agreementAnalysis.comparableEntries, 0);
});

test('decision history exposes comment but not metadata or absolute paths', () => {
  const unsafe = {
    ...entry(1),
    ownerComment: 'Нельзя раскрывать',
    metadata: { secret: 'Нельзя раскрывать metadata' },
    brand: '/Users/private/brand',
  };
  const serialized = JSON.stringify(report([unsafe]));

  assert.equal(serialized.includes('ownerComment'), true);
  assert.equal(serialized.includes('metadata'), false);
  assert.equal(serialized.includes('Нельзя раскрывать'), true);
  assert.equal(serialized.includes('Нельзя раскрывать metadata'), false);
  assert.equal(serialized.includes('/Users/'), false);
});

test('analytics never mutates history, filters, or options', () => {
  const input = {
    history: history([entry(1)]),
    filters: { supplier: 'Валта' },
    options: {
      minOccurrences: 2,
      generatedAt: '2026-07-25T00:00:00.000Z',
    },
  };
  const snapshot = structuredClone(input);

  analyzeOwnerDecisionHistory(input);

  assert.deepEqual(input, snapshot);
});

test('identical input is deterministic apart from generatedAt', () => {
  const inputHistory = history(repeatedItemEntries());
  const first = analyzeOwnerDecisionHistory({
    history: inputHistory,
  });
  const second = analyzeOwnerDecisionHistory({
    history: inputHistory,
  });

  delete first.generatedAt;
  delete second.generatedAt;
  assert.deepEqual(second, first);
});

test('groups and patterns use deterministic documented sorting', () => {
  const entries = [
    entry(1, {
      stableItemKey: 'sku:B',
      sku: 'B',
      brand: 'Beta',
    }),
    entry(2, {
      stableItemKey: 'sku:A',
      sku: 'A',
      brand: 'Alpha',
    }),
    entry(3, {
      stableItemKey: 'sku:A',
      sku: 'A',
      brand: 'Alpha',
    }),
  ];
  const result = report(entries, {
    options: { minOccurrences: 2 },
  });

  assert.deepEqual(
    result.itemAnalytics.map(item => item.stableItemKey),
    ['sku:A', 'sku:B']
  );
  assert.deepEqual(
    result.brandAnalytics.map(item => item.brand),
    ['Alpha', 'Beta']
  );
  const sorted = [...result.repeatedDecisionPatterns].sort(
    (left, right) =>
      right.occurrences - left.occurrences ||
      left.patternType.localeCompare(right.patternType, 'en') ||
      left.scopeKey.localeCompare(right.scopeKey, 'ru')
  );
  assert.deepEqual(result.repeatedDecisionPatterns, sorted);
});

test('maxItems limits item analytics and recent decision history', () => {
  const result = report([
    entry(1, {
      stableItemKey: 'sku:A',
      sku: 'A',
    }),
    entry(2, {
      stableItemKey: 'sku:B',
      sku: 'B',
    }),
    entry(3, {
      stableItemKey: 'sku:B',
      sku: 'B',
    }),
  ], {
    options: { maxItems: 1 },
  });

  assert.equal(result.itemAnalytics.length, 1);
  assert.equal(result.decisionHistory.length, 1);
  assert.equal(result.decisionHistory[0].sku, 'B');
  assert.equal(result.itemAnalytics[0].stableItemKey, 'sku:B');
  assert.equal(result.population.uniqueItems, 2);
});

test('quantity averages remain null when quantities are absent', () => {
  const result = report([entry(1, {
    agentQuantity: null,
    ownerQuantity: null,
  })]);
  const item = result.itemAnalytics[0];

  assert.equal(item.averageAgentQuantity, null);
  assert.equal(item.averageOwnerQuantity, null);
  assert.equal(item.ownerQuantityDeltaAverage, null);
  assert.equal(
    result.agreementAnalysis.quantityComparableEntries,
    0
  );
  assert.equal(result.agreementAnalysis.quantityMatchRate, null);
});
