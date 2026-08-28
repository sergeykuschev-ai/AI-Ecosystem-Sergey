'use strict';

const { UnsupportedOperationError } = require('../../errors/arthur_errors');

const CAPABILITIES = Object.freeze([
  { id: 'getStoreSummary', readOnly: true },
  { id: 'getTodaySummary', readOnly: true },
  { id: 'getMonthSummary', readOnly: true },
  { id: 'getSellers', readOnly: true },
  { id: 'getSeller', readOnly: true },
  { id: 'getSellerPerformance', readOnly: true },
  { id: 'compareSellers', readOnly: true },
  { id: 'getShifts', readOnly: true },
  { id: 'getShift', readOnly: true },
  { id: 'getBonusSummary', readOnly: true },
  { id: 'getDataQuality', readOnly: true },
  { id: 'getManagementSignals', readOnly: true },
  { id: 'getDailyReport', readOnly: true },
  { id: 'getWeeklyReport', readOnly: true },
]);

const DEFAULT_STORE_ID = process.env.BUSINESS_KPI_DEFAULT_STORE_ID || '';
const DEFAULT_TIMEZONE = 'Asia/Vladivostok';
const DEFAULT_CACHE_TTL_MS = Number(process.env.BUSINESS_KPI_CACHE_TTL_MS) || 60000;
const NO_CACHE_OPERATIONS = new Set(['getTodaySummary', 'getDailyReport', 'getWeeklyReport']);

function nullish(value) {
  return value === null || value === undefined;
}

function present(value) {
  return !nullish(value);
}

function formatMoney(value) {
  if (nullish(value)) return null;
  return `${Number(value).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

function formatPercent(value) {
  if (nullish(value)) return null;
  return `${(Number(value) * 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`;
}

function formatNumber(value, fractionDigits = 2) {
  if (nullish(value)) return null;
  return Number(value).toLocaleString('ru-RU', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function coverageLabel(coverage) {
  if (!coverage) return 'н/д';
  const { shiftsWithItems, totalShifts } = coverage;
  if (nullish(shiftsWithItems) || nullish(totalShifts)) return 'н/д';
  return `${shiftsWithItems}/${totalShifts}`;
}

function dataStatusLabel(status) {
  if (status === 'COMPLETE') return 'полные';
  if (status === 'PARTIAL') return 'частичные';
  if (status === 'NO_DATA') return 'нет данных';
  return 'н/д';
}

function monthName(month) {
  const names = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
  ];
  return names[Number(month) - 1] || String(month);
}

function periodLabel({ year, month }) {
  return `${monthName(month)} ${year}`;
}

function todayInTimezone(timezone) {
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date());
  const part = type => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function formatDateRu(dateString) {
  if (!dateString) return 'н/д';
  const [year, month, day] = dateString.split('-');
  if (!year || !month || !day) return dateString;
  return `${Number(day)} ${monthName(Number(month))}`;
}

function isToday(dateString, timezone) {
  return dateString === todayInTimezone(timezone || DEFAULT_TIMEZONE);
}

function provenance(client, operation, parameters, retrievedAt) {
  return {
    source: 'Business KPI',
    endpoint: operation,
    baseUrl: client.baseUrl,
    serviceId: client.serviceId,
    parameters,
    retrievedAt,
  };
}

function buildStoreSummary(client, dashboard, parameters, retrievedAt) {
  const month = dashboard.month || {};
  const coverage = month.itemsCheckCoverage || {};
  return {
    period: periodLabel(parameters),
    revenue: month.revenue ?? null,
    revenueFormatted: formatMoney(month.revenue),
    plan: month.plan ?? null,
    planFormatted: formatMoney(month.plan),
    planPercent: month.planCompletion ?? null,
    planPercentFormatted: formatPercent(month.planCompletion),
    forecast: month.forecast?.projectedRevenue ?? null,
    forecastFormatted: formatMoney(month.forecast?.projectedRevenue),
    remainingToPlan: month.forecast?.remainingToPlan ?? null,
    receipts: month.receipts ?? null,
    averageCheck: month.averageCheck ?? null,
    averageCheckFormatted: formatMoney(month.averageCheck),
    itemsSold: month.itemsSold ?? null,
    itemsPerCheck: month.itemsPerReceipt ?? null,
    itemsPerCheckFormatted: formatNumber(month.itemsPerReceipt, 2),
    qr: month.qr ?? null,
    qrShare: month.qrShare ?? null,
    qrShareFormatted: formatPercent(month.qrShare),
    shifts: month.shiftsCount ?? null,
    dataStatus: month.dataStatus ?? null,
    dataStatusLabel: dataStatusLabel(month.dataStatus),
    itemsCheckCoverage: coverageLabel(coverage),
    settingsVersion: dashboard.settingsVersion ?? null,
    settingsStatus: dashboard.settingsStatus ?? null,
    provenance: provenance(client, 'getStoreSummary', parameters, retrievedAt),
  };
}

function buildTodaySummary(client, today, parameters, retrievedAt) {
  const aggregate = today.aggregate || {};
  return {
    date: today.date,
    revenue: aggregate.revenue ?? null,
    revenueFormatted: formatMoney(aggregate.revenue),
    receipts: aggregate.receipts ?? null,
    averageCheck: aggregate.averageCheck ?? null,
    averageCheckFormatted: formatMoney(aggregate.averageCheck),
    itemsSold: aggregate.itemsSold ?? null,
    itemsPerCheck: aggregate.itemsPerReceipt ?? null,
    itemsPerCheckFormatted: formatNumber(aggregate.itemsPerReceipt, 2),
    qr: aggregate.qr ?? null,
    qrShare: aggregate.qrShare ?? null,
    qrShareFormatted: formatPercent(aggregate.qrShare),
    shifts: aggregate.shiftsCount ?? null,
    dataStatus: aggregate.dataStatus ?? null,
    dataStatusLabel: dataStatusLabel(aggregate.dataStatus),
    provenance: provenance(client, 'getTodaySummary', parameters, retrievedAt),
  };
}

function buildMonthSummary(client, months, parameters, retrievedAt) {
  const month = months.find(m => m.month === Number(parameters.month) && m.year === Number(parameters.year)) || null;
  if (!month) {
    return {
      period: periodLabel(parameters),
      found: false,
      provenance: provenance(client, 'getMonthSummary', parameters, retrievedAt),
    };
  }
  return {
    period: periodLabel(parameters),
    found: true,
    revenue: month.revenue ?? null,
    revenueFormatted: formatMoney(month.revenue),
    plan: month.plan ?? null,
    planFormatted: formatMoney(month.plan),
    planPercent: month.planCompletion ?? null,
    planPercentFormatted: formatPercent(month.planCompletion),
    forecast: month.forecast?.projectedRevenue ?? null,
    forecastFormatted: formatMoney(month.forecast?.projectedRevenue),
    receipts: month.receipts ?? null,
    averageCheck: month.averageCheck ?? null,
    averageCheckFormatted: formatMoney(month.averageCheck),
    itemsSold: month.itemsSold ?? null,
    itemsPerCheck: month.itemsPerReceipt ?? null,
    itemsPerCheckFormatted: formatNumber(month.itemsPerReceipt, 2),
    qr: month.qr ?? null,
    qrShare: month.qrShare ?? null,
    qrShareFormatted: formatPercent(month.qrShare),
    shifts: month.shiftsCount ?? null,
    dataStatus: month.dataStatus ?? null,
    dataStatusLabel: dataStatusLabel(month.dataStatus),
    changeFromPreviousMonth: month.changeFromPreviousMonth ?? null,
    changeFromPreviousMonthFormatted: formatMoney(month.changeFromPreviousMonth),
    provenance: provenance(client, 'getMonthSummary', parameters, retrievedAt),
  };
}

function buildSellerSummary(seller) {
  return {
    employeeId: seller.employeeId,
    name: seller.employeeName,
    shifts: seller.shiftsCount ?? null,
    revenue: seller.revenue ?? null,
    revenueFormatted: formatMoney(seller.revenue),
    revenuePerShift: seller.revenuePerShift ?? null,
    revenuePerShiftFormatted: formatMoney(seller.revenuePerShift),
    receipts: seller.receipts ?? null,
    receiptsPerShift: seller.receipts
      ? Number(seller.receipts) / Number(seller.shiftsCount || 1)
      : null,
    averageCheck: seller.averageCheck ?? null,
    averageCheckFormatted: formatMoney(seller.averageCheck),
    itemsPerCheck: seller.itemsPerReceipt ?? null,
    itemsPerCheckFormatted: formatNumber(seller.itemsPerReceipt, 2),
    qrShare: seller.qrShare ?? null,
    qrShareFormatted: formatPercent(seller.qrShare),
    kpi: seller.averageKpi ?? null,
    kpiFormatted: formatNumber(seller.averageKpi, 2),
    level: seller.kpiLevel ?? null,
    bonus: seller.bonus ?? null,
    bonusFormatted: formatMoney(seller.bonus),
    bonusStatus: seller.bonusStatus ?? null,
    missingFields: seller.missingFields || [],
    dataCompleteness: (seller.missingFields || []).length === 0 ? 'complete' : 'partial',
  };
}

function buildSellersSummary(client, dashboard, parameters, retrievedAt) {
  const sellers = (dashboard.sellers || []).map(buildSellerSummary);
  const incomplete = sellers.filter(s => s.dataCompleteness !== 'complete');
  return {
    period: periodLabel(parameters),
    count: sellers.length,
    sellers,
    incompleteSellers: incomplete.map(s => ({ name: s.name, missingFields: s.missingFields })),
    provenance: provenance(client, 'getSellers', parameters, retrievedAt),
  };
}

function buildSellerDetail(client, sellersData, nameQuery, parameters, retrievedAt) {
  const match = (sellersData.items || [])
    .map(buildSellerSummary)
    .find(s => s.name && s.name.toLocaleLowerCase('ru-RU').includes(nameQuery.toLocaleLowerCase('ru-RU')));
  if (!match) {
    return {
      found: false,
      nameQuery,
      availableNames: (sellersData.items || []).map(s => s.employeeName),
      provenance: provenance(client, 'getSeller', parameters, retrievedAt),
    };
  }
  return {
    found: true,
    seller: match,
    provenance: provenance(client, 'getSeller', parameters, retrievedAt),
  };
}

function buildSellerPerformanceSummary(client, performance, parameters, retrievedAt) {
  const items = (performance.items || []).map(item => ({
    employeeId: item.employeeId,
    name: item.employeeName,
    currentKpi: item.currentKpi ?? null,
    currentKpiFormatted: formatNumber(item.currentKpi, 2),
    previousKpi: item.previousKpi ?? null,
    kpiDelta: item.kpiDelta ?? null,
    trendDirection: item.trendDirection,
    trendConfidence: item.trendConfidence,
    trendLabel: item.trendLabel,
    revenuePerShift: item.revenuePerShift ?? null,
    revenuePerShiftFormatted: formatMoney(item.revenuePerShift),
    averageCheck: item.averageCheck ?? null,
    averageCheckFormatted: formatMoney(item.averageCheck),
    itemsPerCheck: item.itemsPerReceipt ?? null,
    itemsPerCheckFormatted: formatNumber(item.itemsPerReceipt, 2),
    qrShare: item.sellerQrShare ?? null,
    qrShareFormatted: formatPercent(item.sellerQrShare),
    shiftCount: item.shiftCount ?? null,
    strongestMetric: item.strongestMetric,
    attentionMetric: item.attentionMetric,
    dataCompleteness: item.dataCompleteness,
  }));

  const signals = performance.teamSignals || {};
  return {
    period: periodLabel(parameters),
    mode: performance.mode,
    count: items.length,
    sellers: items,
    teamSignals: {
      bestKpi: signals.bestKpi || null,
      bestTrend: signals.bestTrend || null,
      bestPreliminaryTrend: signals.bestPreliminaryTrend || null,
      attention: signals.attention || null,
      teamAverageKpi: signals.teamAverageKpi ?? null,
      teamAverageKpiFormatted: formatNumber(signals.teamAverageKpi, 2),
      insufficientData: signals.insufficientData || false,
    },
    excludedEmployees: performance.excludedEmployees || [],
    provenance: provenance(client, 'getSellerPerformance', parameters, retrievedAt),
  };
}

function buildCompareSellers(client, performance, names, parameters, retrievedAt) {
  const summary = buildSellerPerformanceSummary(client, performance, parameters, retrievedAt);
  const normalizedNames = names.map(n => n.toLocaleLowerCase('ru-RU'));
  const compared = summary.sellers.filter(s =>
    normalizedNames.some(query => s.name && s.name.toLocaleLowerCase('ru-RU').includes(query))
  );
  return {
    period: summary.period,
    names,
    compared,
    notFound: names.filter(name =>
      !summary.sellers.some(s => s.name && s.name.toLocaleLowerCase('ru-RU').includes(name.toLocaleLowerCase('ru-RU')))
    ),
    provenance: summary.provenance,
  };
}

function buildShiftsSummary(client, shiftsData, parameters, retrievedAt) {
  const items = (shiftsData.items || []).map(shift => ({
    id: shift.id,
    date: shift.shiftDate,
    employeeName: shift.employeeName,
    revenue: shift.metrics?.revenue ?? null,
    revenueFormatted: formatMoney(shift.metrics?.revenue),
    cash: shift.cash ?? null,
    acquiring: shift.acquiring ?? null,
    qr: shift.qr ?? null,
    receipts: shift.receipts ?? null,
    itemsSold: shift.itemsSold ?? null,
    itemsPerCheck: shift.metrics?.itemsPerReceipt ?? null,
    itemsPerCheckFormatted: formatNumber(shift.metrics?.itemsPerReceipt, 2),
    averageCheck: shift.metrics?.averageCheck ?? null,
    averageCheckFormatted: formatMoney(shift.metrics?.averageCheck),
    kpi: shift.metrics?.kpiScore ?? null,
    kpiFormatted: formatNumber(shift.metrics?.kpiScore, 2),
    kpiStatus: shift.metrics?.kpiStatus ?? null,
    missingFields: shift.metrics?.missingFields || [],
    source: shift.source,
  }));
  return {
    count: items.length,
    shifts: items,
    provenance: provenance(client, 'getShifts', parameters, retrievedAt),
  };
}

function buildShiftDetail(client, shift, parameters, retrievedAt) {
  return {
    id: shift.id,
    date: shift.shiftDate,
    employeeName: shift.employeeName,
    cash: shift.cash ?? null,
    acquiring: shift.acquiring ?? null,
    qr: shift.qr ?? null,
    revenue: shift.metrics?.revenue ?? null,
    revenueFormatted: formatMoney(shift.metrics?.revenue),
    receipts: shift.receipts ?? null,
    itemsSold: shift.itemsSold ?? null,
    itemsPerCheck: shift.metrics?.itemsPerReceipt ?? null,
    itemsPerCheckFormatted: formatNumber(shift.metrics?.itemsPerReceipt, 2),
    averageCheck: shift.metrics?.averageCheck ?? null,
    averageCheckFormatted: formatMoney(shift.metrics?.averageCheck),
    kpi: shift.metrics?.kpiScore ?? null,
    kpiFormatted: formatNumber(shift.metrics?.kpiScore, 2),
    kpiLevel: shift.metrics?.kpiLevel ?? null,
    kpiStatus: shift.metrics?.kpiStatus ?? null,
    missingFields: shift.metrics?.missingFields || [],
    source: shift.source,
    auditCount: (shift.audit || []).length,
    provenance: provenance(client, 'getShift', parameters, retrievedAt),
  };
}

function buildBonusSummary(client, bonuses, parameters, retrievedAt) {
  const items = (bonuses.items || []).map(item => ({
    employeeId: item.employeeId,
    name: item.employeeName,
    shifts: item.shiftsCount ?? null,
    shiftNorm: item.shiftNorm ?? null,
    revenuePerShift: item.revenuePerShift ?? null,
    revenuePerShiftFormatted: formatMoney(item.revenuePerShift),
    kpi: item.averageKpi ?? null,
    kpiFormatted: formatNumber(item.averageKpi, 2),
    level: item.kpiLevel ?? null,
    bonus: item.bonus ?? null,
    bonusFormatted: formatMoney(item.bonus),
    bonusStatus: item.bonusStatus ?? null,
    missingFields: item.missingFields || [],
  }));
  return {
    period: periodLabel(parameters),
    planCompletion: bonuses.planCompletion ?? null,
    planCompletionFormatted: formatPercent(bonuses.planCompletion),
    dataStatus: bonuses.dataStatus ?? null,
    dataStatusLabel: dataStatusLabel(bonuses.dataStatus),
    sellers: items,
    provenance: provenance(client, 'getBonusSummary', parameters, retrievedAt),
  };
}

function buildDataQualitySummary(client, dashboard, parameters, retrievedAt) {
  const month = dashboard.month || {};
  const shifts = dashboard.sellers || [];
  const coverage = month.itemsCheckCoverage || {};
  const incompleteSellers = shifts.filter(s => (s.missingFields || []).length > 0);
  return {
    period: periodLabel(parameters),
    dataStatus: month.dataStatus ?? null,
    dataStatusLabel: dataStatusLabel(month.dataStatus),
    shiftsTotal: month.shiftsCount ?? null,
    shiftsWithItems: coverage.shiftsWithItems ?? null,
    itemsCheckCoverage: coverageLabel(coverage),
    incompleteSellers: incompleteSellers.map(s => ({
      name: s.employeeName,
      missingFields: s.missingFields,
    })),
    paymentBreakdownAvailable: month.paymentBreakdownAvailable ?? null,
    settingsStatus: dashboard.settingsStatus ?? null,
    settingsVersion: dashboard.settingsVersion ?? null,
    provenance: provenance(client, 'getDataQuality', parameters, retrievedAt),
  };
}

function buildManagementSignals(client, dashboard, performance, parameters, retrievedAt) {
  const month = dashboard.month || {};
  const signals = performance.teamSignals || {};
  const attention = signals.attention;
  const bestKpi = signals.bestKpi;
  const bestTrend = signals.bestTrend;

  const items = [];
  if (attention) {
    items.push({
      type: 'attention',
      priority: 1,
      employeeName: attention.employeeName,
      metric: attention.metric,
      severity: attention.severity,
      confidence: attention.confidence,
      explanation: attention.explanation,
    });
  }
  if (month.planCompletion !== null && month.planCompletion < 1 && month.forecast?.projectedRevenue !== null) {
    const projected = month.forecast.projectedRevenue;
    const plan = month.plan;
    if (plan !== null && projected !== null && projected < plan) {
      items.push({
        type: 'plan_risk',
        priority: 2,
        plan,
        forecast: projected,
        gap: plan - projected,
        gapFormatted: formatMoney(plan - projected),
        explanation: 'Прогноз по текущей динамике ниже плана месяца.',
      });
    }
  }
  if (bestKpi) {
    items.push({
      type: 'best_kpi',
      priority: 5,
      employeeName: bestKpi.employeeName,
      value: bestKpi.value,
      valueFormatted: formatNumber(bestKpi.value, 2),
      shiftCount: bestKpi.shiftCount,
      explanation: 'Лучший KPI среди продавцов.',
    });
  }
  if (bestTrend) {
    items.push({
      type: 'best_trend',
      priority: 6,
      employeeName: bestTrend.employeeName,
      delta: bestTrend.delta,
      deltaFormatted: formatNumber(bestTrend.delta, 2),
      direction: bestTrend.direction,
      explanation: 'Лучшая динамика KPI по сравнению с предыдущим периодом.',
    });
  }

  return {
    period: periodLabel(parameters),
    signals: items.sort((a, b) => a.priority - b.priority),
    provenance: provenance(client, 'getManagementSignals', parameters, retrievedAt),
  };
}

function formatStoreSummaryResponse(summary) {
  const lines = [
    `🐾 Миска — ${summary.period}`,
    '',
    `Выручка: ${summary.revenueFormatted ?? 'н/д'}`,
    `План: ${summary.planFormatted ?? 'н/д'} (${summary.planPercentFormatted ?? 'н/д'})`,
    `Прогноз: ${summary.forecastFormatted ?? 'н/д'}`,
    `Чеков: ${summary.receipts ?? 'н/д'}`,
    `Средний чек: ${summary.averageCheckFormatted ?? 'н/д'}`,
    `Товаров в чеке: ${summary.itemsPerCheckFormatted ?? 'н/д'}`,
    `QR: ${summary.qrShareFormatted ?? 'н/д'}`,
    `Смен: ${summary.shifts ?? 'н/д'}`,
    `Данные: ${summary.dataStatusLabel ?? 'н/д'}`,
  ];
  return lines.join('\n');
}

class InMemoryCache {
  constructor({ ttlMs = DEFAULT_CACHE_TTL_MS, clock = () => new Date() } = {}) {
    this.ttlMs = ttlMs;
    this.clock = clock;
    this.store = new Map();
  }

  key(operation, parameters) {
    return `${operation}:${JSON.stringify(parameters || {})}`;
  }

  get(operation, parameters) {
    const entry = this.store.get(this.key(operation, parameters));
    if (!entry) return null;
    if (this.clock().getTime() - entry.storedAt > this.ttlMs) {
      this.store.delete(this.key(operation, parameters));
      return null;
    }
    return entry.value;
  }

  set(operation, parameters, value) {
    this.store.set(this.key(operation, parameters), {
      value,
      storedAt: this.clock().getTime(),
    });
  }

  clear() {
    this.store.clear();
  }
}

function normalizeParameters(parameters) {
  const now = new Date();
  const storeId = parameters.storeId || DEFAULT_STORE_ID || null;
  const year = parameters.year != null ? Number(parameters.year) : now.getUTCFullYear();
  const month = parameters.month != null ? Number(parameters.month) : now.getUTCMonth() + 1;
  return { storeId, year, month };
}

function createBusinessKpiSkill({ client, clock = () => new Date(), cacheTtlMs } = {}) {
  if (!client) {
    throw new TypeError('BusinessKpiSkill client is required');
  }
  const cache = new InMemoryCache({ ttlMs: cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, clock });

  async function getStoreSummary(parameters = {}) {
    const normalized = normalizeParameters(parameters);
    const dashboard = await client.getDashboard(normalized);
    const summary = buildStoreSummary(client, dashboard, normalized, clock().toISOString());
    return {
      status: 'success',
      data: summary,
      responseText: formatStoreSummaryResponse(summary),
      metadata: { source: 'business_kpi', operation: 'getStoreSummary' },
    };
  }

  async function getTodaySummary(parameters = {}) {
    const storeId = parameters.storeId || DEFAULT_STORE_ID || null;
    const today = await client.getToday({ storeId });
    const summary = buildTodaySummary(client, today, { storeId }, clock().toISOString());
    const todayDate = today.date || today.today;
    const freshness = isToday(todayDate, parameters.timezone)
      ? null
      : `Сегодняшняя смена ещё не завершена/не внесена. Данные по ${formatDateRu(todayDate)}.`;
    return {
      status: 'success',
      data: summary,
      responseText: [
        `🐾 Миска — сегодня (${summary.date ?? 'н/д'})`,
        '',
        `Выручка: ${summary.revenueFormatted ?? 'н/д'}`,
        `Чеков: ${summary.receipts ?? 'н/д'}`,
        `Средний чек: ${summary.averageCheckFormatted ?? 'н/д'}`,
        `Товаров в чеке: ${summary.itemsPerCheckFormatted ?? 'н/д'}`,
        `QR: ${summary.qrShareFormatted ?? 'н/д'}`,
        `Смен: ${summary.shifts ?? 'н/д'}`,
        `Данные: ${summary.dataStatusLabel ?? 'н/д'}`,
        ...(freshness ? ['', freshness] : []),
      ].join('\n'),
      metadata: { source: 'business_kpi', operation: 'getTodaySummary' },
    };
  }

  async function getMonthSummary(parameters = {}) {
    const normalized = normalizeParameters(parameters);
    const months = await client.getMonths({ storeId: normalized.storeId, year: normalized.year });
    const summary = buildMonthSummary(client, months, normalized, clock().toISOString());
    return {
      status: 'success',
      data: summary,
      responseText: [
        `🐾 Миска — ${summary.period}`,
        '',
        summary.found
          ? `Выручка: ${summary.revenueFormatted ?? 'н/д'} / план ${summary.planFormatted ?? 'н/д'} (${summary.planPercentFormatted ?? 'н/д'})`
          : 'Данные за месяц не найдены.',
        `Средний чек: ${summary.averageCheckFormatted ?? 'н/д'}`,
        `Товаров в чеке: ${summary.itemsPerCheckFormatted ?? 'н/д'}`,
        `QR: ${summary.qrShareFormatted ?? 'н/д'}`,
        `Смен: ${summary.shifts ?? 'н/д'}`,
        `Данные: ${summary.dataStatusLabel ?? 'н/д'}`,
      ].join('\n'),
      metadata: { source: 'business_kpi', operation: 'getMonthSummary' },
    };
  }

  async function getSellers(parameters = {}) {
    const normalized = normalizeParameters(parameters);
    const dashboard = await client.getDashboard(normalized);
    const summary = buildSellersSummary(client, dashboard, normalized, clock().toISOString());
    return {
      status: 'success',
      data: summary,
      responseText: [
        `Продавцы — ${summary.period}`,
        '',
        ...summary.sellers.map(s => (
          `${s.name}: KPI ${s.kpiFormatted ?? 'н/д'}, премия ${s.bonusFormatted ?? 'н/д'}, смен ${s.shifts ?? 'н/д'}`
        )),
        ...(summary.incompleteSellers.length > 0
          ? ['', 'Неполные данные:', ...summary.incompleteSellers.map(s => `${s.name}: ${s.missingFields.join(', ')}`)]
          : []),
      ].join('\n'),
      metadata: { source: 'business_kpi', operation: 'getSellers' },
    };
  }

  async function getSeller(parameters = {}) {
    const normalized = normalizeParameters(parameters);
    const sellersData = await client.getSellers(normalized);
    const detail = buildSellerDetail(client, sellersData, parameters.name, normalized, clock().toISOString());
    if (!detail.found) {
      return {
        status: 'success',
        data: detail,
        responseText: `Не нашёл продавца «${parameters.name}». Доступные: ${detail.availableNames.join(', ') || 'нет'}.`,
        metadata: { source: 'business_kpi', operation: 'getSeller' },
      };
    }
    const s = detail.seller;
    return {
      status: 'success',
      data: detail,
      responseText: [
        `${s.name} — ${periodLabel(normalized)}`,
        '',
        `KPI: ${s.kpiFormatted ?? 'н/д'} (${s.level ?? 'н/д'})`,
        `Премия: ${s.bonusFormatted ?? 'н/д'}`,
        `Смен: ${s.shifts ?? 'н/д'}`,
        `Выручка/смену: ${s.revenuePerShiftFormatted ?? 'н/д'}`,
        `Средний чек: ${s.averageCheckFormatted ?? 'н/д'}`,
        `Товаров в чеке: ${s.itemsPerCheckFormatted ?? 'н/д'}`,
        `QR: ${s.qrShareFormatted ?? 'н/д'}`,
        ...(s.missingFields.length > 0
          ? [`Неполные данные: ${s.missingFields.join(', ')}`]
          : []),
      ].join('\n'),
      metadata: { source: 'business_kpi', operation: 'getSeller' },
    };
  }

  async function getSellerPerformance(parameters = {}) {
    const normalized = normalizeParameters(parameters);
    const performance = await client.getSellerPerformance({
      ...normalized,
      mode: parameters.mode || 'shifts',
    });
    const summary = buildSellerPerformanceSummary(client, performance, normalized, clock().toISOString());
    return {
      status: 'success',
      data: summary,
      responseText: [
        `Управленческий блок — ${summary.period}`,
        '',
        `Среднее KPI команды: ${summary.teamSignals.teamAverageKpiFormatted ?? 'н/д'}`,
        ...(summary.teamSignals.bestKpi
          ? [`Лучший KPI: ${summary.teamSignals.bestKpi.employeeName} — ${formatNumber(summary.teamSignals.bestKpi.value, 2)}`]
          : []),
        ...(summary.teamSignals.bestTrend
          ? [`Лучший тренд: ${summary.teamSignals.bestTrend.employeeName} — ${formatNumber(summary.teamSignals.bestTrend.delta, 2)}`]
          : []),
        ...(summary.teamSignals.attention
          ? [`⚠️ Требует внимания: ${summary.teamSignals.attention.employeeName} — ${summary.teamSignals.attention.metric?.label ?? ''}`]
          : []),
        ...(summary.teamSignals.insufficientData
          ? ['Недостаточно данных для полноценного тренда.']
          : []),
      ].join('\n'),
      metadata: { source: 'business_kpi', operation: 'getSellerPerformance' },
    };
  }

  async function compareSellers(parameters = {}) {
    const normalized = normalizeParameters(parameters);
    const performance = await client.getSellerPerformance({
      ...normalized,
      mode: parameters.mode || 'shifts',
    });
    const names = Array.isArray(parameters.names) ? parameters.names : [parameters.name].filter(Boolean);
    const summary = buildCompareSellers(client, performance, names, normalized, clock().toISOString());
    return {
      status: 'success',
      data: summary,
      responseText: [
        `Сравнение — ${summary.period}`,
        '',
        ...summary.compared.map(s => (
          `${s.name}: KPI ${s.currentKpiFormatted ?? 'н/д'}, средний чек ${s.averageCheckFormatted ?? 'н/д'}, товаров/чек ${s.itemsPerCheckFormatted ?? 'н/д'}`
        )),
        ...(summary.notFound.length > 0
          ? [`Не найдены: ${summary.notFound.join(', ')}`]
          : []),
      ].join('\n'),
      metadata: { source: 'business_kpi', operation: 'compareSellers' },
    };
  }

  async function getShifts(parameters = {}) {
    const normalized = normalizeParameters(parameters);
    const shifts = await client.getShifts({
      storeId: normalized.storeId,
      employeeId: parameters.employeeId,
      year: normalized.year,
      month: normalized.month,
      dateFrom: parameters.dateFrom,
      dateTo: parameters.dateTo,
    });
    const summary = buildShiftsSummary(client, shifts, normalized, clock().toISOString());
    return {
      status: 'success',
      data: summary,
      responseText: [
        `Смены — ${summary.count ?? 0}`,
        '',
        ...summary.shifts.slice(0, 10).map(s => (
          `${s.date} ${s.employeeName}: ${s.revenueFormatted ?? 'н/д'}, ${s.receipts ?? 'н/д'} чеков`
        )),
        ...(summary.shifts.length > 10 ? [`И ещё ${summary.shifts.length - 10}...`] : []),
      ].join('\n'),
      metadata: { source: 'business_kpi', operation: 'getShifts' },
    };
  }

  async function getShift(parameters = {}) {
    const shift = await client.getShift(parameters.shiftId);
    const detail = buildShiftDetail(client, shift, { shiftId: parameters.shiftId }, clock().toISOString());
    return {
      status: 'success',
      data: detail,
      responseText: [
        `Смена ${detail.employeeName} — ${detail.date}`,
        '',
        `Выручка: ${detail.revenueFormatted ?? 'н/д'}`,
        `Наличные: ${formatMoney(detail.cash) ?? 'н/д'}`,
        `Эквайринг: ${formatMoney(detail.acquiring) ?? 'н/д'}`,
        `QR: ${formatMoney(detail.qr) ?? 'н/д'}`,
        `Чеков: ${detail.receipts ?? 'н/д'}`,
        `Товаров: ${detail.itemsSold ?? 'н/д'}`,
        `Товаров/чек: ${detail.itemsPerCheckFormatted ?? 'н/д'}`,
        `KPI: ${detail.kpiFormatted ?? 'н/д'}`,
      ].join('\n'),
      metadata: { source: 'business_kpi', operation: 'getShift' },
    };
  }

  async function getBonusSummary(parameters = {}) {
    const normalized = normalizeParameters(parameters);
    const bonuses = await client.getBonuses(normalized);
    const summary = buildBonusSummary(client, bonuses, normalized, clock().toISOString());
    return {
      status: 'success',
      data: summary,
      responseText: [
        `Премии — ${summary.period}`,
        '',
        `Выполнение плана: ${summary.planCompletionFormatted ?? 'н/д'}`,
        '',
        ...summary.sellers.map(s => (
          `${s.name}: ${s.bonusFormatted ?? 'н/д'} (${s.kpiFormatted ?? 'н/д'} KPI, ${s.shifts ?? 'н/д'} смен)`
        )),
      ].join('\n'),
      metadata: { source: 'business_kpi', operation: 'getBonusSummary' },
    };
  }

  async function getDataQuality(parameters = {}) {
    const normalized = normalizeParameters(parameters);
    const dashboard = await client.getDashboard(normalized);
    const summary = buildDataQualitySummary(client, dashboard, normalized, clock().toISOString());
    return {
      status: 'success',
      data: summary,
      responseText: [
        `Качество данных — ${summary.period}`,
        '',
        `Статус: ${summary.dataStatusLabel ?? 'н/д'}`,
        `Coverage items/check: ${summary.itemsCheckCoverage ?? 'н/д'}`,
        ...(summary.incompleteSellers.length > 0
          ? ['', 'Неполные данные продавцов:', ...summary.incompleteSellers.map(s => `${s.name}: ${s.missingFields.join(', ')}`)]
          : ['', 'Все обязательные поля заполнены.']),
      ].join('\n'),
      metadata: { source: 'business_kpi', operation: 'getDataQuality' },
    };
  }

  async function getManagementSignals(parameters = {}) {
    const normalized = normalizeParameters(parameters);
    const [dashboard, performance] = await Promise.all([
      client.getDashboard(normalized),
      client.getSellerPerformance({ ...normalized, mode: parameters.mode || 'shifts' }),
    ]);
    const summary = buildManagementSignals(client, dashboard, performance, normalized, clock().toISOString());
    if (summary.signals.length === 0) {
      return {
        status: 'success',
        data: summary,
        responseText: `Особых управленческих сигналов за ${summary.period} нет.`,
        metadata: { source: 'business_kpi', operation: 'getManagementSignals' },
      };
    }
    return {
      status: 'success',
      data: summary,
      responseText: [
        `Что требует внимания — ${summary.period}`,
        '',
        ...summary.signals.map((signal, index) => {
          if (signal.type === 'attention') {
            return `${index + 1}. ${signal.employeeName}: ${signal.metric?.label ?? ''} — ${signal.explanation}`;
          }
          if (signal.type === 'plan_risk') {
            return `${index + 1}. Риск плана: недобор ${signal.gapFormatted ?? 'н/д'} к прогнозу.`;
          }
          if (signal.type === 'best_kpi') {
            return `${index + 1}. Лучший KPI: ${signal.employeeName} — ${signal.valueFormatted}`;
          }
          if (signal.type === 'best_trend') {
            return `${index + 1}. Лучший тренд: ${signal.employeeName} — ${signal.deltaFormatted}`;
          }
          return `${index + 1}. ${signal.explanation}`;
        }),
      ].join('\n'),
      metadata: { source: 'business_kpi', operation: 'getManagementSignals' },
    };
  }

  async function getDailyReport(parameters = {}) {
    const normalized = normalizeParameters(parameters);
    const storeId = normalized.storeId;
    const [today, store] = await Promise.all([
      client.getToday({ storeId }),
      client.getDashboard(normalized),
    ]);
    const todaySummary = buildTodaySummary(client, today, { storeId }, clock().toISOString());
    const storeSummary = buildStoreSummary(client, store, normalized, clock().toISOString());
    const todayDate = today.date || today.today;
    const todayFresh = isToday(todayDate, parameters.timezone);
    const freshness = todayFresh
      ? `Данные Business KPI на ${formatDateRu(todayDate)}.`
      : `Сегодняшняя смена ещё не завершена/не внесена. Последние данные по ${formatDateRu(todayDate)}.`;

    const lines = [
      `🐾 МИСКА — ИТОГИ ДНЯ`,
      formatDateRu(todayDate),
      '',
      'Сегодня:',
      `Выручка: ${todaySummary.revenueFormatted ?? 'н/д'}`,
      `Чеков: ${todaySummary.receipts ?? 'н/д'}`,
      `Средний чек: ${todaySummary.averageCheckFormatted ?? 'н/д'}`,
      `Товаров/чек: ${todaySummary.itemsPerCheckFormatted ?? 'н/д'}`,
      `QR: ${todaySummary.qrShareFormatted ?? 'н/д'}`,
      '',
      'Месяц:',
      `Выручка: ${storeSummary.revenueFormatted ?? 'н/д'}`,
      `План: ${storeSummary.planFormatted ?? 'н/д'} (${storeSummary.planPercentFormatted ?? 'н/д'})`,
      `Прогноз: ${storeSummary.forecastFormatted ?? 'н/д'}`,
      `Осталось до плана: ${storeSummary.remainingToPlan != null ? formatMoney(storeSummary.remainingToPlan) : 'н/д'}`,
      '',
      freshness,
    ];

    return {
      status: 'success',
      data: { today: todaySummary, month: storeSummary, freshness },
      responseText: lines.join('\n'),
      metadata: { source: 'business_kpi', operation: 'getDailyReport' },
    };
  }

  async function getWeeklyReport(parameters = {}) {
    const normalized = normalizeParameters(parameters);
    const [dashboard, performance] = await Promise.all([
      client.getDashboard(normalized),
      client.getSellerPerformance({ ...normalized, mode: parameters.mode || 'shifts' }),
    ]);
    const storeSummary = buildStoreSummary(client, dashboard, normalized, clock().toISOString());
    const perf = buildSellerPerformanceSummary(client, performance, normalized, clock().toISOString());
    const signals = perf.teamSignals;

    const lines = [
      `🐾 МИСКА — НЕДЕЛЯ`,
      `Период: ${storeSummary.period}`,
      '',
      `Выручка: ${storeSummary.revenueFormatted ?? 'н/д'}`,
      `Чеков: ${storeSummary.receipts ?? 'н/д'}`,
      `Средний чек: ${storeSummary.averageCheckFormatted ?? 'н/д'}`,
      `Товаров/чек: ${storeSummary.itemsPerCheckFormatted ?? 'н/д'}`,
      `QR: ${storeSummary.qrShareFormatted ?? 'н/д'}`,
      `Выполнение плана: ${storeSummary.planPercentFormatted ?? 'н/д'}`,
      '',
      'Продавцы:',
      ...perf.sellers.map(s => `${s.name}: KPI ${s.currentKpiFormatted ?? 'н/д'}, средний чек ${s.averageCheckFormatted ?? 'н/д'}`),
    ];

    if (signals.bestKpi) {
      lines.push('', `Лучший KPI: ${signals.bestKpi.employeeName} — ${formatNumber(signals.bestKpi.value, 2)}`);
    }
    if (signals.attention) {
      lines.push('', `⚠️ Требует внимания: ${signals.attention.employeeName} — ${signals.attention.metric?.label ?? ''}`);
    }
    if (signals.insufficientData) {
      lines.push('', 'Недостаточно данных для полноценного тренда.');
    }
    lines.push('', `Данные Business KPI на ${storeSummary.provenance.retrievedAt ?? 'н/д'}.`);

    return {
      status: 'success',
      data: { month: storeSummary, performance: perf },
      responseText: lines.join('\n'),
      metadata: { source: 'business_kpi', operation: 'getWeeklyReport' },
    };
  }

  const operations = {
    getStoreSummary,
    getTodaySummary,
    getMonthSummary,
    getSellers,
    getSeller,
    getSellerPerformance,
    compareSellers,
    getShifts,
    getShift,
    getBonusSummary,
    getDataQuality,
    getManagementSignals,
    getDailyReport,
    getWeeklyReport,
  };

  return {
    id: 'business_kpi',
    name: 'Arthur Business KPI',
    version: '1.0.0',
    capabilities: CAPABILITIES,
    readOnly: true,
    async execute(input = {}) {
      const operation = operations[input.operation];
      if (!operation) {
        throw new UnsupportedOperationError('business_kpi', input.operation);
      }
      const parameters = input.parameters || {};
      const useCache = !NO_CACHE_OPERATIONS.has(input.operation);
      if (useCache) {
        const cached = cache.get(input.operation, parameters);
        if (cached) {
          return { ...cached, cached: true, retrievedAt: cached.data?.provenance?.retrievedAt };
        }
      }
      const result = await operation(parameters);
      if (useCache) {
        cache.set(input.operation, parameters, result);
      }
      return result;
    },
    async health() {
      try {
        const health = await client.health();
        return { healthy: health.ok === true, skill: 'business_kpi', version: '1.0.0' };
      } catch (error) {
        return { healthy: false, skill: 'business_kpi', version: '1.0.0', errorCode: error.code || 'UNKNOWN' };
      }
    },
  };
}

module.exports = {
  CAPABILITIES,
  createBusinessKpiSkill,
};
