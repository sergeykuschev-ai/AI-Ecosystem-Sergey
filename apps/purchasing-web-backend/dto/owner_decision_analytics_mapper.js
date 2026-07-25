function mapCounts(counts, keys) {
  return Object.fromEntries(keys.map(key => [
    key,
    Number.isInteger(counts?.[key]) ? counts[key] : 0,
  ]));
}

function nullableNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function nullableText(value) {
  return typeof value === 'string' ? value : null;
}

function mapAgreement(value = {}) {
  return {
    comparableEntries: value.comparableEntries ?? 0,
    agreements: value.agreements ?? 0,
    disagreements: value.disagreements ?? 0,
    agreementRate: nullableNumber(value.agreementRate),
    quantityComparableEntries: value.quantityComparableEntries ?? 0,
    exactQuantityMatches: value.exactQuantityMatches ?? 0,
    quantityMatchRate: nullableNumber(value.quantityMatchRate),
    ownerIncreasedQuantity: value.ownerIncreasedQuantity ?? 0,
    ownerDecreasedQuantity: value.ownerDecreasedQuantity ?? 0,
    ownerChangedDecision: value.ownerChangedDecision ?? 0,
  };
}

function mapGroup(value, keyName, extra = {}) {
  return {
    [keyName]: nullableText(value?.[keyName]),
    ...extra,
    totalEntries: value?.totalEntries ?? 0,
    decisionsByType: mapCounts(value?.decisionsByType, [
      'BUY',
      'SKIP',
      'DEFER',
      'REVIEW',
    ]),
    reasonsByType: mapCounts(value?.reasonsByType, [
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
    ]),
    agreements: value?.agreements ?? 0,
    disagreements: value?.disagreements ?? 0,
    agreementRate: nullableNumber(value?.agreementRate),
    averageOwnerQuantity: nullableNumber(value?.averageOwnerQuantity),
    averageQuantityDelta: nullableNumber(value?.averageQuantityDelta),
    dominantOwnerDecision: nullableText(value?.dominantOwnerDecision),
    dominantReason: nullableText(value?.dominantReason),
  };
}

function mapItem(value = {}) {
  return {
    stableItemKey: nullableText(value.stableItemKey),
    sku: nullableText(value.sku),
    productName: nullableText(value.productName),
    brand: nullableText(value.brand),
    category: nullableText(value.category),
    supplier: nullableText(value.supplier),
    totalEntries: value.totalEntries ?? 0,
    decisionsByType: mapCounts(value.decisionsByType, [
      'BUY',
      'SKIP',
      'DEFER',
      'REVIEW',
    ]),
    reasonsByType: mapCounts(value.reasonsByType, [
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
    ]),
    agentRecommendationsByType: mapCounts(
      value.agentRecommendationsByType,
      ['BUY', 'SKIP', 'DEFER', 'UNKNOWN']
    ),
    agreements: value.agreements ?? 0,
    disagreements: value.disagreements ?? 0,
    agreementRate: nullableNumber(value.agreementRate),
    averageAgentQuantity: nullableNumber(value.averageAgentQuantity),
    averageOwnerQuantity: nullableNumber(value.averageOwnerQuantity),
    ownerQuantityDeltaAverage:
      nullableNumber(value.ownerQuantityDeltaAverage),
    firstRecordedAt: nullableText(value.firstRecordedAt),
    lastRecordedAt: nullableText(value.lastRecordedAt),
    repeatedSameDecisionCount: value.repeatedSameDecisionCount ?? 0,
    dominantOwnerDecision: nullableText(value.dominantOwnerDecision),
    dominantReason: nullableText(value.dominantReason),
  };
}

function mapAnalytics(analytics = {}) {
  const quality = analytics.dataQuality || {};
  return {
    schemaVersion: nullableText(analytics.schemaVersion),
    generatedAt: nullableText(analytics.generatedAt),
    filtersApplied: {
      source: nullableText(analytics.filtersApplied?.source),
      supplier: nullableText(analytics.filtersApplied?.supplier),
      brand: nullableText(analytics.filtersApplied?.brand),
      category: nullableText(analytics.filtersApplied?.category),
      stableItemKey:
        nullableText(analytics.filtersApplied?.stableItemKey),
      ownerDecision:
        nullableText(analytics.filtersApplied?.ownerDecision),
      reasonCode: nullableText(analytics.filtersApplied?.reasonCode),
      dateFrom: nullableText(analytics.filtersApplied?.dateFrom),
      dateTo: nullableText(analytics.filtersApplied?.dateTo),
    },
    population: {
      totalEntries: analytics.population?.totalEntries ?? 0,
      filteredEntries: analytics.population?.filteredEntries ?? 0,
      uniqueItems: analytics.population?.uniqueItems ?? 0,
      uniqueBrands: analytics.population?.uniqueBrands ?? 0,
      uniqueSuppliers: analytics.population?.uniqueSuppliers ?? 0,
    },
    ownerDecisionDistribution: mapCounts(
      analytics.ownerDecisionDistribution,
      ['BUY', 'SKIP', 'DEFER', 'REVIEW']
    ),
    sourceDistribution: mapCounts(analytics.sourceDistribution, [
      'OWNER_REVIEW',
      'APPROVED_RULE',
      'MANUAL_OVERRIDE',
      'IMPORTED_HISTORY',
    ]),
    reasonDistribution: (analytics.reasonDistribution || []).map(item => ({
      reasonCode: nullableText(item.reasonCode),
      count: item.count ?? 0,
      share: nullableNumber(item.share),
    })),
    agreementAnalysis: mapAgreement(analytics.agreementAnalysis),
    itemAnalytics: (analytics.itemAnalytics || []).map(mapItem),
    brandAnalytics: (analytics.brandAnalytics || []).map(item =>
      mapGroup(item, 'brand', {
        uniqueItems: item.uniqueItems ?? 0,
      })
    ),
    supplierAnalytics: (analytics.supplierAnalytics || []).map(item =>
      mapGroup(item, 'supplier', {
        uniqueBrands: item.uniqueBrands ?? 0,
        uniqueItems: item.uniqueItems ?? 0,
      })
    ),
    categoryAnalytics: (analytics.categoryAnalytics || []).map(item =>
      mapGroup(item, 'category', {
        uniqueItems: item.uniqueItems ?? 0,
      })
    ),
    repeatedDecisionPatterns:
      (analytics.repeatedDecisionPatterns || []).map(item => ({
        patternType: nullableText(item.patternType),
        scopeType: nullableText(item.scopeType),
        scopeKey: nullableText(item.scopeKey),
        occurrences: item.occurrences ?? 0,
        dominantValue: nullableText(item.dominantValue),
        share: nullableNumber(item.share),
        firstRecordedAt: nullableText(item.firstRecordedAt),
        lastRecordedAt: nullableText(item.lastRecordedAt),
      })),
    dataQuality: {
      entriesMissingStableItemKey:
        quality.entriesMissingStableItemKey ?? 0,
      entriesMissingBrand: quality.entriesMissingBrand ?? 0,
      entriesMissingSupplier: quality.entriesMissingSupplier ?? 0,
      entriesMissingReason: quality.entriesMissingReason ?? 0,
      entriesWithoutAgentRecommendation:
        quality.entriesWithoutAgentRecommendation ?? 0,
      entriesWithoutOwnerQuantity:
        quality.entriesWithoutOwnerQuantity ?? 0,
      duplicateDecisionIds: quality.duplicateDecisionIds ?? 0,
      unsupportedDecisionValues:
        quality.unsupportedDecisionValues ?? 0,
      unsupportedReasonValues: quality.unsupportedReasonValues ?? 0,
      invalidRecordedAt: quality.invalidRecordedAt ?? 0,
      warnings: Array.isArray(quality.warnings)
        ? quality.warnings.filter(value => typeof value === 'string')
        : [],
    },
  };
}

function mapOwnerDecisionAnalytics(result = {}) {
  return {
    status: result.status === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE',
    data: result.status === 'AVAILABLE' && result.analytics
      ? mapAnalytics(result.analytics)
      : null,
    warning: nullableText(result.warning),
  };
}

module.exports = {
  mapAnalytics,
  mapOwnerDecisionAnalytics,
};
