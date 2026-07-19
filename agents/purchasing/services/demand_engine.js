const { DEMAND_ENGINE_CONFIG } = require('../config');
const { normalize } = require('../parsers/minmax_parser');
const { normalizeClass } = require('../rules/abc_xyz_rules');
const { matchProductInputs } = require('./product_input_matcher');

const SALES_FIELDS = Object.freeze(['sales7', 'sales14', 'sales30']);
const ASSORTMENT_MATRIX_MODES = Object.freeze(['required', 'optional', 'disabled']);

function round(value, precision = 6) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function roundCurrency(value) {
  return round(value, 2);
}

function validateInputSource(source, sourceName) {
  if (source === null || source === undefined) return null;
  if (!source || typeof source !== 'object' || !Array.isArray(source.products)) {
    throw new TypeError(`${sourceName} requires a products array.`);
  }
  if (typeof source.version !== 'string' || !source.version) {
    throw new TypeError(`${sourceName} requires a version.`);
  }
  return source;
}

function resolveAssortmentMatrixMode(inputs, config = DEMAND_ENGINE_CONFIG) {
  const mode = inputs.assortmentMatrixMode ?? config.assortmentMatrixMode;
  if (!ASSORTMENT_MATRIX_MODES.includes(mode)) {
    throw new TypeError(
      `assortmentMatrixMode must be one of: ${ASSORTMENT_MATRIX_MODES.join(', ')}.`
    );
  }
  return mode;
}

function getAssortmentMatrixStatus(mode, source) {
  if (mode === 'disabled') return 'disabled';
  if (source) return 'provided';
  return mode === 'required' ? 'required_not_provided' : 'not_provided';
}

function getInTransitState(source, record) {
  if (!source) {
    return { inTransitQuantity: null, inTransitStatus: 'source_not_provided' };
  }
  const quantity = valueFromRecord(record, 'inTransitQuantity');
  if (
    quantity === null ||
    typeof quantity !== 'number' ||
    !Number.isFinite(quantity) ||
    quantity < 0
  ) {
    return { inTransitQuantity: null, inTransitStatus: 'quantity_unknown' };
  }
  return {
    inTransitQuantity: quantity,
    inTransitStatus: quantity === 0 ? 'confirmed_zero' : 'known_positive',
  };
}

function getMissingInputDatasets(sources, inputStatus) {
  const missing = [];
  if (!sources.sales) {
    missing.push({
      dataset: 'sales_data',
      status: 'not_provided',
      blocking: true,
      impact: 'demand_quantity_unavailable',
    });
  }
  if (!sources.inTransit) {
    missing.push({
      dataset: 'in_transit_data',
      status: 'not_provided',
      blocking: true,
      impact: 'available_stock_unavailable',
    });
  }
  if (inputStatus.assortmentMatrixStatus === 'not_provided') {
    missing.push({
      dataset: 'assortment_matrix',
      status: 'not_provided_optional',
      blocking: false,
      impact: 'mandatory_gaps_unavailable',
    });
  }
  if (inputStatus.assortmentMatrixStatus === 'required_not_provided') {
    missing.push({
      dataset: 'assortment_matrix',
      status: 'required_not_provided',
      blocking: true,
      impact: 'final_quantity_unavailable',
    });
  }
  return missing;
}

function calculateWeightedSalesRate(sales, config = DEMAND_ENGINE_CONFIG) {
  const missingFields = [];
  const invalidFields = [];
  const dailyRates = {};
  let weightedRate = 0;
  let availableWeight = 0;

  for (const field of SALES_FIELDS) {
    const value = sales[field];
    const definition = config.salesWeights[field];

    if (value === null || value === undefined || value === '') {
      missingFields.push(field);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      invalidFields.push(field);
      continue;
    }

    const dailyRate = value / definition.days;
    dailyRates[field] = round(dailyRate);
    weightedRate += dailyRate * definition.weight;
    availableWeight += definition.weight;
  }

  const allMissing = missingFields.length === SALES_FIELDS.length;
  const allConfirmedZero = SALES_FIELDS.every(field => sales[field] === 0);
  const salesDailyRate = invalidFields.length > 0 || availableWeight === 0
    ? null
    : round(weightedRate / availableWeight);

  return {
    salesDailyRate,
    dailyRates,
    missingFields,
    invalidFields,
    allMissing,
    allConfirmedZero,
    complete: missingFields.length === 0 && invalidFields.length === 0,
  };
}

function detectSalesTrend(metrics, config = DEMAND_ENGINE_CONFIG) {
  const rate7 = metrics.dailyRates.sales7;
  const rate30 = metrics.dailyRates.sales30;
  const hasComparableRates =
    rate7 !== null && rate7 !== undefined &&
    rate30 !== null && rate30 !== undefined;

  if (!hasComparableRates) {
    return { salesTrend: 'unknown', shortTermSalesSpike: false, decliningSales: false };
  }

  const shortTermSalesSpike =
    rate7 > config.trendThresholds.spikeMultiplier * rate30;
  const decliningSales =
    rate30 > 0 && rate7 < config.trendThresholds.declineRatio * rate30;

  return {
    salesTrend: shortTermSalesSpike
      ? 'spike'
      : decliningSales
        ? 'declining'
        : 'consistent',
    shortTermSalesSpike,
    decliningSales,
  };
}

function stockStatus(freeStock) {
  if (freeStock === null || freeStock === undefined) return 'unknown';
  if (freeStock === 0) return 'confirmed_zero';
  if (freeStock < 0) return 'negative';
  return 'positive';
}

function supplierDeliveryCycle(row, inputs, config) {
  const supplier = normalize(row.supplier);
  const inputCycles = inputs.supplierDeliveryCycleDays || {};
  const configured = inputCycles[supplier] ?? config.supplierDeliveryCycleDays.bySupplier[supplier];
  return configured ?? config.supplierDeliveryCycleDays.default ?? null;
}

function matchMetadata(candidate) {
  if (!candidate) {
    return { matched: false, method: null, confidence: null };
  }
  return {
    matched: true,
    method: candidate.method,
    confidence: candidate.confidence,
    recordIndex: candidate.recordIndex,
  };
}

function ambiguousRows(matchResult) {
  const identities = new Set(
    matchResult.rowDiagnostics.map(diagnostic => diagnostic.rowIdentity)
  );
  for (const result of matchResult.recordResults) {
    if (result.status === 'ambiguous') {
      for (const rowIdentity of result.candidateRowIdentities) identities.add(rowIdentity);
    }
  }
  return identities;
}

function valueFromRecord(record, field) {
  if (!record || !Object.hasOwn(record, field)) return null;
  return record[field];
}

function demandQuantityReason(analyzerQuantity, demandQuantity, mandatoryGap) {
  const maximum = Math.max(analyzerQuantity, demandQuantity, mandatoryGap);
  const leaders = [];
  if (analyzerQuantity === maximum) leaders.push('analyzer');
  if (demandQuantity === maximum) leaders.push('demand');
  if (mandatoryGap === maximum) leaders.push('mandatory_gap');
  return leaders.length > 1 ? `equal_maximum:${leaders.join('+')}` : `${leaders[0]}_maximum`;
}

function calculateDemandProduct(row, sources, matches, context, config) {
  const requiredData = [];
  const warnings = [];
  const salesCandidate = matches.sales.matchesByRowIdentity.get(row.rowIdentity);
  const assortmentCandidate = matches.assortment.matchesByRowIdentity.get(row.rowIdentity);
  const transitCandidate = matches.inTransit.matchesByRowIdentity.get(row.rowIdentity);
  const salesRecord = salesCandidate ? salesCandidate.record : null;
  const assortmentRecord = assortmentCandidate ? assortmentCandidate.record : null;
  const transitRecord = transitCandidate ? transitCandidate.record : null;
  const sales = Object.fromEntries(
    SALES_FIELDS.map(field => [field, valueFromRecord(salesRecord, field)])
  );
  const salesMetrics = calculateWeightedSalesRate(sales, config);
  const trend = detectSalesTrend(salesMetrics, config);

  if (sources.sales) {
    for (const field of salesMetrics.missingFields) requiredData.push(field);
  }
  for (const field of salesMetrics.invalidFields) {
    requiredData.push(field);
    warnings.push(`invalid_negative_or_non_numeric_${field}`);
  }
  if (salesMetrics.missingFields.length > 0 && !salesMetrics.allMissing) {
    warnings.push('partial_sales_history');
  }
  if (salesMetrics.allConfirmedZero) warnings.push('zero_sales_30d');
  if (trend.shortTermSalesSpike) warnings.push('short_term_sales_spike');
  if (trend.decliningSales) warnings.push('declining_sales');
  if (context.ambiguousSalesRows.has(row.rowIdentity)) warnings.push('ambiguous_sales_match');
  if (context.ambiguousAssortmentRows.has(row.rowIdentity)) {
    warnings.push('ambiguous_assortment_match');
  }
  if (context.ambiguousTransitRows.has(row.rowIdentity)) {
    warnings.push('ambiguous_in_transit_match');
  }

  const freeStock = row.freeStock ?? null;
  const resolvedStockStatus = stockStatus(freeStock);
  if (resolvedStockStatus === 'unknown') requiredData.push('free_stock');
  if (resolvedStockStatus === 'negative') {
    requiredData.push('free_stock_confirmation');
    warnings.push('negative_free_stock');
  }

  const { inTransitQuantity, inTransitStatus } = getInTransitState(
    sources.inTransit,
    transitRecord
  );
  if (sources.inTransit && transitRecord && inTransitStatus === 'quantity_unknown') {
    warnings.push('invalid_in_transit_quantity');
  }
  if (sources.inTransit && inTransitStatus === 'quantity_unknown') {
    requiredData.push('in_transit_quantity');
  }

  const hasAssortmentMatrix = Boolean(sources.assortment);
  let mandatoryAssortment = null;
  let minDisplayStock = null;
  let assortmentPriority = null;
  let strategicSku = null;
  let strategicBrand = null;

  if (context.assortmentMatrixMode === 'disabled') {
    // Assortment is intentionally excluded from Phase 2 calculations.
  } else if (!hasAssortmentMatrix) {
    // Missing dataset status is reported once at report level.
  } else if (context.ambiguousAssortmentRows.has(row.rowIdentity)) {
    requiredData.push('assortment_match_review');
  } else if (assortmentRecord) {
    if (typeof assortmentRecord.mandatory === 'boolean') {
      mandatoryAssortment = assortmentRecord.mandatory;
    } else {
      requiredData.push('mandatory_assortment');
      warnings.push('invalid_mandatory_assortment');
    }
    minDisplayStock = assortmentRecord.minDisplayStock ??
      (mandatoryAssortment === false ? 0 : null);
    const validPriorities = ['critical', 'high', 'normal'];
    assortmentPriority = validPriorities.includes(assortmentRecord.assortmentPriority)
      ? assortmentRecord.assortmentPriority
      : mandatoryAssortment === false
        ? 'normal'
        : null;
    strategicSku = typeof assortmentRecord.strategicSku === 'boolean'
      ? assortmentRecord.strategicSku
      : null;
    strategicBrand = typeof assortmentRecord.strategicBrand === 'boolean'
      ? assortmentRecord.strategicBrand
      : null;
    if (mandatoryAssortment === true && assortmentPriority === null) {
      requiredData.push('assortment_priority');
      warnings.push('invalid_assortment_priority');
    }
    if (
      typeof minDisplayStock !== 'number' ||
      !Number.isFinite(minDisplayStock) ||
      minDisplayStock < 0
    ) {
      minDisplayStock = null;
      requiredData.push('min_display_stock');
      warnings.push('invalid_min_display_stock');
    }
  } else {
    mandatoryAssortment = false;
    minDisplayStock = 0;
    assortmentPriority = 'normal';
    strategicSku = false;
    strategicBrand = false;
  }

  const deliveryCycleDays = supplierDeliveryCycle(row, context.inputs, config);
  if (
    typeof deliveryCycleDays !== 'number' ||
    !Number.isFinite(deliveryCycleDays) ||
    deliveryCycleDays < 0
  ) {
    requiredData.push('supplier_delivery_cycle_days');
  }
  const abc = normalizeClass(row.abc);
  const xyz = normalizeClass(row.xyz);
  const combination = `${abc}/${xyz}`;
  const safetyStockDays = Object.hasOwn(config.safetyStockDays, combination)
    ? config.safetyStockDays[combination]
    : null;
  if (safetyStockDays === null) requiredData.push('safety_stock_days');

  const targetCoverageDays =
    typeof deliveryCycleDays === 'number' && safetyStockDays !== null
      ? deliveryCycleDays + safetyStockDays
      : null;
  const analyzerCalculatedQuantity = row.orderQty ?? null;
  if (analyzerCalculatedQuantity === null) requiredData.push('analyzer_calculated_quantity');

  const availableStock = freeStock !== null && inTransitQuantity !== null
    ? freeStock + inTransitQuantity
    : null;
  const targetStock =
    salesMetrics.salesDailyRate !== null && targetCoverageDays !== null
      ? Math.ceil(salesMetrics.salesDailyRate * targetCoverageDays)
      : null;
  const demandCalculatedQuantity = targetStock !== null && availableStock !== null
    ? Math.max(0, targetStock - availableStock)
    : null;
  let mandatoryMinimumGap = null;
  if (context.assortmentMatrixMode === 'disabled') {
    mandatoryMinimumGap = 0;
  } else if (!hasAssortmentMatrix) {
    mandatoryMinimumGap = context.assortmentMatrixMode === 'optional' ? 0 : null;
  } else if (
    mandatoryAssortment !== null &&
    minDisplayStock !== null &&
    availableStock !== null
  ) {
    mandatoryMinimumGap = mandatoryAssortment
      ? Math.max(0, minDisplayStock - availableStock)
      : 0;
  }

  const canCalculateFinal =
    analyzerCalculatedQuantity !== null &&
    demandCalculatedQuantity !== null &&
    mandatoryMinimumGap !== null &&
    resolvedStockStatus !== 'negative';
  const finalRecommendedQuantity = canCalculateFinal
    ? Math.max(
      analyzerCalculatedQuantity,
      demandCalculatedQuantity,
      mandatoryMinimumGap
    )
    : null;
  const quantityReason = finalRecommendedQuantity === null
    ? 'incomplete_critical_data'
    : demandQuantityReason(
      analyzerCalculatedQuantity,
      demandCalculatedQuantity,
      mandatoryMinimumGap
    );
  const stockAfterOrder = finalRecommendedQuantity !== null && availableStock !== null
    ? availableStock + finalRecommendedQuantity
    : null;
  const expectedCoverageAfterOrder =
    stockAfterOrder !== null && salesMetrics.salesDailyRate > 0
      ? round(stockAfterOrder / salesMetrics.salesDailyRate, 2)
      : null;

  return {
    rowIdentity: row.rowIdentity,
    rowNumber: row.rowNumber,
    name: row.name,
    article: row.article || null,
    supplier: row.supplier || null,
    abc,
    xyz,
    priceNum: row.priceNum ?? null,
    matchingHints: row.matchingHints,
    sales7: sales.sales7,
    sales14: sales.sales14,
    sales30: sales.sales30,
    salesDailyRate: salesMetrics.salesDailyRate,
    salesStatus: salesMetrics.invalidFields.length > 0
      ? 'invalid'
      : salesMetrics.allMissing
        ? 'missing'
        : salesMetrics.allConfirmedZero
          ? 'confirmed_zero'
          : salesMetrics.complete
            ? 'complete'
            : 'partial',
    salesTrend: trend.salesTrend,
    freeStock,
    stockStatus: resolvedStockStatus,
    inTransitQuantity,
    inTransitStatus,
    mandatoryAssortment,
    minDisplayStock,
    assortmentPriority,
    strategicSku,
    strategicBrand,
    assortmentMatch: matchMetadata(assortmentCandidate),
    salesMatch: matchMetadata(salesCandidate),
    inTransitMatch: matchMetadata(transitCandidate),
    supplierDeliveryCycleDays:
      typeof deliveryCycleDays === 'number' ? deliveryCycleDays : null,
    safetyStockDays,
    targetCoverageDays,
    targetStock,
    availableStock,
    analyzerCalculatedQuantity,
    demandCalculatedQuantity,
    mandatoryMinimumGap,
    finalRecommendedQuantity,
    stockAfterOrder,
    expectedCoverageAfterOrder,
    quantityReason,
    requiredData: Array.from(new Set(requiredData)),
    warnings: Array.from(new Set(warnings)),
  };
}

function sumQuantityValue(products, quantityField) {
  const lines = products.filter(product => product[quantityField] > 0);
  if (lines.some(product => !(product.priceNum > 0))) return null;
  return roundCurrency(
    lines.reduce((sum, product) => sum + product[quantityField] * product.priceNum, 0)
  );
}

function summarizeDemandPlan(products, sources, matches) {
  const demandCalculated = products.filter(product => product.demandCalculatedQuantity !== null);
  const finalCalculated = products.filter(product => product.finalRecommendedQuantity !== null);
  const allFinalComparable = finalCalculated.length === products.length;
  const allPricesKnown = products.every(product => product.priceNum > 0);
  const mandatoryProductsMissing = sources.assortment
    ? matches.assortment.recordResults.filter((result, index) =>
      sources.assortment.products[index].mandatory === true && result.status !== 'matched'
    ).length
    : null;
  const demandOrderLines = demandCalculated.length === 0
    ? null
    : products.filter(product => product.demandCalculatedQuantity > 0).length;

  return {
    productsWithSalesData: products.filter(product => product.salesDailyRate !== null).length,
    productsMissingAllSales: products.filter(product => product.salesStatus === 'missing').length,
    mandatoryProductsMatched: sources.assortment
      ? products.filter(product => product.mandatoryAssortment === true).length
      : null,
    mandatoryProductsMissing,
    mandatoryZeroStockCount: sources.assortment
      ? products.filter(product =>
        product.mandatoryAssortment === true && product.freeStock === 0
      ).length
      : null,
    demandOrderLines,
    demandOrderSum: demandCalculated.length === 0
      ? null
      : sumQuantityValue(products, 'demandCalculatedQuantity'),
    analyzerVsFinalQuantityDelta: allFinalComparable
      ? round(products.reduce(
        (sum, product) =>
          sum + product.finalRecommendedQuantity - product.analyzerCalculatedQuantity,
        0
      ), 2)
      : null,
    analyzerVsFinalSumDelta: allFinalComparable && allPricesKnown
      ? roundCurrency(products.reduce(
        (sum, product) =>
          sum +
          (product.finalRecommendedQuantity - product.analyzerCalculatedQuantity) *
            product.priceNum,
        0
      ))
      : null,
  };
}

function emptyMatchResult() {
  return {
    matchesByRowIdentity: new Map(),
    recordResults: [],
    rowDiagnostics: [],
  };
}

function buildDemandPlan(analysis, phase2Inputs = {}, config = DEMAND_ENGINE_CONFIG) {
  if (!analysis || !Array.isArray(analysis.productRows)) {
    throw new TypeError('Demand engine requires analyzer productRows.');
  }
  if (!phase2Inputs || typeof phase2Inputs !== 'object') {
    throw new TypeError('Demand engine inputs must be an object.');
  }

  const assortmentMatrixMode = resolveAssortmentMatrixMode(phase2Inputs, config);
  const sources = {
    sales: validateInputSource(phase2Inputs.salesData, 'Sales data'),
    assortment: assortmentMatrixMode === 'disabled'
      ? null
      : validateInputSource(
        phase2Inputs.assortmentMatrix,
        'Assortment matrix'
      ),
    inTransit: validateInputSource(phase2Inputs.inTransitData, 'In-transit data'),
  };
  const inputStatus = {
    salesDataStatus: sources.sales ? 'provided' : 'not_provided',
    assortmentMatrixStatus: getAssortmentMatrixStatus(
      assortmentMatrixMode,
      sources.assortment
    ),
    inTransitSourceStatus: sources.inTransit ? 'provided' : 'not_provided',
  };
  const rows = analysis.productRows;
  const matches = {
    sales: sources.sales
      ? matchProductInputs(rows, sources.sales.products, 'Sales data')
      : emptyMatchResult(),
    assortment: sources.assortment
      ? matchProductInputs(rows, sources.assortment.products, 'Assortment matrix')
      : emptyMatchResult(),
    inTransit: sources.inTransit
      ? matchProductInputs(rows, sources.inTransit.products, 'In-transit data')
      : emptyMatchResult(),
  };
  const context = {
    inputs: phase2Inputs,
    assortmentMatrixMode,
    ambiguousSalesRows: ambiguousRows(matches.sales),
    ambiguousAssortmentRows: ambiguousRows(matches.assortment),
    ambiguousTransitRows: ambiguousRows(matches.inTransit),
  };
  const products = rows.map(row =>
    calculateDemandProduct(row, sources, matches, context, config)
  );

  return {
    demandVersion: config.version,
    products,
    inputStatus,
    missingInputDatasets: getMissingInputDatasets(sources, inputStatus),
    diagnostics: {
      salesMatches: matches.sales.recordResults,
      assortmentMatches: matches.assortment.recordResults,
      inTransitMatches: matches.inTransit.recordResults,
      salesRowDiagnostics: matches.sales.rowDiagnostics,
      assortmentRowDiagnostics: matches.assortment.rowDiagnostics,
      inTransitRowDiagnostics: matches.inTransit.rowDiagnostics,
    },
    summary: summarizeDemandPlan(products, sources, matches),
  };
}

module.exports = {
  SALES_FIELDS,
  ASSORTMENT_MATRIX_MODES,
  round,
  resolveAssortmentMatrixMode,
  getAssortmentMatrixStatus,
  getInTransitState,
  getMissingInputDatasets,
  calculateWeightedSalesRate,
  detectSalesTrend,
  stockStatus,
  demandQuantityReason,
  calculateDemandProduct,
  summarizeDemandPlan,
  buildDemandPlan,
};
