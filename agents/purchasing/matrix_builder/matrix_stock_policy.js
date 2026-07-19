function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function completedWeeklyPeriods(row, config) {
  const history = Array.isArray(row.weeklySalesHistory)
    ? row.weeklySalesHistory
    : [];
  return history
    .filter(period => period && period.completionStatus === 'completed')
    .sort((left, right) => left.periodStart.localeCompare(right.periodStart))
    .slice(-config.stock_policy.history_window_completed_weeks)
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

function calculateStockPolicy(row, config) {
  const periods = completedWeeklyPeriods(row, config);
  const reliablePeriods = periods.filter(period => finiteNonNegative(period.quantity));
  const invalidPeriods = periods.filter(period => period.quantity === null);
  const completedWeeksUsed = reliablePeriods.length;
  const weeksWithSales = reliablePeriods.filter(period => period.quantity > 0).length;
  const averageWeeklySales = calculateAverageWeeklySales(periods);
  const enoughHistory =
    completedWeeksUsed >= config.stock_policy.minimum_completed_weeks;
  const reasonCodes = [];

  if (!enoughHistory) reasonCodes.push('insufficient_sales_history');
  if (enoughHistory && averageWeeklySales === 0) {
    reasonCodes.push('no_completed_week_sales');
  }
  if (weeksWithSales > 0 && weeksWithSales < completedWeeksUsed) {
    reasonCodes.push('irregular_sales');
  }

  if (!enoughHistory || averageWeeklySales === null) {
    return {
      minimumShelfStock: null,
      targetStock: null,
      maximumStock: null,
      safetyStock: null,
      averageWeeklySales,
      completedWeeksUsed,
      weeksWithSales,
      weeklySales: periods,
      invalidCompletedWeeks: invalidPeriods.length,
      calculationStatus: 'insufficient_data',
      reasonCodes,
      provenance: {
        formula: null,
        configVersion: config.version,
        periodStarts: reliablePeriods.map(period => period.periodStart),
      },
    };
  }

  const safetyStock = Math.ceil(
    averageWeeklySales * config.stock_policy.safety_stock_factor
  );
  const minimumShelfStock = averageWeeklySales === 0
    ? 0
    : Math.max(
      1,
      Math.ceil(
        averageWeeklySales * config.stock_policy.minimum_cover_weeks
      )
    );
  const targetStock = Math.max(
    minimumShelfStock,
    Math.ceil(
      averageWeeklySales * config.stock_policy.target_cover_weeks
    ) + safetyStock
  );
  const maximumStock = Math.max(
    targetStock,
    Math.ceil(
      averageWeeklySales * config.stock_policy.maximum_cover_weeks
    ) + safetyStock
  );

  return {
    minimumShelfStock,
    targetStock,
    maximumStock,
    safetyStock,
    averageWeeklySales:
      Math.round((averageWeeklySales + Number.EPSILON) * 10000) / 10000,
    completedWeeksUsed,
    weeksWithSales,
    weeklySales: periods,
    invalidCompletedWeeks: invalidPeriods.length,
    calculationStatus: 'calculated',
    reasonCodes,
    provenance: {
      formula: {
        average_weekly_sales: 'sum(reliable_completed_weeks) / reliable_completed_week_count',
        minimum_shelf_stock: 'average_weekly_sales == 0 ? 0 : max(1, ceil(average_weekly_sales * minimum_cover_weeks))',
        safety_stock: 'ceil(average_weekly_sales * safety_stock_factor)',
        target_stock: 'max(minimum_shelf_stock, ceil(average_weekly_sales * target_cover_weeks) + safety_stock)',
        maximum_stock: 'max(target_stock, ceil(average_weekly_sales * maximum_cover_weeks) + safety_stock)',
      },
      configVersion: config.version,
      periodStarts: reliablePeriods.map(period => period.periodStart),
      sourceFields: reliablePeriods.map(period => ({
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
  calculateStockPolicy,
};
