function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function rounded(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function completedWeeklyPeriods(row) {
  const history = Array.isArray(row.weeklySalesHistory)
    ? row.weeklySalesHistory
    : [];
  return history
    .filter(period => period && period.completionStatus === 'completed')
    .sort((left, right) => left.periodStart.localeCompare(right.periodStart))
    .map(period => ({
      periodStart: period.periodStart,
      periodEnd: period.periodEnd || null,
      quantity: finiteNonNegative(period.quantity) ? period.quantity : null,
      valueState: period.valueState || null,
      sourceColumn: period.sourceColumn || null,
      sourceHeader: period.sourceHeader || null,
      rawValue: Object.hasOwn(period, 'rawValue') ? period.rawValue : null,
    }));
}

function calculateAverageWeeklySales(periods) {
  const reliable = periods.filter(period => finiteNonNegative(period.quantity));
  if (reliable.length === 0) return null;
  return reliable.reduce((sum, period) => sum + period.quantity, 0) /
    reliable.length;
}

function calculateStandardDeviation(periods) {
  const reliable = periods.filter(period => finiteNonNegative(period.quantity));
  if (reliable.length < 2) return null;
  const average = calculateAverageWeeklySales(reliable);
  const variance = reliable.reduce(
    (sum, period) => sum + ((period.quantity - average) ** 2),
    0
  ) / reliable.length;
  return Math.sqrt(variance);
}

function windowSummary(periods, weeks) {
  const window = periods.slice(-weeks);
  const reliable = window.filter(period => finiteNonNegative(period.quantity));
  return {
    periods: window,
    reliable,
    average: calculateAverageWeeklySales(window),
    reliableCount: reliable.length,
    activeWeeks: reliable.filter(period => period.quantity > 0).length,
    invalidCount: window.length - reliable.length,
  };
}

function emptyPolicy({
  periods,
  shortSummary,
  baseSummary,
  preferredSummary,
  longTermAverage,
  categoryProfile,
  config,
  reasonCodes,
}) {
  return {
    minimumShelfStock: null,
    targetStock: null,
    maximumStock: null,
    safetyStock: null,
    averageWeeklySales: null,
    shortAverage: rounded(shortSummary.average),
    baseAverage: rounded(baseSummary.average),
    preferredAverage: rounded(preferredSummary.average),
    longTermAverage: rounded(longTermAverage),
    effectiveAverage: null,
    growthCapApplied: false,
    shortLongRatio: longTermAverage > 0 && shortSummary.average !== null
      ? rounded(shortSummary.average / longTermAverage)
      : null,
    completedWeeksUsed: 0,
    totalCompletedWeeksAvailable: periods.length,
    weeksWithSales: 0,
    activeWeekRatio: null,
    weeklySales: preferredSummary.periods,
    invalidCompletedWeeks: preferredSummary.invalidCount,
    weeklySalesStandardDeviation: null,
    leadTimeWeeks: categoryProfile.lead_time_weeks,
    safetyStockFormula: null,
    safetyStockDataQuality: 'insufficient',
    policyFormula: null,
    calculationStatus: 'insufficient_data',
    reasonCodes,
    categoryProfile: categoryProfile.id,
    provenance: {
      formula: null,
      configVersion: config.version,
      periodStarts: [],
      categoryProfile: categoryProfile.id,
    },
  };
}

function calculateStockPolicy(row, config, categoryProfile) {
  const resolvedCategoryProfile = categoryProfile ||
    config.category_profiles.find(profile => profile.default);
  const periods = completedWeeklyPeriods(row);
  const shortSummary = windowSummary(
    periods,
    config.stock_policy.short_window_weeks
  );
  const baseSummary = windowSummary(periods, config.stock_policy.base_weeks);
  const preferredSummary = windowSummary(
    periods,
    config.stock_policy.preferred_weeks
  );
  const longTermAverage = calculateAverageWeeklySales(periods);
  const enoughBaseHistory =
    baseSummary.reliableCount >= config.stock_policy.minimum_policy_data_weeks;
  const reasonCodes = [];

  if (!enoughBaseHistory) reasonCodes.push('insufficient_sales_history');
  if (!enoughBaseHistory || longTermAverage === null) {
    return emptyPolicy({
      periods,
      shortSummary,
      baseSummary,
      preferredSummary,
      longTermAverage,
      categoryProfile: resolvedCategoryProfile,
      config,
      reasonCodes,
    });
  }

  const preferredComplete =
    preferredSummary.reliableCount >= config.stock_policy.preferred_weeks;
  const selectedSummary = preferredComplete ? preferredSummary : baseSummary;
  const shortAverage = shortSummary.average === null
    ? selectedSummary.average
    : shortSummary.average;
  const growthLimit = longTermAverage > 0
    ? longTermAverage * config.stock_policy.long_term_growth_cap
    : null;
  const growthCapApplied = growthLimit !== null && shortAverage > growthLimit;
  const cappedShortAverage = growthCapApplied ? growthLimit : shortAverage;
  const effectiveAverage = growthCapApplied
    ? cappedShortAverage
    : Math.max(selectedSummary.average, cappedShortAverage);
  const activeWeekRatio = selectedSummary.reliableCount > 0
    ? selectedSummary.activeWeeks / selectedSummary.reliableCount
    : null;
  const standardDeviation = calculateStandardDeviation(selectedSummary.periods);
  const safetyStock = standardDeviation === null
    ? null
    : Math.ceil(
      standardDeviation * Math.sqrt(resolvedCategoryProfile.lead_time_weeks)
    );

  if (effectiveAverage === 0) reasonCodes.push('no_completed_week_sales');
  if (
    selectedSummary.activeWeeks > 0 &&
    selectedSummary.activeWeeks < selectedSummary.reliableCount
  ) reasonCodes.push('irregular_sales');
  if (growthCapApplied) {
    reasonCodes.push('short_long_trend_conflict', 'growth_cap_applied');
  }

  const minimumShelfStock = effectiveAverage === 0
    ? 0
    : Math.max(
      resolvedCategoryProfile.minimum_shelf_units,
      Math.ceil(effectiveAverage * resolvedCategoryProfile.minimum_cover_weeks)
    );
  const resolvedSafetyStock = effectiveAverage === 0 ? 0 : safetyStock;
  if (resolvedSafetyStock === null) {
    reasonCodes.push('insufficient_sales_history');
    return emptyPolicy({
      periods,
      shortSummary,
      baseSummary,
      preferredSummary,
      longTermAverage,
      categoryProfile: resolvedCategoryProfile,
      config,
      reasonCodes: Array.from(new Set(reasonCodes)),
    });
  }
  const targetStock = Math.max(
    minimumShelfStock,
    Math.ceil(effectiveAverage * config.stock_policy.target_cover_weeks) +
      resolvedSafetyStock
  );
  const maximumStock = Math.max(
    targetStock,
    Math.ceil(effectiveAverage * config.stock_policy.maximum_cover_weeks) +
      resolvedSafetyStock
  );
  const policyFormula = {
    effective_average: 'growth_cap_applied ? min(short_average, long_term_average * long_term_growth_cap) : max(base_or_preferred_average, short_average)',
    minimum_shelf_stock: 'effective_average == 0 ? 0 : max(profile.minimum_shelf_units, ceil(effective_average * profile.minimum_cover_weeks))',
    safety_stock: 'ceil(weekly_sales_standard_deviation * sqrt(lead_time_weeks))',
    target_stock: 'max(minimum_shelf_stock, ceil(effective_average * target_cover_weeks) + safety_stock)',
    maximum_stock: 'max(target_stock, ceil(effective_average * maximum_cover_weeks) + safety_stock)',
  };

  return {
    minimumShelfStock,
    targetStock,
    maximumStock,
    safetyStock: resolvedSafetyStock,
    averageWeeklySales: rounded(effectiveAverage),
    shortAverage: rounded(shortSummary.average),
    baseAverage: rounded(baseSummary.average),
    preferredAverage: rounded(preferredSummary.average),
    longTermAverage: rounded(longTermAverage),
    effectiveAverage: rounded(effectiveAverage),
    growthCapApplied,
    shortLongRatio: longTermAverage > 0 && shortAverage !== null
      ? rounded(shortAverage / longTermAverage)
      : null,
    completedWeeksUsed: selectedSummary.reliableCount,
    totalCompletedWeeksAvailable: periods.length,
    weeksWithSales: selectedSummary.activeWeeks,
    activeWeekRatio: rounded(activeWeekRatio),
    weeklySales: selectedSummary.periods,
    invalidCompletedWeeks: selectedSummary.invalidCount,
    weeklySalesStandardDeviation: rounded(standardDeviation),
    leadTimeWeeks: resolvedCategoryProfile.lead_time_weeks,
    safetyStockFormula: policyFormula.safety_stock,
    safetyStockDataQuality: preferredComplete ? 'preferred_history' : 'base_history',
    policyFormula,
    calculationStatus: 'calculated',
    reasonCodes: Array.from(new Set(reasonCodes)),
    categoryProfile: resolvedCategoryProfile.id,
    provenance: {
      formula: policyFormula,
      configVersion: config.version,
      periodStarts: selectedSummary.reliable.map(period => period.periodStart),
      categoryProfile: resolvedCategoryProfile.id,
      sourceFields: selectedSummary.reliable.map(period => ({
        periodStart: period.periodStart,
        sourceColumn: period.sourceColumn,
        sourceHeader: period.sourceHeader,
        valueState: period.valueState,
      })),
    },
  };
}

module.exports = {
  finiteNonNegative,
  completedWeeklyPeriods,
  calculateAverageWeeklySales,
  calculateStandardDeviation,
  windowSummary,
  calculateStockPolicy,
};
