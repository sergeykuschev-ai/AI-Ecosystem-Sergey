'use strict';

const { calculateKpiMetrics } = require('../services/calculate_kpi_metrics');

const EFFECT_WINDOW_SHIFTS = 3;
const MIN_EFFECT_RELATIVE = 0.05;

const SALES_METRIC_BY_CODE = Object.freeze({
  'SALE-01': 'itemsPerReceipt',
  'SALE-02': 'averageCheck',
  'SALE-03': 'revenuePerShift',
  'SALE-04': 'averageCheck',
  'SALE-08': 'itemsPerReceipt',
});

const METRIC_LABELS = Object.freeze({
  itemsPerReceipt: 'Товаров в чеке',
  averageCheck: 'Средний чек',
  revenuePerShift: 'Выручка/смену',
});

const TARGET_KEY_BY_METRIC = Object.freeze({
  itemsPerReceipt: 'itemsPerReceipt',
  averageCheck: 'averageCheck',
  revenuePerShift: 'shiftRevenue',
});

function activeEmployeeShifts(shifts, employeeId) {
  return (shifts || [])
    .filter(shift =>
      shift.employeeId === employeeId &&
      !shift.archivedAt)
    .sort((left, right) =>
      String(left.shiftDate).localeCompare(String(right.shiftDate)) ||
      String(left.createdAt || '').localeCompare(String(right.createdAt || '')));
}

function aggregateWindow(shifts, metricKey, settings) {
  if (!shifts.length) return null;
  let revenue = 0;
  let receipts = 0;
  let items = 0;
  let itemsComplete = true;

  for (const shift of shifts) {
    let metrics;
    try {
      metrics = calculateKpiMetrics(shift, settings);
    } catch {
      return null;
    }
    revenue += metrics.revenue || 0;
    receipts += shift.receipts || 0;
    if (shift.itemsSold === null || shift.itemsSold === undefined) {
      itemsComplete = false;
    } else {
      items += shift.itemsSold;
    }
  }

  if (metricKey === 'revenuePerShift') {
    return shifts.length ? revenue / shifts.length : null;
  }
  if (metricKey === 'averageCheck') {
    return receipts ? revenue / receipts : null;
  }
  if (metricKey === 'itemsPerReceipt') {
    return receipts && itemsComplete ? items / receipts : null;
  }
  return null;
}

function roundMetric(value, metricKey) {
  if (!Number.isFinite(value)) return null;
  if (metricKey === 'itemsPerReceipt') return Math.round(value * 100) / 100;
  return Math.round(value);
}

function evaluateSalesExercise({
  proposal,
  shifts,
  settings,
  targets,
  windowShifts = EFFECT_WINDOW_SHIFTS,
  minEffectRelative = MIN_EFFECT_RELATIVE,
}) {
  const metricKey = SALES_METRIC_BY_CODE[proposal?.libraryCode];
  if (!proposal || proposal.taskType !== 'SALES' || !metricKey) return null;

  const sellerShifts = activeEmployeeShifts(shifts, proposal.employeeId);
  const beforeAll = sellerShifts.filter(shift => shift.shiftDate < proposal.shiftDate);
  const afterAll = sellerShifts.filter(shift => shift.shiftDate > proposal.shiftDate);
  const before = beforeAll.slice(-windowShifts);
  const after = afterAll.slice(0, windowShifts);
  const targetKey = TARGET_KEY_BY_METRIC[metricKey];
  const target = Number.isFinite(targets?.[targetKey]) ? targets[targetKey] : null;

  const base = {
    proposalId: proposal.id,
    libraryCode: proposal.libraryCode,
    title: proposal.title,
    assignmentDate: proposal.shiftDate,
    metricKey,
    metricLabel: METRIC_LABELS[metricKey],
    windowShifts,
    beforeShifts: before.length,
    afterShifts: after.length,
    remainingShifts: Math.max(0, windowShifts - after.length),
    target: roundMetric(target, metricKey),
  };

  if (before.length < windowShifts) {
    return {
      ...base,
      status: 'INSUFFICIENT_BASELINE',
      baseline: null,
      after: null,
      deltaRelative: null,
      deltaPercent: null,
    };
  }

  const baselineRaw = aggregateWindow(before, metricKey, settings);
  if (!Number.isFinite(baselineRaw) || baselineRaw <= 0) {
    return {
      ...base,
      status: 'INSUFFICIENT_BASELINE',
      baseline: roundMetric(baselineRaw, metricKey),
      after: null,
      deltaRelative: null,
      deltaPercent: null,
    };
  }

  if (after.length < windowShifts) {
    return {
      ...base,
      status: 'OBSERVING',
      baseline: roundMetric(baselineRaw, metricKey),
      after: after.length
        ? roundMetric(aggregateWindow(after, metricKey, settings), metricKey)
        : null,
      deltaRelative: null,
      deltaPercent: null,
    };
  }

  const afterRaw = aggregateWindow(after, metricKey, settings);
  if (!Number.isFinite(afterRaw)) {
    return {
      ...base,
      status: 'INSUFFICIENT_AFTER',
      baseline: roundMetric(baselineRaw, metricKey),
      after: null,
      deltaRelative: null,
      deltaPercent: null,
    };
  }

  const deltaRelative = (afterRaw - baselineRaw) / baselineRaw;
  const targetReached = Number.isFinite(target) && afterRaw >= target;
  const effective = targetReached || deltaRelative >= minEffectRelative;
  return {
    ...base,
    status: effective ? 'EFFECTIVE' : 'NO_IMPROVEMENT',
    baseline: roundMetric(baselineRaw, metricKey),
    after: roundMetric(afterRaw, metricKey),
    deltaRelative,
    deltaPercent: Math.round(deltaRelative * 1000) / 10,
    targetReached,
  };
}

function latestMeasurableSalesImpact({ proposals, shifts, settings, targets }) {
  const candidates = (proposals || [])
    .filter(proposal =>
      proposal.taskType === 'SALES' &&
      ['APPROVED', 'COMPLETED'].includes(proposal.status) &&
      SALES_METRIC_BY_CODE[proposal.libraryCode])
    .sort((left, right) =>
      String(right.shiftDate).localeCompare(String(left.shiftDate)) ||
      String(right.resultMarkedAt || right.updatedAt || '').localeCompare(
        String(left.resultMarkedAt || left.updatedAt || '')
      ));

  for (const proposal of candidates) {
    const impact = evaluateSalesExercise({
      proposal,
      shifts,
      settings,
      targets,
    });
    if (impact) return impact;
  }
  return null;
}


function allMeasurableSalesImpacts({ proposals, shifts, settings, targets }) {
  return (proposals || [])
    .filter(proposal =>
      proposal.taskType === 'SALES' &&
      ['APPROVED', 'COMPLETED'].includes(proposal.status) &&
      SALES_METRIC_BY_CODE[proposal.libraryCode])
    .map(proposal => evaluateSalesExercise({
      proposal,
      shifts,
      settings,
      targets,
    }))
    .filter(Boolean)
    .sort((left, right) =>
      String(right.assignmentDate).localeCompare(String(left.assignmentDate)) ||
      String(right.proposalId).localeCompare(String(left.proposalId)));
}

function matureSalesImpacts(options) {
  return allMeasurableSalesImpacts(options)
    .filter(impact => ['EFFECTIVE', 'NO_IMPROVEMENT'].includes(impact.status));
}

function findSalesEscalation(options) {
  const mature = matureSalesImpacts(options);
  const byMetric = new Map();
  for (const impact of mature) {
    if (!byMetric.has(impact.metricKey)) byMetric.set(impact.metricKey, []);
    byMetric.get(impact.metricKey).push(impact);
  }
  for (const [metricKey, impacts] of byMetric.entries()) {
    const recent = impacts.slice(0, 2);
    if (recent.length === 2 &&
        recent.every(impact => impact.status === 'NO_IMPROVEMENT')) {
      return {
        active: true,
        metricKey,
        metricLabel: METRIC_LABELS[metricKey],
        attempts: 2,
        exercises: recent.map(impact => ({
          proposalId: impact.proposalId,
          libraryCode: impact.libraryCode,
          title: impact.title,
          assignmentDate: impact.assignmentDate,
          deltaPercent: impact.deltaPercent,
        })),
        reason:
          'Два разных цикла упражнений не дали достаточного улучшения KPI. Нужен разбор с владельцем.',
      };
    }
  }
  return null;
}

function buildExerciseEffectivenessRanking(options) {
  const mature = matureSalesImpacts(options);
  const stats = new Map();
  for (const impact of mature) {
    const current = stats.get(impact.libraryCode) || {
      libraryCode: impact.libraryCode,
      title: impact.title,
      metricKey: impact.metricKey,
      metricLabel: impact.metricLabel,
      evaluated: 0,
      effective: 0,
      noImprovement: 0,
      deltaTotal: 0,
      deltaCount: 0,
    };
    current.evaluated += 1;
    if (impact.status === 'EFFECTIVE') current.effective += 1;
    if (impact.status === 'NO_IMPROVEMENT') current.noImprovement += 1;
    if (Number.isFinite(impact.deltaPercent)) {
      current.deltaTotal += impact.deltaPercent;
      current.deltaCount += 1;
    }
    stats.set(impact.libraryCode, current);
  }
  return [...stats.values()]
    .map(item => ({
      libraryCode: item.libraryCode,
      title: item.title,
      metricKey: item.metricKey,
      metricLabel: item.metricLabel,
      evaluated: item.evaluated,
      effective: item.effective,
      noImprovement: item.noImprovement,
      effectivenessPercent: item.evaluated
        ? Math.round((item.effective / item.evaluated) * 100)
        : null,
      averageDeltaPercent: item.deltaCount
        ? Math.round((item.deltaTotal / item.deltaCount) * 10) / 10
        : null,
    }))
    .sort((left, right) =>
      right.evaluated - left.evaluated ||
      (right.effectivenessPercent || 0) - (left.effectivenessPercent || 0) ||
      left.libraryCode.localeCompare(right.libraryCode));
}

module.exports = {
  EFFECT_WINDOW_SHIFTS,
  MIN_EFFECT_RELATIVE,
  SALES_METRIC_BY_CODE,
  TARGET_KEY_BY_METRIC,
  evaluateSalesExercise,
  latestMeasurableSalesImpact,
  allMeasurableSalesImpacts,
  matureSalesImpacts,
  findSalesEscalation,
  buildExerciseEffectivenessRanking,
};
