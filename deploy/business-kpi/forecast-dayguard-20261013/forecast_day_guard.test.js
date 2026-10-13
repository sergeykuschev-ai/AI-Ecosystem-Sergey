'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { aggregateMonth } = require('/opt/business-kpi/agents/business-kpi/services/aggregate_month.js');
const { MISKA_AUGUST_2026_SETTINGS } = require('/opt/business-kpi/agents/business-kpi/rules/reference_settings.js');

const DAY_MS = 86400000;
const WEEKDAY_SALES = [19000, 31000, 24000, 26000, 30000, 32000, 25000];
function makeShift(date) {
  const cash = WEEKDAY_SALES[date.getUTCDay()];
  return {
    id: date.toISOString().slice(0, 10), storeId: 'miska', employeeId: 'one',
    employeeName: 'Продавец', shiftDate: date.toISOString().slice(0, 10),
    cash, acquiring: 0, qr: 0, receipts: 1, itemsSold: 1,
    upsellReceipts: 0, treatsRevenue: 0, treatsReceipts: 0,
    archivedAt: null,
  };
}
function fixture(asOf, hasToday) {
  const historyShifts = [];
  for (let offset = 55; offset >= (hasToday ? 0 : 1); offset--) {
    historyShifts.push(makeShift(new Date(asOf.getTime() - offset * DAY_MS)));
  }
  const currentShifts = historyShifts.filter(s => s.shiftDate.startsWith('2026-10-'));
  return aggregateMonth(currentShifts, {
    year: 2026, month: 10, plan: 850000, settings: MISKA_AUGUST_2026_SETTINGS,
    asOf, historyShifts,
  });
}
function expectedOctoberRevenue() {
  let result = 0;
  for (let day = 1; day <= 31; day++) result += WEEKDAY_SALES[new Date(Date.UTC(2026, 9, day)).getUTCDay()];
  return result;
}

test('missing current day is included in weekday forecast and remaining-days denominator', () => {
  const result = fixture(new Date('2026-10-13T00:02:00Z'), false);
  assert.equal(result.forecast.method, 'weekday_56d');
  assert.equal(result.forecast.projectedRevenue, expectedOctoberRevenue());
  assert.equal(result.forecast.remainingCalendarDays, 19);
  assert.equal(result.forecast.requiredAveragePerRemainingDay, (850000-result.revenue)/19);
});

test('recorded current day is never counted twice', () => {
  const result = fixture(new Date('2026-10-13T00:02:00Z'), true);
  assert.equal(result.forecast.method, 'weekday_56d');
  assert.equal(result.forecast.projectedRevenue, expectedOctoberRevenue());
  assert.equal(result.forecast.remainingCalendarDays, 18);
});

test('last day without a shift is forecast instead of missing or division by zero', () => {
  const result = fixture(new Date('2026-10-31T00:02:00Z'), false);
  assert.equal(result.forecast.projectedRevenue, expectedOctoberRevenue());
  assert.equal(result.forecast.remainingCalendarDays, 1);
  assert.ok(Number.isFinite(result.forecast.requiredAveragePerRemainingDay));
});

test('last day with a shift leaves zero future days without dividing by zero', () => {
  const result = fixture(new Date('2026-10-31T00:02:00Z'), true);
  assert.equal(result.forecast.projectedRevenue, expectedOctoberRevenue());
  assert.equal(result.forecast.remainingCalendarDays, 0);
  assert.equal(result.forecast.requiredAveragePerRemainingDay, null);
});

test('historical months still use month-average baseline', () => {
  const result = aggregateMonth([makeShift(new Date('2026-10-01T00:00:00Z'))], {
    year: 2026, month: 10, plan: 850000,
    settings: MISKA_AUGUST_2026_SETTINGS,
    asOf: new Date('2026-11-02T00:00:00Z'), historyShifts: [],
  });
  assert.equal(result.forecast.method, 'month_average');
  assert.equal(result.forecast.remainingCalendarDays, 0);
});
