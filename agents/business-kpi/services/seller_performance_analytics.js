'use strict';

const { calculateKpiMetrics, ratio } = require('./calculate_kpi_metrics');

const TREND_MODES = Object.freeze({
  SHIFTS: 'shifts',
  MONTH: 'month',
  THREE_MONTHS: '3months',
});

const TREND_CONFIDENCE = Object.freeze({
  FULL: 'full',
  PRELIMINARY: 'preliminary',
  INSUFFICIENT: 'insufficient',
});

const DEFAULT_THRESHOLDS = Object.freeze({
  kpiDirection: 1.0,
  kpiAttention: 1.0,
  revenuePerShiftRelative: 0.07,
  averageCheckRelative: 0.05,
  itemsPerReceiptRelative: 0.05,
  qrShareAbsolute: 0.02,
  sufficientShifts: 10,
  preliminaryMinShifts: 5,
  sparklineLength: 5,
});

const DEFAULT_OPTIONS = Object.freeze({
  placeholderEmployeeCodePattern: /^seller-demo-/,
});

const METRIC_LABELS = Object.freeze({
  kpi: 'KPI',
  revenuePerShift: 'Выручка/смену',
  averageCheck: 'Средний чек',
  itemsPerReceipt: 'Товаров в чеке',
  qrShare: 'Доля QR',
});

const CONFIDENCE_MULTIPLIER = Object.freeze({
  [TREND_CONFIDENCE.FULL]: 1.0,
  [TREND_CONFIDENCE.PRELIMINARY]: 0.6,
  [TREND_CONFIDENCE.INSUFFICIENT]: 0.0,
});

const ATTENTION_PRIORITY = Object.freeze({
  kpi: 1,
  averageCheck: 2,
  itemsPerReceipt: 3,
  revenuePerShift: 4,
  qrShare: 5,
});

function resolveShiftMetrics(shift, settings) {
  if (shift.metrics?.kpiStatus) return shift.metrics;
  try {
    return calculateKpiMetrics(shift, settings);
  } catch {
    return null;
  }
}

function validKpiShifts(shifts, settings) {
  return shifts
    .filter(shift => !shift.archivedAt && resolveShiftMetrics(shift, settings)?.kpiStatus === 'COMPLETE')
    .sort((left, right) => left.shiftDate.localeCompare(right.shiftDate) || left.createdAt.localeCompare(right.createdAt));
}

function activeShifts(shifts) {
  return shifts.filter(shift => !shift.archivedAt);
}

function windowMetrics(shifts, settings) {
  const revenue = shifts.reduce((sum, shift) => {
    const metrics = resolveShiftMetrics(shift, settings);
    return sum + (metrics?.revenue || 0);
  }, 0);
  const receipts = shifts.reduce((sum, shift) => sum + (shift.receipts || 0), 0);
  const qr = shifts.reduce((sum, shift) => sum + (shift.qr || 0), 0);
  const itemsSold = shifts.reduce((sum, shift) => sum + (shift.itemsSold === null || shift.itemsSold === undefined ? 0 : shift.itemsSold), 0);
  const kpiScores = shifts
    .map(shift => resolveShiftMetrics(shift, settings)?.kpiScore)
    .filter(value => value !== null && value !== undefined);
  return Object.freeze({
    shiftCount: shifts.length,
    revenue,
    receipts,
    qr,
    itemsSold,
    revenuePerShift: shifts.length ? revenue / shifts.length : null,
    receiptsPerShift: shifts.length ? receipts / shifts.length : null,
    averageCheck: receipts ? revenue / receipts : null,
    itemsPerReceipt: receipts ? itemsSold / receipts : null,
    qrShare: revenue ? qr / revenue : null,
    averageKpi: kpiScores.length ? kpiScores.reduce((sum, value) => sum + value, 0) / kpiScores.length : null,
  });
}

function direction(delta, threshold) {
  if (delta > threshold) return 'up';
  if (delta < -threshold) return 'down';
  return 'stable';
}

function trendDirectionLabel(dir, confidence) {
  if (confidence === TREND_CONFIDENCE.INSUFFICIENT) return 'Недостаточно данных';
  const base = { up: 'Рост', stable: 'Стабильно', down: 'Снижение' }[dir] || dir;
  if (confidence === TREND_CONFIDENCE.PRELIMINARY) return `Предварительно ${base.toLowerCase()}`;
  return base;
}

function monthPrefix(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function previousMonth(year, month) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function shiftWindows(shifts, mode, options) {
  const { year, month, thresholds, settings } = options;
  const complete = validKpiShifts(shifts, settings);

  if (mode === TREND_MODES.SHIFTS) {
    if (complete.length < thresholds.preliminaryMinShifts) {
      return { latest: [], previous: [], status: TREND_CONFIDENCE.INSUFFICIENT };
    }
    if (complete.length < thresholds.sufficientShifts) {
      const latest = complete.slice(-thresholds.sparklineLength);
      const previous = complete.slice(0, Math.max(0, complete.length - thresholds.sparklineLength));
      return { latest, previous, status: TREND_CONFIDENCE.PRELIMINARY };
    }
    return {
      latest: complete.slice(-thresholds.sparklineLength),
      previous: complete.slice(-thresholds.sufficientShifts, -thresholds.sparklineLength),
      status: TREND_CONFIDENCE.FULL,
    };
  }

  if (mode === TREND_MODES.MONTH) {
    const currentPrefix = monthPrefix(year, month);
    const previous = previousMonth(year, month);
    const previousPrefix = monthPrefix(previous.year, previous.month);
    const currentMonthShifts = complete.filter(shift => shift.shiftDate.startsWith(currentPrefix));
    const previousMonthShifts = complete.filter(shift => shift.shiftDate.startsWith(previousPrefix));
    const n = currentMonthShifts.length;
    if (n === 0) return { latest: [], previous: [], status: TREND_CONFIDENCE.INSUFFICIENT };
    if (n < thresholds.preliminaryMinShifts) {
      return { latest: currentMonthShifts, previous: previousMonthShifts.slice(-n), status: TREND_CONFIDENCE.PRELIMINARY };
    }
    return { latest: currentMonthShifts, previous: previousMonthShifts.slice(-n), status: TREND_CONFIDENCE.FULL };
  }

  if (mode === TREND_MODES.THREE_MONTHS) {
    const currentPrefix = monthPrefix(year, month);
    const currentMonthShifts = complete.filter(shift => shift.shiftDate.startsWith(currentPrefix));
    const previousShifts = complete.filter(shift => {
      const shiftMonth = Number(shift.shiftDate.slice(5, 7));
      const shiftYear = Number(shift.shiftDate.slice(0, 4));
      const shifted = shiftYear * 12 + shiftMonth;
      const current = year * 12 + month;
      return shifted >= current - 3 && shifted < current;
    });
    if (currentMonthShifts.length === 0) return { latest: [], previous: [], status: TREND_CONFIDENCE.INSUFFICIENT };
    if (currentMonthShifts.length < thresholds.preliminaryMinShifts) {
      return { latest: currentMonthShifts, previous: previousShifts, status: TREND_CONFIDENCE.PRELIMINARY };
    }
    return { latest: currentMonthShifts, previous: previousShifts, status: TREND_CONFIDENCE.FULL };
  }

  return { latest: [], previous: [], status: TREND_CONFIDENCE.INSUFFICIENT };
}

function currentPeriodMetrics(employeeShifts, year, month, settings) {
  const currentPrefix = monthPrefix(year, month);
  const currentActive = activeShifts(employeeShifts).filter(shift => shift.shiftDate.startsWith(currentPrefix));
  return windowMetrics(currentActive, settings);
}

function strongestMetric(current, targets) {
  const candidates = [];
  if (current.averageCheck !== null && targets?.averageCheck > 0) {
    candidates.push({ key: 'averageCheck', label: METRIC_LABELS.averageCheck, ratio: current.averageCheck / targets.averageCheck });
  }
  if (current.itemsPerReceipt !== null && targets?.itemsPerReceipt > 0) {
    candidates.push({ key: 'itemsPerReceipt', label: METRIC_LABELS.itemsPerReceipt, ratio: current.itemsPerReceipt / targets.itemsPerReceipt });
  }
  if (current.qrShare !== null && targets?.qrShare > 0) {
    candidates.push({ key: 'qrShare', label: METRIC_LABELS.qrShare, ratio: current.qrShare / targets.qrShare });
  }
  if (current.revenuePerShift !== null && targets?.shiftRevenue > 0) {
    candidates.push({ key: 'revenuePerShift', label: METRIC_LABELS.revenuePerShift, ratio: current.revenuePerShift / targets.shiftRevenue });
  }
  if (candidates.length === 0) return null;
  const best = candidates.reduce((max, item) => (item.ratio > max.ratio ? item : max), candidates[0]);
  return { key: best.key, label: best.label, ratio: best.ratio };
}

function buildAttentionCandidates(latest, previous, thresholds, confidence) {
  if (!latest.shiftCount || !previous.shiftCount || latest.averageKpi === null || previous.averageKpi === null) {
    return [];
  }
  const checks = [
    {
      key: 'kpi',
      label: METRIC_LABELS.kpi,
      delta: latest.averageKpi - previous.averageKpi,
      threshold: thresholds.kpiAttention,
      isAbsolute: true,
      priority: ATTENTION_PRIORITY.kpi,
    },
    {
      key: 'averageCheck',
      label: METRIC_LABELS.averageCheck,
      delta: previous.averageCheck ? (latest.averageCheck - previous.averageCheck) / previous.averageCheck : 0,
      threshold: thresholds.averageCheckRelative,
      isAbsolute: false,
      priority: ATTENTION_PRIORITY.averageCheck,
    },
    {
      key: 'itemsPerReceipt',
      label: METRIC_LABELS.itemsPerReceipt,
      delta: previous.itemsPerReceipt ? (latest.itemsPerReceipt - previous.itemsPerReceipt) / previous.itemsPerReceipt : 0,
      threshold: thresholds.itemsPerReceiptRelative,
      isAbsolute: false,
      priority: ATTENTION_PRIORITY.itemsPerReceipt,
    },
    {
      key: 'revenuePerShift',
      label: METRIC_LABELS.revenuePerShift,
      delta: previous.revenuePerShift ? (latest.revenuePerShift - previous.revenuePerShift) / previous.revenuePerShift : 0,
      threshold: thresholds.revenuePerShiftRelative,
      isAbsolute: false,
      priority: ATTENTION_PRIORITY.revenuePerShift,
    },
    {
      key: 'qrShare',
      label: METRIC_LABELS.qrShare,
      delta: (latest.qrShare === null || previous.qrShare === null) ? 0 : latest.qrShare - previous.qrShare,
      threshold: thresholds.qrShareAbsolute,
      isAbsolute: true,
      priority: ATTENTION_PRIORITY.qrShare,
    },
  ];

  const multiplier = CONFIDENCE_MULTIPLIER[confidence] || 0;
  return checks
    .filter(check => check.delta < -check.threshold)
    .map(check => {
      const normalizedSeverity = Math.abs(check.delta) / check.threshold;
      return {
        key: check.key,
        label: check.label,
        delta: check.delta,
        isAbsolute: check.isAbsolute,
        threshold: check.threshold,
        priority: check.priority,
        confidence,
        normalizedSeverity,
        finalSeverity: normalizedSeverity * multiplier,
        explanation: confidence === TREND_CONFIDENCE.PRELIMINARY
          ? 'Предварительный сигнал: недостаточно смен для полноценного 5×5 сравнения.'
          : 'Сигнал подтверждён полноценным сравнением последних 5 и предыдущих 5 завершённых смен.',
      };
    });
}

const CONFIDENCE_RANK = Object.freeze({
  [TREND_CONFIDENCE.FULL]: 3,
  [TREND_CONFIDENCE.PRELIMINARY]: 2,
  [TREND_CONFIDENCE.INSUFFICIENT]: 1,
});

function selectHighestSeverityAttention(candidates) {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, candidate) => {
    const bestRank = CONFIDENCE_RANK[best.confidence] || 0;
    const candidateRank = CONFIDENCE_RANK[candidate.confidence] || 0;
    if (candidateRank > bestRank) return candidate;
    if (candidateRank < bestRank) return best;
    if (candidate.finalSeverity > best.finalSeverity) return candidate;
    if (candidate.finalSeverity === best.finalSeverity && candidate.priority < best.priority) return candidate;
    return best;
  }, candidates[0]);
}

function sparkline(completeShifts, thresholds, settings) {
  return completeShifts.slice(-thresholds.sparklineLength).map(shift => ({
    date: shift.shiftDate,
    kpi: resolveShiftMetrics(shift, settings)?.kpiScore ?? null,
  }));
}

function dataCompleteness(activeCurrentShifts, thresholds) {
  if (activeCurrentShifts.length < thresholds.preliminaryMinShifts) return 'insufficient';
  if (activeCurrentShifts.length < thresholds.sufficientShifts) return 'preliminary';
  return 'complete';
}

function isCurrentTeamMember(employee, options) {
  if (employee.active === false) return false;
  if (employee.terminatedOn) return false;
  const pattern = options.placeholderEmployeeCodePattern;
  if (pattern && employee.employeeCode && pattern.test(employee.employeeCode) && !employee.userId) return false;
  return true;
}

function currentTeamAudit(employees, shifts, year, month, options) {
  const included = [];
  const excluded = [];
  const currentPrefix = monthPrefix(year, month);
  const hasShiftsInPeriod = new Set(
    activeShifts(shifts)
      .filter(shift => shift.shiftDate.startsWith(currentPrefix))
      .map(shift => shift.employeeId)
  );

  for (const employee of employees) {
    if (employee.active === false) {
      excluded.push({ employeeId: employee.id, employeeName: employee.displayName, reason: 'inactive' });
      continue;
    }
    if (employee.terminatedOn) {
      excluded.push({ employeeId: employee.id, employeeName: employee.displayName, reason: 'terminated' });
      continue;
    }
    const pattern = options.placeholderEmployeeCodePattern;
    if (pattern && employee.employeeCode && pattern.test(employee.employeeCode) && !employee.userId) {
      excluded.push({ employeeId: employee.id, employeeName: employee.displayName, reason: 'placeholder_no_user' });
      continue;
    }
    included.push(employee);
  }
  return { included, excluded };
}

function windowDetails(shifts, settings) {
  const metrics = windowMetrics(shifts, settings);
  return {
    ...metrics,
    shifts: shifts.map(shift => ({
      date: shift.shiftDate,
      kpi: resolveShiftMetrics(shift, settings)?.kpiScore ?? null,
    })),
  };
}

function buildSellerPerformance(options) {
  const {
    shifts,
    employees,
    settings,
    year,
    month,
    mode = TREND_MODES.SHIFTS,
    thresholds = DEFAULT_THRESHOLDS,
    analyticsOptions = DEFAULT_OPTIONS,
  } = options;

  const targets = settings?.targets || null;
  const { included: currentTeam, excluded } = currentTeamAudit(employees, shifts, year, month, analyticsOptions);

  const grouped = new Map();
  for (const shift of shifts) {
    const list = grouped.get(shift.employeeId) || [];
    list.push(shift);
    grouped.set(shift.employeeId, list);
  }

  const items = [];
  for (const employee of currentTeam) {
    const employeeShifts = grouped.get(employee.id) || [];
    const current = currentPeriodMetrics(employeeShifts, year, month, settings);
    const windows = shiftWindows(employeeShifts, mode, { year, month, thresholds, settings });
    const latestMetrics = windowMetrics(windows.latest, settings);
    const previousMetrics = windowMetrics(windows.previous, settings);
    const kpiDelta = latestMetrics.averageKpi !== null && previousMetrics.averageKpi !== null
      ? latestMetrics.averageKpi - previousMetrics.averageKpi
      : null;
    const trendConfidence = windows.status;
    const trendDirection = kpiDelta === null || trendConfidence === TREND_CONFIDENCE.INSUFFICIENT
      ? 'insufficient'
      : direction(kpiDelta, thresholds.kpiDirection);
    const attentionCandidates = buildAttentionCandidates(latestMetrics, previousMetrics, thresholds, trendConfidence);
    const attention = selectHighestSeverityAttention(attentionCandidates);
    const strongest = strongestMetric(current, targets);
    const completeShifts = validKpiShifts(employeeShifts, settings);
    const currentActiveCurrentPeriod = activeShifts(employeeShifts).filter(s => s.shiftDate.startsWith(monthPrefix(year, month)));

    items.push(Object.freeze({
      employeeId: employee.id,
      employeeName: employee.displayName,
      currentKpi: current.averageKpi,
      previousKpi: previousMetrics.averageKpi,
      kpiDelta,
      trendDirection,
      trendConfidence,
      trendStatus: windows.status,
      trendLabel: trendDirectionLabel(trendDirection, trendConfidence),
      trendExplanation: trendConfidence === TREND_CONFIDENCE.FULL
        ? 'Последние 5 завершённых смены сравнены с предыдущими 5 завершёнными сменами.'
        : (trendConfidence === TREND_CONFIDENCE.PRELIMINARY
          ? 'Истории пока недостаточно для полноценного 5×5 сравнения.'
          : 'Недостаточно завершённых смен для расчёта тренда.'),
      revenuePerShift: current.revenuePerShift,
      receiptsPerShift: current.receiptsPerShift,
      averageCheck: current.averageCheck,
      itemsPerReceipt: current.itemsPerReceipt,
      sellerQrShare: current.qrShare,
      shiftCount: current.shiftCount,
      dataCompleteness: dataCompleteness(currentActiveCurrentPeriod, thresholds),
      strongestMetric: strongest,
      attentionMetric: attention,
      attentionCandidates,
      sparkline: sparkline(completeShifts, thresholds, settings),
      rankingEligible: current.averageKpi !== null && dataCompleteness(currentActiveCurrentPeriod, thresholds) !== TREND_CONFIDENCE.INSUFFICIENT,
      latestWindow: windowDetails(windows.latest, settings),
      previousWindow: windowDetails(windows.previous, settings),
      _windows: Object.freeze({ latest: latestMetrics, previous: previousMetrics }),
    }));
  }

  const eligible = items.filter(item => item.rankingEligible && item.currentKpi !== null);
  const bestKpi = eligible.length
    ? eligible.reduce((best, item) => (item.currentKpi > best.currentKpi ? item : best), eligible[0])
    : null;
  const eligibleFullTrend = items.filter(item =>
    item.trendConfidence === TREND_CONFIDENCE.FULL &&
    item.trendDirection !== 'insufficient' &&
    item.kpiDelta !== null
  );
  const bestTrend = eligibleFullTrend.length
    ? eligibleFullTrend.reduce((best, item) => (item.kpiDelta > best.kpiDelta ? item : best), eligibleFullTrend[0])
    : null;
  const eligiblePreliminaryTrend = items.filter(item =>
    item.trendConfidence === TREND_CONFIDENCE.PRELIMINARY &&
    item.trendDirection !== 'insufficient' &&
    item.kpiDelta !== null
  );
  const bestPreliminaryTrend = eligiblePreliminaryTrend.length
    ? eligiblePreliminaryTrend.reduce((best, item) => (item.kpiDelta > best.kpiDelta ? item : best), eligiblePreliminaryTrend[0])
    : null;
  const attentionCandidates = items.flatMap(item =>
    (item.attentionMetric ? [{ ...item.attentionMetric, employeeId: item.employeeId, employeeName: item.employeeName }] : [])
  );
  const attention = selectHighestSeverityAttention(attentionCandidates);
  const teamAverageKpi = eligible.length
    ? eligible.reduce((sum, item) => sum + item.currentKpi, 0) / eligible.length
    : null;

  return Object.freeze({
    year,
    month,
    mode,
    items: Object.freeze(items.sort((left, right) => (right.currentKpi ?? -Infinity) - (left.currentKpi ?? -Infinity))),
    teamSignals: Object.freeze({
      bestKpi: bestKpi ? { employeeId: bestKpi.employeeId, employeeName: bestKpi.employeeName, value: bestKpi.currentKpi, shiftCount: bestKpi.shiftCount } : null,
      bestTrend: bestTrend ? { employeeId: bestTrend.employeeId, employeeName: bestTrend.employeeName, delta: bestTrend.kpiDelta, direction: bestTrend.trendDirection } : null,
      bestPreliminaryTrend: bestPreliminaryTrend ? {
        employeeId: bestPreliminaryTrend.employeeId,
        employeeName: bestPreliminaryTrend.employeeName,
        delta: bestPreliminaryTrend.kpiDelta,
        direction: bestPreliminaryTrend.trendDirection,
      } : null,
      attention: attention ? {
        employeeId: attention.employeeId,
        employeeName: attention.employeeName,
        metric: {
          key: attention.key,
          label: attention.label,
          delta: attention.delta,
          isAbsolute: attention.isAbsolute,
        },
        confidence: attention.confidence,
        severity: attention.finalSeverity,
        explanation: attention.explanation,
      } : null,
      teamAverageKpi,
      teamAverageKpiExplanation: 'Среднее KPI текущих продавцов, включённых в управленческий блок.',
      insufficientData: items.some(item => item.dataCompleteness === TREND_CONFIDENCE.INSUFFICIENT),
    }),
    excludedEmployees: Object.freeze(excluded),
    analyticsOptions: Object.freeze({
      placeholderEmployeeCodePattern: analyticsOptions.placeholderEmployeeCodePattern
        ? analyticsOptions.placeholderEmployeeCodePattern.source
        : null,
    }),
  });
}

module.exports = {
  buildSellerPerformance,
  DEFAULT_THRESHOLDS,
  METRIC_LABELS,
  TREND_MODES,
  TREND_CONFIDENCE,
  DEFAULT_OPTIONS,
};
