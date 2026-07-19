const { DEMAND_ENGINE_CONFIG } = require('../config');
const { normalize } = require('../parsers/minmax_parser');
const { normalizeClass } = require('../rules/abc_xyz_rules');
const { matchProductInputs } = require('./product_input_matcher');

const SALES_FIELDS = Object.freeze(['sales7', 'sales14', 'sales30']);
const SMARTZAPAS_WEEKLY_SALES_FIELDS = Object.freeze(['sales7', 'sales14', 'sales28']);
const ASSORTMENT_MATRIX_MODES = Object.freeze(['required', 'optional', 'disabled']);
const SALES_INPUT_MODES = Object.freeze(['auto', 'period_sales', 'reported_daily_rate']);
const IN_TRANSIT_MODES = Object.freeze([
  'required',
  'optional',
  'included_in_source_stock',
  'disabled',
]);
const INCLUDED_IN_SOURCE_STOCK_BASIS =
  'previous_order_registered_as_expected_receipt';
const INCLUDED_IN_SOURCE_STOCK_WARNING =
  'Verify that SmartZapas free stock or analyzer recommendation reflects expected receipts';

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

function resolveSalesInputMode(inputs, config = DEMAND_ENGINE_CONFIG) {
  const mode = inputs.salesInputMode ?? config.salesInputMode;
  if (!SALES_INPUT_MODES.includes(mode)) {
    throw new TypeError(`salesInputMode must be one of: ${SALES_INPUT_MODES.join(', ')}.`);
  }
  return mode;
}

function resolvePurchasingProfile(inputs, config = DEMAND_ENGINE_CONFIG) {
  const requestedProfile = normalize(
    inputs.purchasingProfile || config.defaultPurchasingProfile || 'generic'
  );
  return Object.hasOwn(config.purchasingProfiles, requestedProfile)
    ? requestedProfile
    : 'generic';
}

function resolveInTransitMode(inputs, purchasingProfile, config = DEMAND_ENGINE_CONFIG) {
  const profileMode = config.purchasingProfiles[purchasingProfile]?.inTransitMode;
  const mode = inputs.inTransitMode ?? profileMode ?? config.inTransitMode;
  if (!IN_TRANSIT_MODES.includes(mode)) {
    throw new TypeError(`inTransitMode must be one of: ${IN_TRANSIT_MODES.join(', ')}.`);
  }
  return mode;
}

function getAssortmentMatrixStatus(mode, source) {
  if (mode === 'disabled') return 'disabled';
  if (source) return 'provided';
  return mode === 'required' ? 'required_not_provided' : 'not_provided';
}

function getInTransitState(mode, source, record) {
  if (mode === 'included_in_source_stock') {
    return {
      inTransitQuantity: 0,
      inTransitStatus: 'included_in_source_stock',
    };
  }
  if (mode === 'disabled') {
    return { inTransitQuantity: 0, inTransitStatus: 'disabled' };
  }
  if (!source) {
    return mode === 'optional'
      ? {
        inTransitQuantity: 0,
        inTransitStatus: 'source_not_provided',
      }
      : { inTransitQuantity: null, inTransitStatus: 'source_not_provided' };
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
  if (!sources.sales && inputStatus.salesInputMode !== 'reported_daily_rate') {
    missing.push({
      dataset: 'period_sales_data',
      status: inputStatus.salesInputMode === 'auto'
        ? 'not_provided_fallback_allowed'
        : 'not_provided',
      blocking: inputStatus.salesInputMode === 'period_sales',
      impact: inputStatus.salesInputMode === 'auto'
        ? 'smartzapas_sales_fallback_used_when_available'
        : 'demand_quantity_unavailable',
    });
  }
  if (!sources.inTransit && inputStatus.inTransitMode === 'required') {
    missing.push({
      dataset: 'in_transit_data',
      status: 'not_provided',
      blocking: true,
      impact: 'available_stock_unavailable',
    });
  }
  if (!sources.inTransit && inputStatus.inTransitMode === 'optional') {
    missing.push({
      dataset: 'in_transit_data',
      status: 'not_provided_optional',
      blocking: false,
      impact: 'separate_in_transit_assumed_zero',
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

function calculateWeightedPeriodRate(sales, periodDefinitions, fields) {
  const missingFields = [];
  const invalidFields = [];
  const dailyRates = {};
  let weightedRate = 0;
  let availableWeight = 0;

  for (const field of fields) {
    const value = sales[field];
    const definition = periodDefinitions[field];

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

  const allMissing = missingFields.length === fields.length;
  const allConfirmedZero = fields.every(field => sales[field] === 0);
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

function calculateWeightedSalesRate(sales, config = DEMAND_ENGINE_CONFIG) {
  return calculateWeightedPeriodRate(sales, config.salesWeights, SALES_FIELDS);
}

function calculateSmartZapasWeeklySalesRate(sales, config = DEMAND_ENGINE_CONFIG) {
  return calculateWeightedPeriodRate(
    sales,
    config.smartZapasWeeklySalesWeights,
    SMARTZAPAS_WEEKLY_SALES_FIELDS
  );
}

function selectSalesRate(row, externalSalesMetrics, weeklySalesMetrics, mode) {
  const reportedRate = row.reportedDailySalesRate;
  const reportedRateValid =
    typeof reportedRate === 'number' &&
    Number.isFinite(reportedRate) &&
    reportedRate >= 0;
  const cumulativeRate =
    row.reportedSalesRateSource === 'smartzapas_period_sales_explicit_days';
  const weeklyRateValid = weeklySalesMetrics.salesDailyRate !== null;
  const externalRateValid = externalSalesMetrics.salesDailyRate !== null;

  if (mode === 'auto' && weeklyRateValid) {
    return {
      salesDailyRate: weeklySalesMetrics.salesDailyRate,
      salesRateSource: 'smartzapas_weekly_weighted',
      salesRateConfidence: row.salesPeriodConfidence || 'high',
      selectedMetrics: weeklySalesMetrics,
      selectedPeriodType: 'smartzapas_weekly',
      usedReportedRate: false,
    };
  }
  if (mode !== 'reported_daily_rate' && externalRateValid) {
    return {
      salesDailyRate: externalSalesMetrics.salesDailyRate,
      salesRateSource: 'external_period_sales_weighted',
      salesRateConfidence: externalSalesMetrics.complete ? 'high' : 'medium',
      selectedMetrics: externalSalesMetrics,
      selectedPeriodType: 'external',
      usedReportedRate: false,
    };
  }
  if (mode !== 'period_sales' && reportedRateValid && cumulativeRate) {
    return {
      salesDailyRate: reportedRate,
      salesRateSource: 'smartzapas_cumulative_period',
      salesRateConfidence: row.reportedSalesRateConfidence || 'high',
      selectedMetrics: null,
      selectedPeriodType: 'cumulative',
      usedReportedRate: true,
    };
  }
  if (mode !== 'period_sales' && reportedRateValid) {
    return {
      salesDailyRate: reportedRate,
      salesRateSource: 'smartzapas_reported_daily_rate',
      salesRateConfidence: row.reportedSalesRateConfidence || 'low',
      selectedMetrics: null,
      selectedPeriodType: 'reported_rate',
      usedReportedRate: true,
    };
  }
  return {
    salesDailyRate: null,
    salesRateSource: null,
    salesRateConfidence: null,
    selectedMetrics: null,
    selectedPeriodType: null,
    usedReportedRate: false,
  };
}

function detectSalesTrend(
  metrics,
  config = DEMAND_ENGINE_CONFIG,
  fields = { short: 'sales7', long: 'sales30' }
) {
  const rate7 = metrics.dailyRates[fields.short];
  const rate30 = metrics.dailyRates[fields.long];
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
  const weeklySales = Object.fromEntries(
    SMARTZAPAS_WEEKLY_SALES_FIELDS.map(field => [field, row[field] ?? null])
  );
  const externalSalesMetrics = calculateWeightedSalesRate(sales, config);
  const weeklySalesMetrics = calculateSmartZapasWeeklySalesRate(weeklySales, config);
  const salesSelection = selectSalesRate(
    row,
    externalSalesMetrics,
    weeklySalesMetrics,
    context.salesInputMode
  );
  const trend = salesSelection.salesRateSource === 'external_period_sales_weighted'
    ? detectSalesTrend(externalSalesMetrics, config)
    : salesSelection.salesRateSource === 'smartzapas_weekly_weighted'
      ? detectSalesTrend(
        weeklySalesMetrics,
        config,
        { short: 'sales7', long: 'sales28' }
      )
    : { salesTrend: 'unknown', shortTermSalesSpike: false, decliningSales: false };
  const usesPeriodSales = context.salesInputMode !== 'reported_daily_rate';
  const allowsReportedRate = context.salesInputMode !== 'period_sales';

  if (Array.isArray(row.weeklySalesWarnings) && row.weeklySalesWarnings.length > 0) {
    warnings.push('invalid_weekly_sales_history');
  }

  if (
    salesSelection.salesRateSource === 'external_period_sales_weighted' &&
    sources.sales &&
    usesPeriodSales
  ) {
    for (const field of externalSalesMetrics.missingFields) requiredData.push(field);
  }
  if (usesPeriodSales && sources.sales) {
    for (const field of externalSalesMetrics.invalidFields) {
      requiredData.push(field);
      warnings.push(`invalid_negative_or_non_numeric_${field}`);
    }
  }
  if (
    salesSelection.selectedPeriodType === 'external' &&
    externalSalesMetrics.missingFields.length > 0 &&
    !externalSalesMetrics.allMissing
  ) {
    warnings.push('partial_sales_history');
  }
  if (
    salesSelection.selectedPeriodType === 'smartzapas_weekly' &&
    weeklySalesMetrics.missingFields.length > 0
  ) {
    warnings.push('partial_weekly_sales_history');
  }
  if (
    salesSelection.selectedMetrics &&
    salesSelection.selectedMetrics.allConfirmedZero
  ) {
    warnings.push('zero_sales_weighted_periods');
  }
  if (
    salesSelection.usedReportedRate &&
    salesSelection.salesDailyRate === 0
  ) {
    warnings.push('zero_sales_reported_period');
  }
  if (
    salesSelection.usedReportedRate &&
    salesSelection.salesRateConfidence === 'low'
  ) {
    warnings.push('ambiguous_reported_sales_rate_unit');
    requiredData.push('reported_sales_rate_confirmation');
  }
  if (
    allowsReportedRate &&
    row.reportedDailySalesRate !== null &&
    row.reportedDailySalesRate !== undefined &&
    (
      typeof row.reportedDailySalesRate !== 'number' ||
      !Number.isFinite(row.reportedDailySalesRate) ||
      row.reportedDailySalesRate < 0
    )
  ) {
    warnings.push('invalid_reported_daily_sales_rate');
    requiredData.push('reported_daily_sales_rate');
  }
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
    context.inTransitMode,
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
    salesSelection.salesDailyRate !== null && targetCoverageDays !== null
      ? Math.ceil(salesSelection.salesDailyRate * targetCoverageDays)
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
    stockAfterOrder !== null && salesSelection.salesDailyRate > 0
      ? round(stockAfterOrder / salesSelection.salesDailyRate, 2)
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
    salesDailyRate: salesSelection.salesDailyRate,
    salesRateSource: salesSelection.salesRateSource,
    salesRateConfidence: salesSelection.salesRateConfidence,
    salesStatus: salesSelection.salesDailyRate === null
      ? (
        (
          salesSelection.selectedPeriodType === 'external' &&
          externalSalesMetrics.invalidFields.length > 0
        ) ||
        warnings.includes('invalid_reported_daily_sales_rate')
          ? 'invalid'
          : 'missing'
      )
      : salesSelection.salesDailyRate === 0
        ? 'confirmed_zero'
        : ['smartzapas_cumulative_period', 'smartzapas_reported_daily_rate'].includes(
          salesSelection.salesRateSource
        )
          ? 'reported_rate'
          : salesSelection.selectedMetrics && salesSelection.selectedMetrics.complete
            ? 'complete'
            : 'partial',
    salesTrend: trend.salesTrend,
    sales7: salesSelection.selectedPeriodType === 'smartzapas_weekly'
      ? weeklySales.sales7
      : sales.sales7,
    sales14: salesSelection.selectedPeriodType === 'smartzapas_weekly'
      ? weeklySales.sales14
      : sales.sales14,
    sales28: salesSelection.selectedPeriodType === 'smartzapas_weekly'
      ? weeklySales.sales28
      : null,
    sales30: salesSelection.selectedPeriodType === 'external' ? sales.sales30 : null,
    externalSales7: sales.sales7,
    externalSales14: sales.sales14,
    externalSales30: sales.sales30,
    weeklySalesHistory: Array.isArray(row.weeklySalesHistory)
      ? row.weeklySalesHistory.map(period => ({ ...period }))
      : [],
    weeklyPeriodsUsed: row.weeklyPeriodsUsed || {
      sales7: [],
      sales14: [],
      sales28: [],
    },
    excludedPartialWeek: row.excludedPartialWeek || null,
    salesPeriodSource: row.salesPeriodSource || null,
    salesPeriodConfidence: row.salesPeriodConfidence || null,
    weeklyToCumulativeReconciliation:
      row.weeklyToCumulativeReconciliation || null,
    reportedSalesQuantity: row.reportedSalesQuantity ?? null,
    reportedSalesPeriodDays: row.reportedSalesPeriodDays ?? null,
    reportedDailySalesRate: row.reportedDailySalesRate ?? null,
    reportedSalesRateSource: row.reportedSalesRateSource || null,
    reportedSalesRateConfidence: row.reportedSalesRateConfidence || null,
    originalSmartZapasSalesValue:
      row.sourceTokens && Object.hasOwn(row.sourceTokens, 'reportedSalesQuantity')
        ? row.sourceTokens.reportedSalesQuantity
        : null,
    originalSmartZapasVelocityValue:
      row.sourceTokens && Object.hasOwn(row.sourceTokens, 'reportedSalesVelocity')
        ? row.sourceTokens.reportedSalesVelocity
        : null,
    reportedSalesWarnings: Array.isArray(row.reportedSalesWarnings)
      ? [...row.reportedSalesWarnings]
      : [],
    freeStock,
    stockStatus: resolvedStockStatus,
    inTransitQuantity,
    inTransitStatus,
    inTransitDecisionBasis: context.inTransitDecisionBasis,
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
    productsWithPeriodSales: products.filter(product =>
      ['sales7', 'sales14', 'sales28', 'sales30'].some(field =>
        typeof product[field] === 'number' && Number.isFinite(product[field])
      ) || (
        typeof product.reportedSalesQuantity === 'number' &&
        Number.isFinite(product.reportedSalesQuantity) &&
        typeof product.reportedSalesPeriodDays === 'number' &&
        Number.isFinite(product.reportedSalesPeriodDays) &&
        product.reportedSalesPeriodDays > 0
      )
    ).length,
    productsWithReportedDailyRate: products.filter(product =>
      typeof product.reportedDailySalesRate === 'number' &&
      Number.isFinite(product.reportedDailySalesRate) &&
      product.reportedDailySalesRate >= 0
    ).length,
    productsUsingWeightedSales: products.filter(
      product => [
        'smartzapas_weekly_weighted',
        'external_period_sales_weighted',
      ].includes(product.salesRateSource)
    ).length,
    productsUsingSmartZapasRate: products.filter(
      product => String(product.salesRateSource || '').startsWith('smartzapas_')
    ).length,
    productsMissingUsableSalesInput: products.filter(
      product => product.salesDailyRate === null
    ).length,
    productsWithWeeklyHistory: products.filter(product =>
      product.weeklySalesHistory.some(period =>
        typeof period.quantity === 'number' && Number.isFinite(period.quantity)
      )
    ).length,
    productsWithSales7: products.filter(product =>
      typeof product.sales7 === 'number' && Number.isFinite(product.sales7)
    ).length,
    productsWithSales14: products.filter(product =>
      typeof product.sales14 === 'number' && Number.isFinite(product.sales14)
    ).length,
    productsWithSales28: products.filter(product =>
      typeof product.sales28 === 'number' && Number.isFinite(product.sales28)
    ).length,
    productsUsingWeeklyWeightedRate: products.filter(
      product => product.salesRateSource === 'smartzapas_weekly_weighted'
    ).length,
    productsUsingCumulativeFallback: products.filter(
      product => product.salesRateSource === 'smartzapas_cumulative_period'
    ).length,
    productsWithPartialLatestWeekExcluded: products.filter(
      product => product.excludedPartialWeek !== null
    ).length,
    productsMissingUsableSales: products.filter(
      product => product.salesDailyRate === null
    ).length,
    blankWeeklyCellsInterpretedAsZero: products.reduce(
      (count, product) => count + product.weeklySalesHistory.filter(
        period => period.valueState === 'blank_as_confirmed_zero'
      ).length,
      0
    ),
    weeklyToCumulativeExactMatches: products.filter(
      product => product.weeklyToCumulativeReconciliation?.status === 'exact_match'
    ).length,
    weeklyToCumulativeToleranceMatches: products.filter(
      product => product.weeklyToCumulativeReconciliation?.status === 'tolerance_match'
    ).length,
    weeklyToCumulativeMismatches: products.filter(
      product => product.weeklyToCumulativeReconciliation?.status === 'mismatch'
    ).length,
    excludedPartialWeek:
      products.find(product => product.excludedPartialWeek)?.excludedPartialWeek || null,
    demandQuantitiesCalculated: demandCalculated.length,
    finalQuantitiesCalculated: finalCalculated.length,
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
  const salesInputMode = resolveSalesInputMode(phase2Inputs, config);
  const purchasingProfile = resolvePurchasingProfile(phase2Inputs, config);
  const inTransitMode = resolveInTransitMode(
    phase2Inputs,
    purchasingProfile,
    config
  );
  const acceptsExternalInTransit = ['required', 'optional'].includes(inTransitMode);
  const sources = {
    sales: validateInputSource(phase2Inputs.salesData, 'Sales data'),
    assortment: assortmentMatrixMode === 'disabled'
      ? null
      : validateInputSource(
        phase2Inputs.assortmentMatrix,
        'Assortment matrix'
      ),
    inTransit: acceptsExternalInTransit
      ? validateInputSource(phase2Inputs.inTransitData, 'In-transit data')
      : null,
  };
  const inTransitSourceStatus = inTransitMode === 'included_in_source_stock'
    ? 'included_in_source_stock'
    : inTransitMode === 'disabled'
      ? 'disabled'
      : sources.inTransit
        ? 'provided'
        : inTransitMode === 'optional'
          ? 'not_provided_optional'
          : 'not_provided';
  const inTransitDecisionBasis = inTransitMode === 'included_in_source_stock'
    ? INCLUDED_IN_SOURCE_STOCK_BASIS
    : null;
  const reportWarnings = [];
  if (inTransitMode === 'included_in_source_stock') {
    reportWarnings.push(INCLUDED_IN_SOURCE_STOCK_WARNING);
  }
  if (inTransitMode === 'optional' && !sources.inTransit) {
    reportWarnings.push(
      'Optional in-transit source was not provided; separate in-transit quantity is assumed zero'
    );
  }
  const inputStatus = {
    purchasingProfile,
    salesInputMode,
    inTransitMode,
    inTransitDecisionBasis,
    salesDataStatus: sources.sales ? 'provided' : 'not_provided',
    assortmentMatrixStatus: getAssortmentMatrixStatus(
      assortmentMatrixMode,
      sources.assortment
    ),
    inTransitSourceStatus,
    sourceStockIncludesExpectedReceipts:
      inTransitMode === 'included_in_source_stock' ? 'assumed' : 'not_assumed',
    phase2ResultStatus:
      inTransitMode === 'included_in_source_stock' ? 'preliminary' : 'calculated',
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
    salesInputMode,
    inTransitMode,
    inTransitDecisionBasis,
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
    reportWarnings,
    missingInputDatasets: getMissingInputDatasets(sources, inputStatus),
    diagnostics: {
      salesMatches: matches.sales.recordResults,
      assortmentMatches: matches.assortment.recordResults,
      inTransitMatches: matches.inTransit.recordResults,
      salesRowDiagnostics: matches.sales.rowDiagnostics,
      assortmentRowDiagnostics: matches.assortment.rowDiagnostics,
      inTransitRowDiagnostics: matches.inTransit.rowDiagnostics,
      suppliedInTransitDataIgnored:
        !acceptsExternalInTransit && Boolean(phase2Inputs.inTransitData),
    },
    summary: summarizeDemandPlan(products, sources, matches),
  };
}

module.exports = {
  SALES_FIELDS,
  SMARTZAPAS_WEEKLY_SALES_FIELDS,
  ASSORTMENT_MATRIX_MODES,
  SALES_INPUT_MODES,
  IN_TRANSIT_MODES,
  INCLUDED_IN_SOURCE_STOCK_BASIS,
  INCLUDED_IN_SOURCE_STOCK_WARNING,
  round,
  resolveAssortmentMatrixMode,
  resolveSalesInputMode,
  resolvePurchasingProfile,
  resolveInTransitMode,
  getAssortmentMatrixStatus,
  getInTransitState,
  getMissingInputDatasets,
  calculateWeightedSalesRate,
  calculateWeightedPeriodRate,
  calculateSmartZapasWeeklySalesRate,
  selectSalesRate,
  detectSalesTrend,
  stockStatus,
  demandQuantityReason,
  calculateDemandProduct,
  summarizeDemandPlan,
  buildDemandPlan,
};
