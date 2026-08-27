'use strict';

const {
  calculateKpiMetrics,
  fromMinorUnits,
  ratio,
  resolveKpiLevel,
  resolveQrCoefficient,
  toMinorUnits,
} = require('./calculate_kpi_metrics');

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function remainingCalendarDays(year, month, asOfDate) {
  const selected = year * 12 + month;
  const current = asOfDate.getUTCFullYear() * 12 + asOfDate.getUTCMonth() + 1;
  if (selected < current) return 0;
  if (selected > current) return daysInMonth(year, month);
  return daysInMonth(year, month) - asOfDate.getUTCDate();
}

function sumMoney(items, valueOf, fieldName) {
  return fromMinorUnits(items.reduce(
    (sum, item) => sum + toMinorUnits(valueOf(item), fieldName),
    0
  ));
}

function sumNullableMoney(items, valueOf, fieldName) {
  return items.every(item => valueOf(item) !== null && valueOf(item) !== undefined)
    ? sumMoney(items, valueOf, fieldName)
    : null;
}

function sumNullableInteger(items, valueOf) {
  return items.every(item => valueOf(item) !== null && valueOf(item) !== undefined)
    ? items.reduce((sum, item) => sum + valueOf(item), 0)
    : null;
}

function aggregateMonth(shifts, options) {
  const {
    year,
    month,
    plan,
    settings,
    closed = false,
    asOf = new Date(),
  } = options;
  const activeShifts = shifts.filter(shift => !shift.archivedAt);
  const calculated = activeShifts.map(shift => ({
    shift,
    metrics: calculateKpiMetrics(shift, settings),
  }));
  const totals = {
    revenue: sumMoney(calculated, item => item.metrics.revenue, 'revenue'),
    cash: sumNullableMoney(activeShifts, shift => shift.cash, 'cash'),
    acquiring: sumNullableMoney(activeShifts, shift => shift.acquiring, 'acquiring'),
    qr: sumNullableMoney(activeShifts, shift => shift.qr, 'qr'),
    treatsRevenue: sumNullableMoney(
      activeShifts,
      shift => shift.treatsRevenue,
      'treatsRevenue'
    ),
    receipts: activeShifts.reduce((sum, shift) => sum + shift.receipts, 0),
    itemsSold: sumNullableInteger(activeShifts, shift => shift.itemsSold),
    upsellReceipts: sumNullableInteger(activeShifts, shift => shift.upsellReceipts),
    treatsReceipts: sumNullableInteger(activeShifts, shift => shift.treatsReceipts),
  };
  const dataDays = new Set(activeShifts.map(shift => shift.shiftDate)).size;
  const shiftsWithItems = activeShifts.filter(
    shift => shift.itemsSold !== null && shift.itemsSold !== undefined
  ).length;
  const itemsCheckCoverage = Object.freeze({
    totalShifts: activeShifts.length,
    shiftsWithItems,
  });
  const averageRevenuePerDataDay = ratio(totals.revenue, dataDays);
  const remainingDays = remainingCalendarDays(year, month, asOf);
  const remainingToPlan = plan === null ? null : plan - totals.revenue;

  return Object.freeze({
    year,
    month,
    status: activeShifts.length === 0
      ? 'NO_DATA'
      : (closed ? 'CLOSED' : 'IN_PROGRESS'),
    plan,
    revenue: totals.revenue,
    planCompletion: plan === null || plan === 0
      ? null
      : totals.revenue / plan,
    receipts: totals.receipts,
    averageCheck: ratio(totals.revenue, totals.receipts),
    itemsSold: totals.itemsSold,
    itemsPerReceipt: totals.itemsSold === null ? null : ratio(totals.itemsSold, totals.receipts),
    itemsCheckCoverage,
    cash: totals.cash,
    acquiring: totals.acquiring,
    qr: totals.qr,
    qrShare: totals.qr === null ? null : ratio(totals.qr, totals.revenue),
    paymentBreakdownAvailable: activeShifts.length > 0 && calculated.every(
      item => item.metrics.paymentBreakdownAvailable
    ),
    payment_breakdown_available: activeShifts.length > 0 && calculated.every(
      item => item.metrics.paymentBreakdownAvailable
    ),
    upsellReceipts: totals.upsellReceipts,
    upsellReceiptShare: totals.upsellReceipts === null ? null : ratio(totals.upsellReceipts, totals.receipts),
    treatsRevenue: totals.treatsRevenue,
    treatsReceipts: totals.treatsReceipts,
    treatsReceiptShare: totals.treatsReceipts === null ? null : ratio(totals.treatsReceipts, totals.receipts),
    shiftsCount: activeShifts.length,
    dataDays,
    forecast: Object.freeze({
      averageRevenuePerDataDay,
      projectedRevenue: averageRevenuePerDataDay === null
        ? null
        : averageRevenuePerDataDay * daysInMonth(year, month),
      remainingToPlan,
      remainingCalendarDays: remainingDays,
      requiredAveragePerRemainingDay:
        remainingToPlan === null || remainingDays === 0
          ? null
          : Math.max(0, remainingToPlan) / remainingDays,
    }),
    calculatedShifts: calculated,
  });
}

function sellerMissingFields(group) {
  const missing = [];
  if (group.shifts.some(item => item.shift.itemsSold === null || item.shift.itemsSold === undefined)) {
    missing.push('itemsSold');
  }
  if (group.shifts.some(item => item.shift.upsellReceipts === null || item.shift.upsellReceipts === undefined)) {
    missing.push('upsellReceipts');
  }
  if (group.shifts.some(item => item.shift.treatsRevenue === null || item.shift.treatsRevenue === undefined)) {
    missing.push('treatsRevenue');
  }
  if (group.shifts.some(item => item.shift.treatsReceipts === null || item.shift.treatsReceipts === undefined)) {
    missing.push('treatsReceipts');
  }
  return missing;
}

function aggregateSellers(monthAggregate, settings) {
  const grouped = new Map();
  for (const item of monthAggregate.calculatedShifts) {
    const key = item.shift.employeeId;
    const current = grouped.get(key) || {
      employeeId: key,
      employeeName: item.shift.employeeName,
      shifts: [],
    };
    current.shifts.push(item);
    grouped.set(key, current);
  }

  return Array.from(grouped.values()).map(group => {
    const revenue = sumMoney(group.shifts, item => item.metrics.revenue, 'revenue');
    const receipts = group.shifts.reduce(
      (sum, item) => sum + item.shift.receipts,
      0
    );
    const itemsSold = sumNullableInteger(group.shifts, item => item.shift.itemsSold);
    const qr = sumNullableMoney(group.shifts, item => item.shift.qr, 'qr');
    const missingFields = sellerMissingFields(group);
    const kpiComplete = Boolean(settings) && group.shifts.every(
      item => item.metrics.kpiScore !== null
    );
    const averageKpi = kpiComplete ? group.shifts.reduce(
      (sum, item) => sum + item.metrics.kpiScore,
      0
    ) / group.shifts.length : null;
    const level = kpiComplete ? resolveKpiLevel(averageKpi, settings) : null;
    const qrCoefficient = kpiComplete
      ? resolveQrCoefficient(monthAggregate.qrShare, settings)
      : null;
    const appliedQrCoefficient = kpiComplete && averageKpi >= 75 &&
      monthAggregate.planCompletion !== null &&
      monthAggregate.planCompletion >= 1
      ? qrCoefficient
      : (qrCoefficient === null ? null : Math.min(1, qrCoefficient));
    const shiftCoefficient = settings ? Math.min(
      1,
      group.shifts.length / settings.targets.sellerShifts
    ) : null;

    return Object.freeze({
      employeeId: group.employeeId,
      employeeName: group.employeeName,
      shiftsCount: group.shifts.length,
      revenue,
      revenuePerShift: revenue / group.shifts.length,
      receipts,
      averageCheck: ratio(revenue, receipts),
      itemsSold,
      itemsPerReceipt: itemsSold === null ? null : ratio(itemsSold, receipts),
      qr,
      qrShare: qr === null ? null : ratio(qr, revenue),
      averageKpi,
      kpiLevel: level?.name || null,
      bonus: kpiComplete
        ? Math.round(level.bonusBase * shiftCoefficient * appliedQrCoefficient)
        : null,
      bonusStatus: kpiComplete ? 'COMPLETE' : 'UNRESOLVED',
      bonusDetails: kpiComplete ? Object.freeze({
        bonusBase: level.bonusBase,
        shiftCoefficient,
        shiftNorm: settings.targets.sellerShifts,
        qrCoefficient: appliedQrCoefficient,
      }) : null,
      missingFields,
    });
  }).sort((left, right) => right.revenuePerShift - left.revenuePerShift);
}

function aggregateDays(monthAggregate) {
  const grouped = new Map();
  for (const item of monthAggregate.calculatedShifts) {
    const current = grouped.get(item.shift.shiftDate) || [];
    current.push(item);
    grouped.set(item.shift.shiftDate, current);
  }
  return Array.from(grouped.entries()).map(([date, items]) => {
    const revenue = sumMoney(items, item => item.metrics.revenue, 'revenue');
    const qr = sumNullableMoney(items, item => item.shift.qr, 'qr');
    const receipts = items.reduce((sum, item) => sum + item.shift.receipts, 0);
    const itemsSold = sumNullableInteger(items, item => item.shift.itemsSold);
    return Object.freeze({
      date,
      revenue,
      receipts,
      averageCheck: ratio(revenue, receipts),
      itemsSold,
      itemsPerReceipt: itemsSold === null ? null : ratio(itemsSold, receipts),
      qr,
      qrShare: qr === null ? null : ratio(qr, revenue),
      shiftsCount: items.length,
    });
  }).sort((left, right) => left.date.localeCompare(right.date));
}

module.exports = {
  aggregateDays,
  aggregateMonth,
  aggregateSellers,
  daysInMonth,
  remainingCalendarDays,
};
