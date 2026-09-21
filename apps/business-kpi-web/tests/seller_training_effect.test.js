'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  evaluateSalesExercise,
} = require('../../../agents/business-kpi/rules/seller_training_effect');

function shift(date, revenue, receipts = 20, itemsSold = 40) {
  return {
    id: date,
    employeeId: 'seller-1',
    shiftDate: date,
    cash: revenue,
    acquiring: 0,
    qr: 0,
    receipts,
    itemsSold,
    upsellReceipts: 0,
    treatsRevenue: 0,
    treatsReceipts: 0,
    revenueSource: 'payments',
    paymentBreakdownAvailable: true,
    archivedAt: null,
    createdAt: date + 'T20:00:00.000Z',
  };
}

const proposal = {
  id: 'p1',
  employeeId: 'seller-1',
  shiftDate: '2026-09-17',
  taskType: 'SALES',
  libraryCode: 'SALE-02',
  title: 'Корм + дополнение',
  status: 'COMPLETED',
};

test('sales effect waits for three subsequent shifts', () => {
  const shifts = [
    shift('2026-09-14', 24000),
    shift('2026-09-15', 24000),
    shift('2026-09-16', 24000),
    shift('2026-09-18', 24000),
    shift('2026-09-19', 25200),
  ];
  const result = evaluateSalesExercise({
    proposal,
    shifts,
    settings: null,
    targets: { averageCheck: 1300 },
  });
  assert.equal(result.status, 'OBSERVING');
  assert.equal(result.beforeShifts, 3);
  assert.equal(result.afterShifts, 2);
  assert.equal(result.remainingShifts, 1);
  assert.equal(result.baseline, 1200);
});

test('sales effect marks no improvement only after full 3x3 comparison', () => {
  const shifts = [
    shift('2026-09-14', 24000),
    shift('2026-09-15', 24000),
    shift('2026-09-16', 24000),
    shift('2026-09-18', 24000),
    shift('2026-09-19', 24000),
    shift('2026-09-20', 24000),
  ];
  const result = evaluateSalesExercise({
    proposal,
    shifts,
    settings: null,
    targets: { averageCheck: 1300 },
  });
  assert.equal(result.status, 'NO_IMPROVEMENT');
  assert.equal(result.baseline, 1200);
  assert.equal(result.after, 1200);
  assert.equal(result.deltaPercent, 0);
  assert.equal(result.targetReached, false);
});

test('five percent improvement counts as an effect even before target is reached', () => {
  const shifts = [
    shift('2026-09-14', 24000),
    shift('2026-09-15', 24000),
    shift('2026-09-16', 24000),
    shift('2026-09-18', 25200),
    shift('2026-09-19', 25200),
    shift('2026-09-20', 25200),
  ];
  const result = evaluateSalesExercise({
    proposal,
    shifts,
    settings: null,
    targets: { averageCheck: 1400 },
  });
  assert.equal(result.status, 'EFFECTIVE');
  assert.equal(result.baseline, 1200);
  assert.equal(result.after, 1260);
  assert.equal(result.deltaPercent, 5);
  assert.equal(result.targetReached, false);
});

test('reaching target counts as an effect even with less than five percent growth', () => {
  const shifts = [
    shift('2026-09-14', 26000),
    shift('2026-09-15', 26000),
    shift('2026-09-16', 26000),
    shift('2026-09-18', 26500),
    shift('2026-09-19', 26500),
    shift('2026-09-20', 26500),
  ];
  const result = evaluateSalesExercise({
    proposal,
    shifts,
    settings: null,
    targets: { averageCheck: 1325 },
  });
  assert.equal(result.status, 'EFFECTIVE');
  assert.equal(result.targetReached, true);
  assert.ok(result.deltaPercent < 5);
});
