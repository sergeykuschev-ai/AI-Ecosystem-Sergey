'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildSellerPerformance,
  DEFAULT_THRESHOLDS,
  TREND_MODES,
} = require('../services/seller_performance_analytics');
const {
  MISKA_AUGUST_2026_SETTINGS,
} = require('../rules/reference_settings');

const EMPLOYEES = Object.freeze([
  { id: 'emp-a', displayName: 'A' },
  { id: 'emp-b', displayName: 'B' },
]);

const TARGETS = MISKA_AUGUST_2026_SETTINGS.targets;

function shift(overrides = {}) {
  return {
    id: `shift-${overrides.date || '2026-08-01'}-${overrides.employeeId || 'emp-a'}`,
    storeId: 'store-1',
    employeeId: 'emp-a',
    employeeName: 'A',
    shiftDate: '2026-08-01',
    cash: 0,
    acquiring: 24000,
    qr: 2400,
    receipts: 20,
    itemsSold: 50,
    upsellReceipts: 6,
    treatsRevenue: 0,
    treatsReceipts: 4,
    archivedAt: null,
    createdAt: `${overrides.date || '2026-08-01'}T00:00:00.000Z`,
    metrics: {
      revenue: 24000,
      averageCheck: 1200,
      itemsPerReceipt: 2.5,
      upsellReceiptShare: 0.3,
      treatsReceiptShare: 0.2,
      qrShare: 0.1,
      kpiScore: 92.5,
      kpiLevel: 'Хорошо+',
      kpiStatus: 'COMPLETE',
    },
    ...overrides,
  };
}

function build(options = {}) {
  return buildSellerPerformance({
    shifts: [],
    employees: EMPLOYEES,
    settings: MISKA_AUGUST_2026_SETTINGS,
    year: 2026,
    month: 8,
    mode: TREND_MODES.SHIFTS,
    ...options,
  });
}

test('insufficient data when seller has fewer than 5 active shifts', () => {
  const shifts = [
    shift({ shiftDate: '2026-08-01', employeeId: 'emp-a' }),
    shift({ shiftDate: '2026-08-02', employeeId: 'emp-a' }),
    shift({ shiftDate: '2026-08-03', employeeId: 'emp-a' }),
    shift({ shiftDate: '2026-08-04', employeeId: 'emp-a' }),
  ];
  const result = build({ shifts });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.equal(seller.dataCompleteness, 'insufficient');
  assert.equal(seller.trendDirection, 'insufficient');
  assert.equal(seller.rankingEligible, false);
});

test('preliminary status when seller has 5–9 active shifts', () => {
  const shifts = [];
  for (let day = 1; day <= 7; day += 1) {
    shifts.push(shift({ shiftDate: `2026-08-${String(day).padStart(2, '0')}`, employeeId: 'emp-a' }));
  }
  const result = build({ shifts });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.equal(seller.dataCompleteness, 'preliminary');
  assert.equal(seller.trendStatus, 'preliminary');
});

test('full 5 vs 5 trend up when latest 5 KPI averages higher than previous 5', () => {
  const shifts = [];
  for (let day = 1; day <= 10; day += 1) {
    const kpiScore = day <= 5 ? 88 : 94;
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore },
    }));
  }
  const result = build({ shifts });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.equal(seller.dataCompleteness, 'complete');
  assert.equal(seller.trendStatus, 'full');
  assert.equal(seller.trendDirection, 'up');
  assert.ok(seller.kpiDelta > 0);
});

test('full 5 vs 5 trend down when latest 5 KPI averages lower than previous 5', () => {
  const shifts = [];
  for (let day = 1; day <= 10; day += 1) {
    const kpiScore = day <= 5 ? 96 : 90;
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore },
    }));
  }
  const result = build({ shifts });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.equal(seller.trendDirection, 'down');
  assert.ok(seller.kpiDelta < 0);
});

test('stable trend when KPI delta is within threshold', () => {
  const shifts = [];
  for (let day = 1; day <= 10; day += 1) {
    const kpiScore = day <= 5 ? 92 : 92.5;
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore },
    }));
  }
  const result = build({ shifts });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.equal(seller.trendDirection, 'stable');
});

test('partial shifts are excluded from KPI trend', () => {
  const shifts = [];
  for (let day = 1; day <= 10; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      itemsSold: null,
      metrics: {
        ...shift().metrics,
        kpiScore: null,
        kpiStatus: 'UNRESOLVED',
      },
    }));
  }
  shifts.push(shift({ shiftDate: '2026-08-11', employeeId: 'emp-a', metrics: { ...shift().metrics, kpiScore: 95 } }));
  const result = build({ shifts });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.equal(seller.trendDirection, 'insufficient');
});

test('revenue per shift is normalized by shift count not total revenue', () => {
  const shiftsA = [];
  const shiftsB = [];
  for (let day = 1; day <= 10; day += 1) {
    shiftsA.push(shift({ shiftDate: `2026-08-${String(day).padStart(2, '0')}`, employeeId: 'emp-a' }));
  }
  for (let day = 1; day <= 5; day += 1) {
    shiftsB.push(shift({ shiftDate: `2026-08-${String(day).padStart(2, '0')}`, employeeId: 'emp-b' }));
  }
  const result = build({ shifts: [...shiftsA, ...shiftsB] });
  const sellerA = result.items.find(item => item.employeeId === 'emp-a');
  const sellerB = result.items.find(item => item.employeeId === 'emp-b');
  assert.equal(sellerA.revenuePerShift, 24000);
  assert.equal(sellerB.revenuePerShift, 24000);
  assert.equal(sellerA.shiftCount, 10);
  assert.equal(sellerB.shiftCount, 5);
});

test('receipts per shift is normalized by shift count', () => {
  const shifts = [];
  for (let day = 1; day <= 5; day += 1) {
    shifts.push(shift({ shiftDate: `2026-08-${String(day).padStart(2, '0')}`, employeeId: 'emp-a' }));
  }
  const result = build({ shifts });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.equal(seller.receiptsPerShift, 20);
});

test('QR share decline is measured in percentage points', () => {
  const shifts = [];
  for (let day = 1; day <= 5; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      qr: 4800,
      metrics: { ...shift().metrics, qrShare: 0.2 },
    }));
  }
  for (let day = 6; day <= 10; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      qr: 2400,
      metrics: { ...shift().metrics, qrShare: 0.1 },
    }));
  }
  const result = build({ shifts });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.ok(seller.attentionMetric);
  assert.equal(seller.attentionMetric.key, 'qrShare');
  assert.ok(Math.abs(seller.attentionMetric.delta - -0.1) < 0.001);
});

test('strongest metric is deterministic and based on target ratios', () => {
  const shifts = [];
  for (let day = 1; day <= 10; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      acquiring: 24000,
      receipts: 30,
      itemsSold: 90,
      metrics: {
        ...shift().metrics,
        revenue: 24000,
        averageCheck: 800,
        itemsPerReceipt: 3,
        kpiScore: 97,
      },
    }));
  }
  const result = build({ shifts });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.equal(seller.strongestMetric.key, 'itemsPerReceipt');
  assert.ok(seller.strongestMetric.ratio > 1);
});

test('attention metric flags significant KPI decline', () => {
  const shifts = [];
  for (let day = 1; day <= 5; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore: 96 },
    }));
  }
  for (let day = 6; day <= 10; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore: 90 },
    }));
  }
  const result = build({ shifts });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.ok(seller.attentionMetric);
  assert.equal(seller.attentionMetric.key, 'kpi');
  assert.ok(seller.attentionMetric.delta < -DEFAULT_THRESHOLDS.kpiAttention);
});

test('no attention alert when decline is below threshold', () => {
  const shifts = [];
  for (let day = 1; day <= 5; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore: 92.5 },
    }));
  }
  for (let day = 6; day <= 10; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore: 92 },
    }));
  }
  const result = build({ shifts });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.equal(seller.attentionMetric, null);
});

test('ranking excludes sellers with incomplete KPI', () => {
  const shifts = [];
  for (let day = 1; day <= 10; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      itemsSold: null,
      metrics: { ...shift().metrics, kpiScore: null, kpiStatus: 'UNRESOLVED' },
    }));
  }
  const result = build({ shifts });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.equal(seller.rankingEligible, false);
  assert.equal(result.teamSignals.bestKpi, null);
});

test('seller with fewer shifts is not penalized by total revenue in ranking', () => {
  const shiftsA = [];
  const shiftsB = [];
  for (let day = 1; day <= 10; day += 1) {
    shiftsA.push(shift({ shiftDate: `2026-08-${String(day).padStart(2, '0')}`, employeeId: 'emp-a' }));
  }
  for (let day = 1; day <= 5; day += 1) {
    shiftsB.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-b',
      acquiring: 12000,
      receipts: 10,
      itemsSold: 25,
      metrics: {
        ...shift().metrics,
        revenue: 12000,
        averageCheck: 1200,
        itemsPerReceipt: 2.5,
        kpiScore: 92.5,
      },
    }));
  }
  const result = build({ shifts: [...shiftsA, ...shiftsB] });
  const sellerA = result.items.find(item => item.employeeId === 'emp-a');
  const sellerB = result.items.find(item => item.employeeId === 'emp-b');
  assert.equal(sellerA.currentKpi, sellerB.currentKpi);
  assert.equal(sellerA.shiftCount, 10);
  assert.equal(sellerB.shiftCount, 5);
  assert.ok(sellerA.rankingEligible);
  assert.ok(sellerB.rankingEligible);
});

test('month mode compares current month with comparable previous month window', () => {
  const shifts = [];
  for (let day = 1; day <= 10; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-07-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore: 88 },
    }));
  }
  for (let day = 1; day <= 5; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore: 94 },
    }));
  }
  const result = build({ shifts, mode: TREND_MODES.MONTH });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.equal(seller.trendStatus, 'full');
  assert.equal(seller.trendDirection, 'up');
});

test('3 months mode compares current month with previous three months', () => {
  const shifts = [];
  for (let month = 5; month <= 7; month += 1) {
    for (let day = 1; day <= 5; day += 1) {
      shifts.push(shift({
        shiftDate: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        employeeId: 'emp-a',
        metrics: { ...shift().metrics, kpiScore: 88 },
      }));
    }
  }
  for (let day = 1; day <= 5; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore: 94 },
    }));
  }
  const result = build({ shifts, mode: TREND_MODES.THREE_MONTHS });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.equal(seller.trendDirection, 'up');
});

test('sparkline contains last 5 completed shifts KPI in chronological order', () => {
  const shifts = [];
  for (let day = 1; day <= 10; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore: 80 + day },
    }));
  }
  const result = build({ shifts });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.equal(seller.sparkline.length, 5);
  assert.deepEqual(seller.sparkline.map(point => point.kpi), [86, 87, 88, 89, 90]);
});

test('team signals surface best KPI, best trend and attention', () => {
  const shiftsA = [];
  const shiftsB = [];
  for (let day = 1; day <= 10; day += 1) {
    shiftsA.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore: day <= 5 ? 90 : 96 },
    }));
    shiftsB.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-b',
      metrics: { ...shift().metrics, kpiScore: day <= 5 ? 98 : 96 },
    }));
  }
  const result = build({ shifts: [...shiftsA, ...shiftsB] });
  assert.equal(result.teamSignals.bestKpi.employeeId, 'emp-b');
  assert.equal(result.teamSignals.bestTrend.employeeId, 'emp-a');
  assert.equal(result.teamSignals.attention.employeeId, 'emp-b');
});

test('preliminary 5 vs 1 trend is marked preliminary, not full', () => {
  const shifts = [];
  for (let day = 1; day <= 6; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore: day === 1 ? 100 : 90 },
    }));
  }
  const result = build({ shifts });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.equal(seller.dataCompleteness, 'preliminary');
  assert.equal(seller.trendConfidence, 'preliminary');
  assert.equal(seller.trendStatus, 'preliminary');
  assert.equal(seller.latestWindow.shiftCount, 5);
  assert.equal(seller.previousWindow.shiftCount, 1);
});

test('best trend prefers full over preliminary', () => {
  const shiftsA = [];
  const shiftsB = [];
  for (let day = 1; day <= 10; day += 1) {
    shiftsA.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore: day <= 5 ? 90 : 91 },
    }));
  }
  for (let day = 1; day <= 6; day += 1) {
    shiftsB.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-b',
      metrics: { ...shift().metrics, kpiScore: day === 1 ? 80 : 95 },
    }));
  }
  const result = build({ shifts: [...shiftsA, ...shiftsB] });
  assert.equal(result.teamSignals.bestTrend.employeeId, 'emp-a');
  assert.equal(result.teamSignals.bestPreliminaryTrend.employeeId, 'emp-b');
});

test('attention selects highest severity, not first array item', () => {
  const shiftsA = [];
  const shiftsB = [];
  for (let day = 1; day <= 10; day += 1) {
    shiftsA.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      acquiring: day <= 5 ? 24000 : 22000,
      receipts: day <= 5 ? 20 : 22,
      metrics: { ...shift().metrics, kpiScore: 92, averageCheck: day <= 5 ? 1200 : 1000 },
    }));
    shiftsB.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-b',
      metrics: { ...shift().metrics, kpiScore: day <= 5 ? 98 : 90 },
    }));
  }
  const result = build({ shifts: [...shiftsA, ...shiftsB] });
  assert.equal(result.teamSignals.attention.employeeId, 'emp-b');
  assert.equal(result.teamSignals.attention.metric.key, 'kpi');
});

test('positive growth is not classified as attention', () => {
  const shifts = [];
  for (let day = 1; day <= 10; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore: day <= 5 ? 90 : 96, averageCheck: day <= 5 ? 1000 : 1200 },
    }));
  }
  const result = build({ shifts });
  const seller = result.items.find(item => item.employeeId === 'emp-a');
  assert.equal(seller.trendDirection, 'up');
  assert.equal(seller.attentionMetric, null);
});

test('full KPI drop outranks preliminary KPI drop', () => {
  const shiftsA = [];
  const shiftsB = [];
  for (let day = 1; day <= 10; day += 1) {
    shiftsA.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore: day <= 5 ? 96 : 94 },
    }));
  }
  for (let day = 1; day <= 6; day += 1) {
    shiftsB.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-b',
      metrics: { ...shift().metrics, kpiScore: day === 1 ? 100 : 80 },
    }));
  }
  const result = build({ shifts: [...shiftsA, ...shiftsB] });
  assert.equal(result.teamSignals.attention.employeeId, 'emp-a');
  assert.equal(result.teamSignals.attention.confidence, 'full');
});

test('placeholder employees without user linkage are excluded from current team', () => {
  const shifts = [];
  for (let day = 1; day <= 10; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
    }));
  }
  const employeesWithPlaceholder = [
    ...EMPLOYEES,
    { id: 'emp-placeholder', displayName: 'Placeholder', employeeCode: 'seller-demo-3', active: true, userId: null },
  ];
  const result = build({ shifts, employees: employeesWithPlaceholder });
  assert.equal(result.items.some(item => item.employeeId === 'emp-placeholder'), false);
  assert.ok(result.excludedEmployees.some(e => e.employeeId === 'emp-placeholder' && e.reason === 'placeholder_no_user'));
});

test('terminated employees are excluded from current team', () => {
  const shifts = [];
  for (let day = 1; day <= 10; day += 1) {
    shifts.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
    }));
  }
  const employeesWithTerminated = [
    ...EMPLOYEES,
    { id: 'emp-terminated', displayName: 'Terminated', employeeCode: 'seller-terminated', active: true, terminatedOn: '2026-07-01' },
  ];
  const result = build({ shifts, employees: employeesWithTerminated });
  assert.equal(result.items.some(item => item.employeeId === 'emp-terminated'), false);
  assert.ok(result.excludedEmployees.some(e => e.employeeId === 'emp-terminated' && e.reason === 'terminated'));
});

test('team average KPI is average of included current sellers', () => {
  const shiftsA = [];
  const shiftsB = [];
  for (let day = 1; day <= 10; day += 1) {
    shiftsA.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-a',
      metrics: { ...shift().metrics, kpiScore: 90 },
    }));
    shiftsB.push(shift({
      shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
      employeeId: 'emp-b',
      metrics: { ...shift().metrics, kpiScore: 96 },
    }));
  }
  const result = build({ shifts: [...shiftsA, ...shiftsB] });
  assert.equal(result.teamSignals.teamAverageKpi, 93);
  assert.equal(result.teamSignals.teamAverageKpiExplanation, 'Среднее KPI текущих продавцов, включённых в управленческий блок.');
});
