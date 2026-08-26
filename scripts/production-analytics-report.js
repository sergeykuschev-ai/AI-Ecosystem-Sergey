'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { buildSellerPerformance, TREND_MODES } = require('../agents/business-kpi/services/seller_performance_analytics');

const DATA_FILE = path.join(__dirname, '../tmp/production-owner-review-data.json');

function fmtNum(value, digits = 2) {
  if (value === null || value === undefined) return 'н/д';
  return Number(value).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtPct(value, digits = 2) {
  if (value === null || value === undefined) return 'н/д';
  return `${(value * 100).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

function arrow(dir) {
  if (dir === 'up') return '↑';
  if (dir === 'down') return '↓';
  return '→';
}

function describeAttention(att) {
  if (!att) return 'Нет';
  if (att.key === 'qrShare') {
    return `${att.label} ${fmtNum(att.delta * 100)} п.п.`;
  }
  const value = att.isAbsolute ? fmtNum(att.delta) : fmtNum(att.delta * 100);
  return `${att.label} ${value}${att.isAbsolute ? '' : '%'}`;
}

function sellerReport(item) {
  return {
    validCompletedShifts: item.shiftCount,
    dataCompleteness: item.dataCompleteness,
    trendState: item.trendConfidence,
    latest5: {
      shiftCount: item.latestWindow?.shiftCount || 0,
      kpis: (item.latestWindow?.shifts || []).map(s => `${s.date}: ${fmtNum(s.kpi)}`),
      avgKpi: fmtNum(item.latestWindow?.averageKpi),
      avgCheck: fmtNum(item.latestWindow?.averageCheck),
      itemsPerReceipt: fmtNum(item.latestWindow?.itemsPerReceipt),
      qrShare: fmtPct(item.latestWindow?.qrShare),
    },
    previous5: {
      shiftCount: item.previousWindow?.shiftCount || 0,
      kpis: (item.previousWindow?.shifts || []).map(s => `${s.date}: ${fmtNum(s.kpi)}`),
      avgKpi: fmtNum(item.previousWindow?.averageKpi),
      avgCheck: fmtNum(item.previousWindow?.averageCheck),
      itemsPerReceipt: fmtNum(item.previousWindow?.itemsPerReceipt),
      qrShare: fmtPct(item.previousWindow?.qrShare),
    },
    currentMonthAvgKpi: fmtNum(item.currentKpi),
    previousWindowAvgKpi: fmtNum(item.previousKpi),
    delta: fmtNum(item.kpiDelta),
    direction: `${arrow(item.trendDirection)} ${item.trendLabel}`,
    trendExplanation: item.trendExplanation,
    revenuePerShift: fmtNum(item.revenuePerShift),
    receiptsPerShift: fmtNum(item.receiptsPerShift),
    averageCheck: fmtNum(item.averageCheck),
    itemsPerReceipt: fmtNum(item.itemsPerReceipt),
    sellerQrShare: fmtPct(item.sellerQrShare),
    strongestMetric: item.strongestMetric?.label || 'н/д',
    attentionMetric: describeAttention(item.attentionMetric),
    attentionConfidence: item.attentionMetric?.confidence || null,
    sparkline: item.sparkline.map(s => s.kpi).join(' → '),
  };
}

(async () => {
  if (!fs.existsSync(DATA_FILE)) {
    console.error('Production data file not found. Run scripts/fetch-production-data.js first.');
    process.exitCode = 1;
    return;
  }

  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const shifts = data.allAugustShifts.items || data.allAugustShifts || [];
  const employees = data.referenceData.employees;
  const settings = data.settings?.settings || null;

  const analytics = buildSellerPerformance({
    shifts,
    employees,
    settings,
    year: 2026,
    month: 8,
    mode: TREND_MODES.SHIFTS,
  });

  const kap = analytics.items.find(i => i.employeeName === 'Капитанова');
  const cher = analytics.items.find(i => i.employeeName === 'Чередниченко');

  const report = {
    source: 'read-only production shifts via /api/business-kpi/shifts',
    productionUrl: process.env.BROWSER_AUTH_PRODUCTION_URL || 'http://100.78.67.88:13220',
    fetchedAt: new Date().toISOString(),
    shiftCount: shifts.length,
    includedEmployees: analytics.items.map(i => i.employeeName),
    excludedEmployees: analytics.excludedEmployees,
    kapitanova: sellerReport(kap),
    cherednichenko: sellerReport(cher),
    teamSignals: analytics.teamSignals,
  };

  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
