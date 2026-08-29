'use strict';

const crypto = require('node:crypto');

const DEFAULT_TIMEZONE = 'Asia/Vladivostok';
const OWNER_EMPLOYEE_NAME = 'Кущев';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SIGNIFICANT_KPI_DROP_POINTS = 1.0;

function nullish(value) {
  return value === null || value === undefined;
}

function present(value) {
  return !nullish(value);
}

function formatMoney(value, fractionDigits = 0) {
  if (nullish(value)) return null;
  return `${Number(value).toLocaleString('ru-RU', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} ₽`;
}

function formatPercent(value, fractionDigits = 1) {
  if (nullish(value)) return null;
  return `${(Number(value) * 100).toLocaleString('ru-RU', {
    maximumFractionDigits: fractionDigits,
  })}%`;
}

function formatNumber(value, fractionDigits = 2) {
  if (nullish(value)) return null;
  return Number(value).toLocaleString('ru-RU', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatKpi(value) {
  if (nullish(value)) return null;
  return formatNumber(value, 2);
}

function formatKpiDelta(value) {
  if (nullish(value)) return null;
  const num = Number(value).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = value > 0 ? '+' : '';
  return `${sign}${num} п.`;
}

function formatDeltaPercentPoints(value, fractionDigits = 1) {
  if (nullish(value)) return null;
  const num = Number(value).toLocaleString('ru-RU', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
  const sign = value > 0 ? '+' : '';
  return `${sign}${num} п.п.`;
}

function formatPercentAbs(value, fractionDigits = 1) {
  if (nullish(value)) return null;
  return `${(Number(value) * 100).toLocaleString('ru-RU', { maximumFractionDigits: fractionDigits })}%`;
}

function dataStatusLabel(status) {
  if (status === 'COMPLETE') return 'полные';
  if (status === 'PARTIAL') return 'частичные';
  if (status === 'NO_DATA') return 'нет данных';
  return 'н/д';
}

function monthName(month) {
  const names = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  return names[Number(month) - 1] || String(month);
}

function formatDateRu(dateString) {
  if (!dateString) return 'н/д';
  const [year, month, day] = dateString.split('-');
  if (!year || !month || !day) return dateString;
  return `${Number(day)} ${monthName(Number(month))}`;
}

function formatPeriodRange(fromDate, toDate) {
  if (!fromDate || !toDate) return 'н/д';
  const [fromYear, fromMonth, fromDay] = fromDate.split('-');
  const [toYear, toMonth, toDay] = toDate.split('-');
  if (fromYear === toYear && fromMonth === toMonth) {
    return `${Number(fromDay)}–${Number(toDay)} ${monthName(Number(toMonth))} ${fromYear}`;
  }
  if (fromYear === toYear) {
    return `${Number(fromDay)} ${monthName(Number(fromMonth))} – ${Number(toDay)} ${monthName(Number(toMonth))} ${fromYear}`;
  }
  return `${formatDateRu(fromDate)} – ${formatDateRu(toDate)}`;
}

function parseCoverage(coverageLabel) {
  if (!coverageLabel || coverageLabel === 'н/д') return null;
  const [withItems, total] = coverageLabel.split('/').map(Number);
  if (Number.isNaN(withItems) || Number.isNaN(total) || total <= 0) return null;
  return { withItems, total, ratio: withItems / total };
}

function localTimeInMinutes(date, timezone) {
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const part = type => parts.find(p => p.type === type)?.value;
  return Number(part('hour')) * 60 + Number(part('minute'));
}

function isAfterStoreClose(date, timezone, cutoff = '22:00') {
  const [cutHour, cutMin] = cutoff.split(':').map(Number);
  return localTimeInMinutes(date, timezone) >= cutHour * 60 + cutMin;
}

function evaluateDataQualityState(todaySummary, dataQuality, now, timezone) {
  const reasons = [];
  const coverage = parseCoverage(dataQuality.itemsCheckCoverage);
  let state = 'ok';

  if (dataQuality.dataStatus === 'NO_DATA') {
    state = 'warning';
    reasons.push('Данные за месяц отсутствуют.');
  }
  if ((dataQuality.incompleteSellers || []).length > 0) {
    state = 'warning';
  }
  if (coverage && coverage.ratio < 1) {
    state = 'warning';
    reasons.push(`Загружено смен: ${coverage.withItems} из ${coverage.total}.`);
  }
  if (todaySummary.dataStatus === 'NO_DATA' && isAfterStoreClose(now, timezone)) {
    state = 'warning';
    reasons.push('Сегодняшние смены отсутствуют.');
  }
  if (todaySummary.dataStatus === 'PARTIAL' && isAfterStoreClose(now, timezone)) {
    state = 'warning';
    reasons.push('Сегодняшние данные частичные.');
  }

  return { state, reasons, coverageIncomplete: coverage && coverage.ratio < 1 };
}

function getWeeklyPeriodEnd(timezone, now, cutoffTime = '20:30') {
  const today = dateInTimezone(now, timezone);
  const [cutHour, cutMin] = cutoffTime.split(':').map(Number);
  const cutoffMinutes = cutHour * 60 + cutMin;
  if (localTimeInMinutes(now, timezone) >= cutoffMinutes) {
    return today;
  }
  return addDays(today, -1);
}

function dateInTimezone(date, timezone) {
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const part = type => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function todayInTimezone(timezone) {
  return dateInTimezone(new Date(), timezone);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateRangeDays(endDate, days) {
  const startDate = addDays(endDate, -(days - 1));
  return { startDate, endDate };
}

function isWeekend(dateString) {
  const day = new Date(`${dateString}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function isOwnerSeller(seller) {
  return seller && seller.name && seller.name.includes(OWNER_EMPLOYEE_NAME);
}

function excludeOwner(sellers) {
  return (sellers || []).filter(s => !isOwnerSeller(s));
}

function aggregateShifts(shifts) {
  let revenue = null;
  let receipts = null;
  let itemsSold = null;
  let qr = null;
  let shiftsCount = 0;
  let kpiSum = 0;
  let kpiCount = 0;

  for (const shift of shifts) {
    if (present(shift.revenue)) revenue = (revenue ?? 0) + Number(shift.revenue);
    if (present(shift.receipts)) receipts = (receipts ?? 0) + Number(shift.receipts);
    if (present(shift.itemsSold)) itemsSold = (itemsSold ?? 0) + Number(shift.itemsSold);
    if (present(shift.qr)) qr = (qr ?? 0) + Number(shift.qr);
    shiftsCount += 1;
    if (present(shift.kpi)) {
      kpiSum += Number(shift.kpi);
      kpiCount += 1;
    }
  }

  return {
    revenue,
    receipts,
    itemsSold,
    qr,
    shiftsCount,
    averageCheck: receipts > 0 ? revenue / receipts : null,
    itemsPerCheck: itemsSold > 0 && receipts > 0 ? itemsSold / receipts : null,
    qrShare: revenue > 0 ? qr / revenue : null,
    averageKpi: kpiCount > 0 ? kpiSum / kpiCount : null,
  };
}

function aggregateShiftsBySeller(shifts) {
  const map = new Map();
  for (const shift of shifts) {
    const name = shift.employeeName || 'Неизвестно';
    if (!map.has(name)) {
      map.set(name, []);
    }
    map.get(name).push(shift);
  }
  const sellers = [];
  for (const [name, sellerShifts] of map.entries()) {
    const agg = aggregateShifts(sellerShifts);
    sellers.push({ name, ...agg });
  }
  return sellers.sort((a, b) => b.revenue - a.revenue);
}

function deltaPercent(current, previous) {
  if (!present(current) || !present(previous) || previous === 0) return null;
  return (current - previous) / previous;
}

function deltaPercentPoints(current, previous) {
  if (!present(current) || !present(previous)) return null;
  return (current - previous) * 100;
}

function formatDelta(value, formatter) {
  if (!present(value)) return null;
  const formatted = formatter(value);
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatted}`;
}

function formatDeltaPercent(value) {
  if (!present(value)) return null;
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
}

function hasMeaningfulMetrics(seller) {
  return present(seller.revenue) || present(seller.receipts) || present(seller.itemsSold) || present(seller.qr);
}

function daysRemainingInMonth(timezone, now = new Date()) {
  const today = dateInTimezone(now, timezone);
  const [year, month] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0));
  const current = new Date(`${today}T00:00:00.000Z`);
  const diffMs = lastDay.getTime() - current.getTime();
  return Math.max(0, Math.ceil(diffMs / MS_PER_DAY));
}

function requiredPerDay(remaining, daysRemaining) {
  if (!present(remaining) || daysRemaining <= 0) return null;
  return remaining / daysRemaining;
}

async function executeSkill(skill, operation, parameters, timeoutMs = 15000) {
  const result = await skill.execute({ operation, parameters });
  if (result.status !== 'success') {
    const errorMessage = result.errors?.map(e => e.message).join('; ') || `${operation} failed`;
    throw new Error(errorMessage);
  }
  return result.data;
}

async function fetchCurrentMonthContext(skill, storeId, timezone) {
  const now = new Date();
  const today = dateInTimezone(now, timezone);
  const [year, month] = today.split('-').map(Number);
  const [store, performance, settings] = await Promise.all([
    executeSkill(skill, 'getStoreSummary', { storeId, year, month, timezone }),
    executeSkill(skill, 'getSellerPerformance', { storeId, year, month, mode: 'shifts' }),
    executeSkill(skill, 'getSettings', { storeId, date: today }).catch(() => null),
  ]);
  return { store, performance, settings, year, month, today };
}

async function fetchShiftsForRange(skill, storeId, dateFrom, dateTo) {
  const data = await executeSkill(skill, 'getShifts', { storeId, dateFrom, dateTo });
  return data.shifts || [];
}

function buildSellerLines(sellers, options = {}) {
  return sellers.map(s => {
    const parts = [`${s.name}`];
    if (s.averageKpi != null) parts.push(`KPI ${formatKpi(s.averageKpi)}`);
    if (options.includeRevenue && s.revenue != null) parts.push(`${formatMoney(s.revenue)}`);
    if (s.averageCheck != null) parts.push(`ср. чек ${formatMoney(s.averageCheck)}`);
    if (s.itemsPerCheck != null) parts.push(`товаров/чек ${formatNumber(s.itemsPerCheck, 2)}`);
    if (s.qrShare != null) parts.push(`QR ${formatPercent(s.qrShare)}`);
    return `• ${parts.join(', ')}`;
  });
}

function rankSellers(sellers, key) {
  return [...sellers]
    .filter(s => present(s[key]))
    .sort((a, b) => b[key] - a[key]);
}

async function buildDailyReport(skill, { storeId, timezone = DEFAULT_TIMEZONE }) {
  const { store, settings, today } = await fetchCurrentMonthContext(skill, storeId, timezone);
  const todaySummary = await executeSkill(skill, 'getTodaySummary', { storeId, timezone });

  const todayDate = todaySummary.date || today;
  const dataStatus = todaySummary.dataStatus || 'NO_DATA';
  const isNoData = dataStatus === 'NO_DATA';
  const isPartial = dataStatus === 'PARTIAL';
  const isFinal = dataStatus === 'COMPLETE';
  const title = isFinal ? '📊 Миска — итоги дня' : '📊 Миска — предварительные итоги дня';

  const todayShifts = isNoData ? [] : await fetchShiftsForRange(skill, storeId, todayDate, todayDate);
  const todaySellers = aggregateShiftsBySeller(todayShifts)
    .filter(hasMeaningfulMetrics)
    .filter(s => !isOwnerSeller(s));
  const sellerLines = buildSellerLines(todaySellers, { includeRevenue: false });

  const attentionSignals = [];
  if (store.forecast != null && store.plan != null && store.forecast < store.plan) {
    attentionSignals.push(`прогноз ниже плана на ${formatMoney(store.plan - store.forecast)}`);
  }
  if (isPartial) {
    attentionSignals.push('сегодняшние данные частичные');
  }

  const lines = [title, formatDateRu(todayDate), ''];

  if (isNoData) {
    lines.push('⚠️ Данные сегодняшней смены ещё не загружены.');
  } else {
    lines.push(
      'Сегодня:',
      `• Выручка: ${formatMoney(todaySummary.revenue) ?? 'н/д'}`,
      `• Чеков: ${todaySummary.receipts ?? 'н/д'}`,
      `• Средний чек: ${formatMoney(todaySummary.averageCheck) ?? 'н/д'}`,
      `• Товаров/чек: ${todaySummary.itemsPerCheckFormatted ?? 'н/д'}`,
      `• QR: ${todaySummary.qrShareFormatted ?? 'н/д'}`,
    );
  }

  lines.push(
    '',
    'Месяц:',
    `• Выручка: ${store.revenue != null ? formatMoney(store.revenue) : 'н/д'}`,
    `• План: ${store.plan != null ? formatMoney(store.plan) : 'н/д'} (${store.planPercentFormatted ?? 'н/д'})`,
    `• Осталось до плана: ${store.remainingToPlan != null ? formatMoney(store.remainingToPlan) : 'н/д'}`,
    `• Прогноз: ${store.forecast != null ? formatMoney(store.forecast) : 'н/д'}`,
  );

  if (isNoData) {
    lines.push('', 'Продавцы сегодня: данные смен ещё не загружены.');
  } else if (sellerLines.length > 0) {
    lines.push('', 'Продавцы сегодня:', ...sellerLines);
  }

  if (attentionSignals.length > 0) {
    lines.push('', '⚠️ Что требует внимания:', ...attentionSignals.map(s => `• ${s}`));
  } else if (!isNoData) {
    lines.push('', '✅ Критичных отклонений сегодня нет.');
  }

  if (!isFinal) {
    lines.push('', `Данные: ${dataStatusLabel(dataStatus)}.${isPartial ? ' Данные за сегодня частичные.' : ''}`);
  }

  return {
    text: lines.join('\n'),
    data: { today: todaySummary, month: store, sellers: todaySellers, settings },
    provenance: { source: 'business_kpi', operations: ['getTodaySummary', 'getStoreSummary', 'getShifts'], retrievedAt: new Date().toISOString() },
  };
}

async function buildWeeklyReport(skill, { storeId, timezone = DEFAULT_TIMEZONE, now = new Date() }) {
  const { store, performance, settings } = await fetchCurrentMonthContext(skill, storeId, timezone);

  const today = dateInTimezone(now, timezone);
  const periodEnd = getWeeklyPeriodEnd(timezone, now);
  const last7Range = dateRangeDays(periodEnd, 7);
  const prev7Range = dateRangeDays(addDays(periodEnd, -7), 7);
  const preliminaryNote = periodEnd !== today
    ? 'Сегодняшний день ещё не завершён; сравнение предварительное.'
    : null;

  const [last7Shifts, prev7Shifts] = await Promise.all([
    fetchShiftsForRange(skill, storeId, last7Range.startDate, last7Range.endDate),
    fetchShiftsForRange(skill, storeId, prev7Range.startDate, prev7Range.endDate),
  ]);

  const last7Store = aggregateShifts(last7Shifts);
  const prev7Store = aggregateShifts(prev7Shifts);
  const last7Sellers = aggregateShiftsBySeller(last7Shifts);
  const prev7Sellers = aggregateShiftsBySeller(prev7Shifts);

  const storeRevenueDelta = deltaPercent(last7Store.revenue, prev7Store.revenue);
  const storeReceiptsDelta = deltaPercent(last7Store.receipts, prev7Store.receipts);
  const storeAverageCheckDelta = deltaPercent(last7Store.averageCheck, prev7Store.averageCheck);
  const storeItemsPerCheckDelta = deltaPercent(last7Store.itemsPerCheck, prev7Store.itemsPerCheck);
  const storeQrShareDelta = deltaPercentPoints(last7Store.qrShare, prev7Store.qrShare);

  const performanceByName = new Map((performance.sellers || []).map(s => [s.name, s]));
  const sellerComparison = last7Sellers
    .filter(s => !isOwnerSeller(s))
    .map(current => {
      const previous = prev7Sellers.find(p => p.name === current.name) || {};
      const perf = performanceByName.get(current.name) || {};
      const currentKpi = perf.currentKpi ?? current.averageKpi;
      const previousKpi = perf.previousKpi ?? previous.averageKpi ?? null;
      return {
        name: current.name,
        currentKpi,
        previousKpi,
        kpiDelta: present(previousKpi) ? currentKpi - previousKpi : null,
        revenue: current.revenue,
        revenueDelta: deltaPercent(current.revenue, previous.revenue),
        averageCheck: current.averageCheck,
        averageCheckDelta: deltaPercent(current.averageCheck, previous.averageCheck),
        itemsPerCheck: current.itemsPerCheck,
        itemsPerCheckDelta: deltaPercent(current.itemsPerCheck, previous.itemsPerCheck),
        qrShare: current.qrShare,
        qrShareDelta: deltaPercent(current.qrShare, previous.qrShare),
      };
    });

  const rankedByKpi = rankSellers(sellerComparison, 'currentKpi');
  const rankedByRevenue = rankSellers(sellerComparison, 'revenue');
  const bestSeller = rankedByKpi[0] || null;
  const attentionSeller = [...sellerComparison]
    .filter(s => present(s.kpiDelta))
    .sort((a, b) => (a.kpiDelta ?? 0) - (b.kpiDelta ?? 0))[0] || null;

  const daysRemaining = daysRemainingInMonth(timezone, now);
  const remainingToPlan = store.remainingToPlan;
  const requiredDaily = requiredPerDay(remainingToPlan, daysRemaining);

  const significantChanges = [];
  if (present(storeRevenueDelta) && Math.abs(storeRevenueDelta) >= 0.05) {
    const direction = storeRevenueDelta > 0 ? 'выросла' : 'снизилась';
    significantChanges.push(`• Выручка ${direction} на ${formatPercentAbs(Math.abs(storeRevenueDelta))}.`);
  }
  if (present(storeAverageCheckDelta) && Math.abs(storeAverageCheckDelta) >= 0.05) {
    const direction = storeAverageCheckDelta > 0 ? 'вырос' : 'снизился';
    significantChanges.push(`• Средний чек ${direction} на ${formatPercentAbs(Math.abs(storeAverageCheckDelta))}.`);
  }
  if (present(storeItemsPerCheckDelta) && Math.abs(storeItemsPerCheckDelta) >= 0.05) {
    const direction = storeItemsPerCheckDelta > 0 ? 'выросло' : 'снизилось';
    significantChanges.push(`• Товаров в чеке ${direction} на ${formatPercentAbs(Math.abs(storeItemsPerCheckDelta))}.`);
  }
  if (present(storeQrShareDelta) && Math.abs(storeQrShareDelta) >= 5.0) {
    const direction = storeQrShareDelta > 0 ? 'выросла' : 'снизилась';
    significantChanges.push(`• Доля QR ${direction} на ${formatNumber(Math.abs(storeQrShareDelta), 1)} п.п.`);
  }
  if (present(storeReceiptsDelta) && Math.abs(storeReceiptsDelta) >= 0.05) {
    const direction = storeReceiptsDelta > 0 ? 'выросло' : 'снизилось';
    significantChanges.push(`• Количество чеков ${direction} на ${formatPercentAbs(Math.abs(storeReceiptsDelta))}.`);
  }

  const lines = [
    `📈 Миска — итоги недели`,
    `Период: ${formatPeriodRange(last7Range.startDate, last7Range.endDate)}`,
    ...(preliminaryNote ? [preliminaryNote] : []),
    '',
    '1. Продажи',
    `• Выручка: ${formatMoney(last7Store.revenue) ?? 'н/д'} ${storeRevenueDelta != null ? `(${formatDeltaPercent(storeRevenueDelta)})` : ''}`,
    `• Чеки: ${last7Store.receipts ?? 'н/д'} ${storeReceiptsDelta != null ? `(${formatDeltaPercent(storeReceiptsDelta)})` : ''}`,
    `• Средний чек: ${formatMoney(last7Store.averageCheck) ?? 'н/д'} ${storeAverageCheckDelta != null ? `(${formatDeltaPercent(storeAverageCheckDelta)})` : ''}`,
    `• Товаров/чек: ${formatNumber(last7Store.itemsPerCheck, 2) ?? 'н/д'} ${storeItemsPerCheckDelta != null ? `(${formatDeltaPercent(storeItemsPerCheckDelta)})` : ''}`,
    `• QR: ${formatPercent(last7Store.qrShare) ?? 'н/д'} ${storeQrShareDelta != null ? `(${formatDeltaPercentPoints(storeQrShareDelta)})` : ''}`,
    '',
    '2. План месяца',
    `• Выполнено: ${store.planPercentFormatted ?? 'н/д'}`,
    `• Текущий прогноз: ${store.forecast != null ? formatMoney(store.forecast) : 'н/д'}`,
    `• Осталось до плана: ${remainingToPlan != null ? formatMoney(remainingToPlan) : 'н/д'}`,
  ];

  if (requiredDaily != null) {
    lines.push(`• В среднем нужно в день до конца месяца: ${formatMoney(requiredDaily)}`);
  }

  if (sellerComparison.length > 0) {
    lines.push('', '3. Продавцы');
    for (const s of sellerComparison) {
      const parts = [`• ${s.name}`];
      if (s.currentKpi != null) {
        parts.push(`KPI ${formatKpi(s.currentKpi)}`);
        if (s.kpiDelta != null) parts.push(`(${formatKpiDelta(s.kpiDelta)})`);
      }
      if (s.revenue != null) parts.push(`${formatMoney(s.revenue)}`);
      if (s.averageCheck != null) parts.push(`ср. чек ${formatMoney(s.averageCheck)}`);
      if (s.itemsPerCheck != null) parts.push(`тов/чек ${formatNumber(s.itemsPerCheck, 2)}`);
      if (s.qrShare != null) parts.push(`QR ${formatPercent(s.qrShare)}`);
      lines.push(parts.join(', '));
    }
    if (bestSeller) {
      lines.push('', `🥇 Лучший результат недели: ${bestSeller.name} — KPI ${formatKpi(bestSeller.currentKpi)}`);
    }
    if (attentionSeller && attentionSeller.kpiDelta < -SIGNIFICANT_KPI_DROP_POINTS) {
      lines.push(`⚠️ Требует внимания: ${attentionSeller.name} — KPI снизился на ${formatNumber(Math.abs(attentionSeller.kpiDelta), 2)} пункта.`);
    }
  }

  if (significantChanges.length > 0) {
    lines.push('', '4. Динамика магазина', ...significantChanges);
  }

  const priorities = [];
  if (present(storeItemsPerCheckDelta) && storeItemsPerCheckDelta < -0.05) {
    priorities.push('• Поднять товаров в чеке.');
  }
  if (attentionSeller && attentionSeller.kpiDelta < -SIGNIFICANT_KPI_DROP_POINTS) {
    priorities.push(`• Проверить показатели продавца: ${attentionSeller.name}.`);
  }
  if (present(storeQrShareDelta) && storeQrShareDelta < -0.05) {
    priorities.push('• Усилить QR.');
  }
  if (remainingToPlan != null && remainingToPlan > 0 && requiredDaily != null) {
    priorities.push('• Контролировать выполнение дневного темпа плана.');
  }

  if (priorities.length > 0) {
    lines.push('', '🎯 На следующей неделе', ...priorities.slice(0, 3));
  }

  lines.push('', `Данные Business KPI на ${now.toLocaleTimeString('ru-RU', { timeZone: timezone, hour: '2-digit', minute: '2-digit' })}.`);

  return {
    text: lines.join('\n'),
    data: {
      last7: { store: last7Store, sellers: last7Sellers },
      prev7: { store: prev7Store, sellers: prev7Sellers },
      comparison: sellerComparison,
      month: store,
      settings,
    },
    provenance: { source: 'business_kpi', operations: ['getStoreSummary', 'getSellerPerformance', 'getShifts'], retrievedAt: new Date().toISOString() },
  };
}

function determineState(value, threshold, direction = 'above') {
  if (!present(value) || !present(threshold)) return 'ok';
  if (direction === 'above') return value >= threshold ? 'ok' : 'warning';
  return value <= threshold ? 'ok' : 'warning';
}

function isSignificantDrop(current, previous, minDelta = 0.05) {
  return present(current) && present(previous) && previous - current >= minDelta;
}

function isStateWorsening(previousState, newState) {
  const order = { ok: 0, warning: 1, critical: 2 };
  return order[newState] > order[previousState || 'ok'];
}

function computeAlertDigest(text) {
  if (!text) return null;
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a)) {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    return keysA.every(key => deepEqual(a[key], b[key]));
  }
  return false;
}

function isSameAlertData(previous, newState, lastValue, metadata) {
  if (!previous) return false;
  if (previous.state !== newState) return false;
  if (!deepEqual(previous.lastValue, lastValue ?? null)) return false;
  if (!deepEqual(previous.metadata, metadata || {})) return false;
  return true;
}

function shouldSendAlert(previous, newState, currentDigest, lastValue, metadata) {
  const previousState = previous?.state;
  const lastSentAt = previous?.lastSentAt;
  const previousDigest = previous?.lastAlertDigest;

  if (newState === 'ok' && previousState && previousState !== 'ok') {
    return { send: true, reason: 'recovery' };
  }
  if (newState !== 'ok') {
    if (!lastSentAt) return { send: true, reason: 'first_alert' };
    if (isStateWorsening(previousState, newState)) return { send: true, reason: 'state_worsening' };
    if (previousDigest && previousDigest !== currentDigest) return { send: true, reason: 'digest_changed' };
    if (!previousDigest) {
      // Existing persistent row without a stored digest: compare underlying alert data.
      if (isSameAlertData(previous, newState, lastValue, metadata)) return { send: false, reason: 'same_data_no_digest' };
      return { send: true, reason: 'data_changed_no_digest' };
    }
    return { send: false, reason: 'same_digest' };
  }
  return { send: false, reason: 'state_ok' };
}

async function evaluateAlerts(skill, stateStore, {
  storeId,
  timezone = DEFAULT_TIMEZONE,
  ownerId,
  cooldownMinutes = 60,
  now = new Date(),
  dryRun = false,
  logger = { info: () => {}, warn: () => {}, error: () => {} },
  runId = null,
}) {
  const { store, performance, settings, today } = await fetchCurrentMonthContext(skill, storeId, timezone);
  const todaySummary = await executeSkill(skill, 'getTodaySummary', { storeId, timezone });

  const targets = settings?.settings?.targets || {};
  const dataQuality = await executeSkill(skill, 'getDataQuality', { storeId, year: new Date().getFullYear(), month: new Date().getMonth() + 1 });

  const alerts = [];
  const messages = [];
  const wouldSend = [];
  const wouldSendMessages = [];

  const addAlert = async (alertType, entityId, state, lastValue, lastValueText, text, metadata = {}) => {
    const previous = await stateStore.getAlertState(ownerId, alertType, entityId);
    const currentDigest = computeAlertDigest(text);
    const decision = shouldSendAlert(previous, state, currentDigest, lastValue, metadata);

    logger.info('kpi_alert_dedup_decision', {
      runId,
      alertType,
      entityId,
      state,
      lastValue,
      digest: currentDigest,
      storedDigest: previous?.lastAlertDigest || null,
      storedState: previous?.state || null,
      storedLastSentAt: previous?.lastSentAt || null,
      decision: decision.send,
      reason: decision.reason,
    });

    if (!dryRun) {
      if (state === 'ok' && previous?.state && previous.state !== 'ok') {
        await stateStore.resolveAlertState(ownerId, alertType, entityId);
        logger.info('kpi_alert_state_resolved', { runId, alertType, entityId });
      } else if (state !== 'ok') {
        const upserted = await stateStore.upsertAlertState({
          ownerId,
          alertType,
          entityId,
          state,
          lastValue,
          lastValueText,
          lastSentAt: decision.send ? now.toISOString() : previous?.lastSentAt,
          lastAlertDigest: currentDigest,
          metadata,
        });
        logger.info('kpi_alert_state_saved', {
          runId,
          alertType,
          entityId,
          state: upserted.state,
          lastSentAt: upserted.lastSentAt,
          lastAlertDigest: upserted.lastAlertDigest,
          sentCount: upserted.sentCount,
        });
      }
    }

    if (decision.send) {
      const alertMeta = { alertType, entityId, state, previousState: previous?.state || 'ok', digest: currentDigest };
      const sendMessage = text;
      if (dryRun) {
        wouldSend.push(alertMeta);
        wouldSendMessages.push(sendMessage);
      } else {
        alerts.push(alertMeta);
        messages.push(sendMessage);
      }
      logger.info('kpi_alert_sent', {
        runId,
        alertType,
        entityId,
        state,
        digest: currentDigest,
        dryRun,
      });
    }
  };

  // Plan risk
  {
    const forecast = store.forecast;
    const plan = store.plan;
    const state = (present(forecast) && present(plan) && forecast < plan) ? 'warning' : 'ok';
    const gap = present(forecast) && present(plan) ? plan - forecast : null;
    const daysRemaining = daysRemainingInMonth(timezone, now);
    const required = requiredPerDay(gap, daysRemaining);
    let text = null;
    if (state !== 'ok') {
      text = [
        `⚠️ Миска: риск невыполнения плана`,
        `План: ${formatMoney(plan)}`,
        `Прогноз: ${formatMoney(forecast)}`,
        `Отклонение: ${formatMoney(gap)}`,
        required != null ? `Для выполнения плана нужно в среднем: ${formatMoney(required)} в день.` : '',
      ].filter(Boolean).join('\n');
    } else if ((await stateStore.getAlertState(ownerId, 'plan_risk', 'month'))?.state !== 'ok') {
      text = `✅ Миска: прогноз снова выше плана\nПрогноз: ${formatMoney(forecast)}\nПлан: ${formatMoney(plan)}`;
    }
    if (text) {
      await addAlert('plan_risk', 'month', state, forecast, formatMoney(forecast), text, { plan, forecast, gap });
    }
  }

  // Seller KPI drop
  for (const seller of excludeOwner(performance.sellers || [])) {
    const current = seller.currentKpi;
    const previous = seller.previousKpi;
    const state = isSignificantDrop(current, previous, SIGNIFICANT_KPI_DROP_POINTS) ? 'warning' : 'ok';
    const delta = present(current) && present(previous) ? current - previous : null;
    let text = null;
    if (state !== 'ok') {
      text = [
        `⚠️ KPI продавца снизился`,
        seller.name,
        `было: ${formatKpi(previous)}`,
        `стало: ${formatKpi(current)}`,
        `изменение: ${formatKpiDelta(delta)}`,
      ].join('\n');
    } else if ((await stateStore.getAlertState(ownerId, 'seller_kpi_drop', seller.name))?.state !== 'ok') {
      text = `✅ KPI ${seller.name} восстановился\nТекущее значение: ${formatKpi(current)}`;
    }
    if (text) {
      await addAlert('seller_kpi_drop', seller.name, state, current, formatKpi(current), text, { previous, current });
    }
  }

  // QR share
  {
    const qrShare = store.qrShare;
    const target = targets.qrShare;
    const state = determineState(qrShare, target, 'above');
    let text = null;
    if (state !== 'ok') {
      text = `⚠️ Миска: доля QR ниже цели\nТекущая: ${formatPercent(qrShare)}\nЦель: ${formatPercent(target)}`;
    } else if (present(qrShare) && present(target) && (await stateStore.getAlertState(ownerId, 'qr_share', 'store'))?.state !== 'ok') {
      text = `✅ Миска: доля QR восстановилась\nТекущая: ${formatPercent(qrShare)}\nЦель: ${formatPercent(target)}`;
    }
    if (text) {
      await addAlert('qr_share', 'store', state, qrShare, formatPercent(qrShare), text, { target });
    }
  }

  // Items per check
  {
    const itemsPerCheck = store.itemsPerCheck;
    const target = targets.itemsPerReceipt;
    const state = determineState(itemsPerCheck, target, 'above');
    let text = null;
    if (state !== 'ok') {
      text = `⚠️ Миска: товаров в чеке ниже цели\nТекущее: ${formatNumber(itemsPerCheck, 2)}\nЦель: ${formatNumber(target, 2)}`;
    } else if (present(itemsPerCheck) && present(target) && (await stateStore.getAlertState(ownerId, 'items_per_check', 'store'))?.state !== 'ok') {
      text = `✅ Миска: товаров в чеке восстановилось\nТекущее: ${formatNumber(itemsPerCheck, 2)}\nЦель: ${formatNumber(target, 2)}`;
    }
    if (text) {
      await addAlert('items_per_check', 'store', state, itemsPerCheck, formatNumber(itemsPerCheck, 2), text, { target });
    }
  }

  // Average check
  {
    const averageCheck = store.averageCheck;
    const target = targets.averageCheck;
    const state = determineState(averageCheck, target, 'above');
    let text = null;
    if (state !== 'ok') {
      text = `⚠️ Миска: средний чек ниже цели\nТекущий: ${formatMoney(averageCheck)}\nЦель: ${formatMoney(target)}`;
    } else if (present(averageCheck) && present(target) && (await stateStore.getAlertState(ownerId, 'average_check', 'store'))?.state !== 'ok') {
      text = `✅ Миска: средний чек восстановился\nТекущий: ${formatMoney(averageCheck)}\nЦель: ${formatMoney(target)}`;
    }
    if (text) {
      await addAlert('average_check', 'store', state, averageCheck, formatMoney(averageCheck), text, { target });
    }
  }

  // Data quality
  {
    const incompleteSellers = dataQuality.incompleteSellers || [];
    const dq = evaluateDataQualityState(todaySummary, dataQuality, now, timezone);
    const state = dq.state;
    let text = null;
    if (state !== 'ok') {
      const parts = [`⚠️ Миска: данные KPI неполные`];
      parts.push(...dq.reasons);
      if (incompleteSellers.length > 0) {
        parts.push('Неполные данные: ' + incompleteSellers.map(s => `${s.name} (${s.missingFields.join(', ')})`).join('; '));
      }
      parts.push('Текущие KPI нельзя считать окончательными.');
      text = parts.join('\n');
    } else if ((await stateStore.getAlertState(ownerId, 'data_quality', 'store'))?.state !== 'ok') {
      text = '✅ Миска: данные KPI снова полные.';
    }
    if (text) {
      const dataStatus = dataQuality.dataStatus || todaySummary.dataStatus;
      await addAlert('data_quality', 'store', state, null, dataStatusLabel(dataStatus), text, { dataStatus, coverage: dataQuality.itemsCheckCoverage, incompleteSellers });
    }
  }

  return {
    alertsSent: alerts,
    messages,
    wouldSend: dryRun ? wouldSend : undefined,
    wouldSendMessages: dryRun ? wouldSendMessages : undefined,
    dryRun,
    noActionReason: (dryRun ? wouldSendMessages.length === 0 : messages.length === 0) ? 'no_conditions_met' : null,
    provenance: { source: 'business_kpi', operations: ['getStoreSummary', 'getSellerPerformance', 'getTodaySummary', 'getDataQuality', 'getSettings'], retrievedAt: now.toISOString() },
  };
}

function createKpiAutomation(skill, stateStore) {
  if (!skill || typeof skill.execute !== 'function') {
    throw new TypeError('Business KPI skill with execute() is required');
  }
  if (!stateStore || typeof stateStore.getAlertState !== 'function') {
    throw new TypeError('KPI automation state store is required');
  }

  return {
    buildDailyReport: options => buildDailyReport(skill, options),
    buildWeeklyReport: options => buildWeeklyReport(skill, options),
    evaluateAlerts: options => evaluateAlerts(skill, stateStore, options),
  };
}

module.exports = {
  createKpiAutomation,
  buildDailyReport,
  buildWeeklyReport,
  evaluateAlerts,
  DEFAULT_TIMEZONE,
  OWNER_EMPLOYEE_NAME,
};
