'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  aggregateDays,
  aggregateMonth,
  aggregateSellers,
} = require('../services/aggregate_month');
const {
  MISKA_AUGUST_2026_SETTINGS,
} = require('../rules/reference_settings');

function shift(overrides = {}) {
  return {
    id: 'shift-1',
    storeId: 'store-1',
    employeeId: 'employee-1',
    employeeName: 'Продавец 1',
    shiftDate: '2026-08-01',
    cash: 10000,
    acquiring: 14000,
    qr: 2400,
    receipts: 20,
    itemsSold: 50,
    upsellReceipts: 6,
    treatsRevenue: 1200,
    treatsReceipts: 4,
    archivedAt: null,
    ...overrides,
  };
}

test('month aggregation sums facts and derives ratios from totals', () => {
  const result = aggregateMonth([
    shift(),
    shift({
      id: 'shift-2',
      shiftDate: '2026-08-02',
      cash: 5000,
      acquiring: 7000,
      qr: 1200,
      receipts: 5,
      itemsSold: 5,
      upsellReceipts: 1,
      treatsRevenue: 300,
      treatsReceipts: 1,
    }),
  ], {
    year: 2026,
    month: 8,
    plan: 745000,
    settings: MISKA_AUGUST_2026_SETTINGS,
    asOf: new Date('2026-08-10T00:00:00Z'),
  });

  assert.equal(result.revenue, 36000);
  assert.equal(result.receipts, 25);
  assert.equal(result.averageCheck, 1440);
  assert.equal(result.itemsSold, 55);
  assert.equal(result.itemsPerReceipt, 2.2);
  assert.equal(result.qrShare, 0.1);
  assert.equal(result.shiftsCount, 2);
  assert.equal(result.dataDays, 2);
  assert.equal(result.forecast.averageRevenuePerDataDay, 18000);
  assert.equal(result.forecast.projectedRevenue, 558000);
  assert.equal(result.forecast.remainingCalendarDays, 21);
  assert.equal(result.forecast.remainingToPlan, 709000);

  const days = aggregateDays(result);
  assert.deepEqual(days.map(day => day.revenue), [24000, 12000]);
  assert.deepEqual(days.map(day => day.itemsPerReceipt), [2.5, 1]);
});

test('seller aggregation uses exact totals and confirmed bonus formula', () => {
  const month = aggregateMonth([
    shift(),
    shift({ id: 'shift-2', shiftDate: '2026-08-02' }),
  ], {
    year: 2026,
    month: 8,
    plan: 48000,
    settings: MISKA_AUGUST_2026_SETTINGS,
    asOf: new Date('2026-08-03T00:00:00Z'),
  });
  const [seller] = aggregateSellers(month, MISKA_AUGUST_2026_SETTINGS);

  assert.equal(seller.shiftsCount, 2);
  assert.equal(seller.revenue, 48000);
  assert.equal(seller.revenuePerShift, 24000);
  assert.equal(seller.averageCheck, 1200);
  assert.equal(seller.itemsPerReceipt, 2.5);
  assert.equal(seller.bonusStatus, 'COMPLETE');
  assert.ok(seller.bonus > 0);
});

test('empty month has NO_DATA and null forecast rates', () => {
  const result = aggregateMonth([], {
    year: 2026,
    month: 8,
    plan: 745000,
    settings: MISKA_AUGUST_2026_SETTINGS,
    asOf: new Date('2026-08-10T00:00:00Z'),
  });

  assert.equal(result.status, 'NO_DATA');
  assert.equal(result.revenue, 0);
  assert.equal(result.averageCheck, null);
  assert.equal(result.itemsPerReceipt, null);
  assert.equal(result.forecast.averageRevenuePerDataDay, null);
  assert.equal(result.forecast.projectedRevenue, null);
});

test('seller aggregation reports shift norm and coefficient in bonus details', () => {
  const month = aggregateMonth([
    shift(),
    shift({ id: 'shift-2', shiftDate: '2026-08-02' }),
    shift({ id: 'shift-3', shiftDate: '2026-08-03' }),
    shift({ id: 'shift-4', shiftDate: '2026-08-04' }),
    shift({ id: 'shift-5', shiftDate: '2026-08-05' }),
    shift({ id: 'shift-6', shiftDate: '2026-08-06' }),
  ], {
    year: 2026,
    month: 8,
    plan: 48000,
    settings: MISKA_AUGUST_2026_SETTINGS,
    asOf: new Date('2026-08-07T00:00:00Z'),
  });
  const [seller] = aggregateSellers(month, MISKA_AUGUST_2026_SETTINGS);

  assert.equal(seller.shiftsCount, 6);
  assert.equal(seller.bonusDetails.shiftNorm, 15);
  assert.equal(seller.bonusDetails.shiftCoefficient, 0.4);
});

test('seller aggregation exposes missing fields instead of zero bonus for partial data', () => {
  const month = aggregateMonth([
    shift({ itemsSold: null, upsellReceipts: null }),
  ], {
    year: 2026,
    month: 8,
    plan: 48000,
    settings: MISKA_AUGUST_2026_SETTINGS,
    asOf: new Date('2026-08-02T00:00:00Z'),
  });
  const [seller] = aggregateSellers(month, MISKA_AUGUST_2026_SETTINGS);

  assert.equal(seller.bonusStatus, 'UNRESOLVED');
  assert.equal(seller.bonus, null);
  assert.ok(seller.missingFields.includes('itemsSold'));
  assert.ok(seller.missingFields.includes('upsellReceipts'));
});

test('sellers are ranked by revenue per shift, not total revenue', () => {
  const month = aggregateMonth([
    shift({ employeeId: 'employee-a', employeeName: 'A', shiftDate: '2026-08-01' }),
    shift({ employeeId: 'employee-a', employeeName: 'A', id: 'shift-a2', shiftDate: '2026-08-02' }),
    shift({ employeeId: 'employee-b', employeeName: 'B', id: 'shift-b1', shiftDate: '2026-08-01', cash: 50000, acquiring: 0, qr: 0, receipts: 1, itemsSold: 1, upsellReceipts: 0, treatsRevenue: 0, treatsReceipts: 0 }),
  ], {
    year: 2026,
    month: 8,
    plan: 100000,
    settings: MISKA_AUGUST_2026_SETTINGS,
    asOf: new Date('2026-08-03T00:00:00Z'),
  });
  const sellers = aggregateSellers(month, MISKA_AUGUST_2026_SETTINGS);

  assert.equal(sellers[0].employeeName, 'B');
  assert.equal(sellers[1].employeeName, 'A');
  assert.ok(sellers[0].revenuePerShift > sellers[1].revenuePerShift);
});
