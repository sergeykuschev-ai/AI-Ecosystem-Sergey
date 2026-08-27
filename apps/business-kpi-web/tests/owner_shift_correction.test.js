'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BusinessKpiService,
} = require('../application/business_kpi_service');
const {
  DEV_EMPLOYEES,
  DEV_STORE,
  InMemoryBusinessKpiStore,
} = require('../storage/in_memory_business_kpi_store');

const OWNER_ACTOR = Object.freeze({ id: 'owner-test', role: 'OWNER' });

function ownerShift(date, receipts, itemsSold, revenue) {
  const employee = DEV_EMPLOYEES.find(e => e.displayName === 'Кущев');
  return {
    storeId: DEV_STORE.id,
    employeeId: employee.id,
    shiftDate: date,
    shiftKey: 'main',
    cash: 0,
    acquiring: revenue,
    qr: 0,
    receipts,
    itemsSold,
    upsellReceipts: 0,
    treatsRevenue: 0,
    treatsReceipts: 0,
    comment: 'Owner shift correction test',
  };
}

function sellerShift(employeeName, date, revenue, receipts, itemsSold) {
  const employee = DEV_EMPLOYEES.find(e => e.displayName === employeeName);
  return {
    storeId: DEV_STORE.id,
    employeeId: employee.id,
    shiftDate: date,
    shiftKey: 'main',
    cash: 0,
    acquiring: revenue,
    qr: 0,
    receipts,
    itemsSold,
    upsellReceipts: 0,
    treatsRevenue: 0,
    treatsReceipts: 0,
    comment: 'Seller shift for owner exclusion test',
  };
}

function fixture() {
  const store = new InMemoryBusinessKpiStore();
  const service = new BusinessKpiService({
    store,
    now: () => new Date('2026-08-26T10:00:00.000Z'),
  });
  return { service, store };
}

function round(value, digits = 2) {
  if (value === null || value === undefined) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

test('owner shifts contribute to store totals', async () => {
  const { service } = fixture();
  await service.createShift(ownerShift('2026-08-01', 17, 44, 13406), OWNER_ACTOR);
  await service.createShift(sellerShift('Капитанова', '2026-08-03', 31372, 38, 127), OWNER_ACTOR);

  const dashboard = await service.getDashboard({
    storeId: DEV_STORE.id, year: 2026, month: 8,
  }, OWNER_ACTOR);

  assert.equal(dashboard.month.revenue, 13406 + 31372);
  assert.equal(dashboard.month.receipts, 17 + 38);
  assert.equal(dashboard.month.itemsSold, 44 + 127);
});

test('owner excluded from dashboard sellers', async () => {
  const { service } = fixture();
  await service.createShift(ownerShift('2026-08-01', 17, 44, 13406), OWNER_ACTOR);
  await service.createShift(sellerShift('Капитанова', '2026-08-03', 31372, 38, 127), OWNER_ACTOR);

  const dashboard = await service.getDashboard({
    storeId: DEV_STORE.id, year: 2026, month: 8,
  }, OWNER_ACTOR);

  const ownerRow = dashboard.sellers.find(s => s.employeeName === 'Кущев');
  assert.equal(ownerRow, undefined, 'owner must not appear in dashboard sellers');
  const sellerRow = dashboard.sellers.find(s => s.employeeName === 'Капитанова');
  assert.ok(sellerRow, 'seller row exists');
});

test('owner excluded from bonuses', async () => {
  const { service } = fixture();
  await service.createShift(ownerShift('2026-08-01', 17, 44, 13406), OWNER_ACTOR);
  await service.createShift(sellerShift('Капитанова', '2026-08-03', 31372, 38, 127), OWNER_ACTOR);

  const bonuses = await service.getBonuses({
    storeId: DEV_STORE.id, year: 2026, month: 8,
  }, OWNER_ACTOR);

  const ownerBonus = bonuses.items.find(s => s.employeeName === 'Кущев');
  assert.equal(ownerBonus, undefined, 'owner must not appear in bonuses');
});

test('owner excluded from seller performance ranking', async () => {
  const { service } = fixture();
  await service.createShift(ownerShift('2026-08-01', 17, 44, 13406), OWNER_ACTOR);
  await service.createShift(sellerShift('Капитанова', '2026-08-03', 31372, 38, 127), OWNER_ACTOR);

  const performance = await service.getSellerPerformance({
    storeId: DEV_STORE.id, year: 2026, month: 8,
  }, OWNER_ACTOR);

  const ownerItem = performance.items.find(s => s.employeeName === 'Кущев');
  assert.equal(ownerItem, undefined, 'owner must not appear in seller performance');
  const ownerExcluded = performance.excludedEmployees.find(e => e.employeeName === 'Кущев');
  assert.ok(ownerExcluded, 'owner is listed as excluded from current team');
  assert.equal(ownerExcluded.reason, 'owner_not_in_seller_kpi');
});

test('owner receipts and items included in store items/check', async () => {
  const { service } = fixture();
  await service.createShift(ownerShift('2026-08-01', 17, 44, 13406), OWNER_ACTOR);
  await service.createShift(ownerShift('2026-08-02', 20, 70, 22306), OWNER_ACTOR);
  await service.createShift(sellerShift('Капитанова', '2026-08-03', 31372, 38, 127), OWNER_ACTOR);

  const dashboard = await service.getDashboard({
    storeId: DEV_STORE.id, year: 2026, month: 8,
  }, OWNER_ACTOR);

  assert.equal(dashboard.month.receipts, 17 + 20 + 38);
  assert.equal(dashboard.month.itemsSold, 44 + 70 + 127);
  assert.equal(round(dashboard.month.itemsPerReceipt), round((44 + 70 + 127) / (17 + 20 + 38)));
});

const OWNER_DATES = [
  { date: '2026-08-01', receipts: 17, itemsSold: 44, expected: 2.59, revenue: 13406 },
  { date: '2026-08-02', receipts: 20, itemsSold: 70, expected: 3.5, revenue: 22306 },
  { date: '2026-08-08', receipts: 27, itemsSold: 84, expected: 3.11, revenue: 46868 },
  { date: '2026-08-09', receipts: 15, itemsSold: 37, expected: 2.47, revenue: 19785 },
  { date: '2026-08-15', receipts: 28, itemsSold: 88, expected: 3.14, revenue: 33035 },
  { date: '2026-08-23', receipts: 11, itemsSold: 33, expected: 3.0, revenue: 25000 },
];

for (const { date, receipts, itemsSold, expected, revenue } of OWNER_DATES) {
  test(`owner ${date} items/check = ${expected}`, async () => {
    const { service } = fixture();
    const created = await service.createShift(
      ownerShift(date, receipts, itemsSold, revenue),
      OWNER_ACTOR
    );
    assert.equal(round(created.metrics.itemsPerReceipt), expected, `items/check mismatch for ${date}`);
    assert.equal(created.metrics.revenue, revenue, `revenue must not change for ${date}`);
  });
}

test('owner total items/check across 6 shifts', async () => {
  const { service } = fixture();
  for (const { date, receipts, itemsSold, revenue } of OWNER_DATES) {
    await service.createShift(ownerShift(date, receipts, itemsSold, revenue), OWNER_ACTOR);
  }

  const dashboard = await service.getDashboard({
    storeId: DEV_STORE.id, year: 2026, month: 8,
  }, OWNER_ACTOR);

  assert.equal(dashboard.month.itemsSold, 356);
  assert.equal(dashboard.month.receipts, 118);
  assert.equal(round(dashboard.month.itemsPerReceipt), 3.02);
});

test(' Kapitanova and Cherednichenko are unaffected by owner shifts', async () => {
  const { service } = fixture();
  await service.createShift(ownerShift('2026-08-01', 17, 44, 13406), OWNER_ACTOR);
  await service.createShift(sellerShift('Капитанова', '2026-08-03', 31372, 38, 127), OWNER_ACTOR);
  await service.createShift(sellerShift('Чередниченко', '2026-08-04', 18538.8, 21, 60), OWNER_ACTOR);

  const dashboard = await service.getDashboard({
    storeId: DEV_STORE.id, year: 2026, month: 8,
  }, OWNER_ACTOR);

  assert.equal(dashboard.sellers.length, 2);
  const kapitanova = dashboard.sellers.find(s => s.employeeName === 'Капитанова');
  const cherednichenko = dashboard.sellers.find(s => s.employeeName === 'Чередниченко');
  assert.ok(kapitanova);
  assert.ok(cherednichenko);
  assert.equal(kapitanova.shiftsCount, 1);
  assert.equal(cherednichenko.shiftsCount, 1);
});

test('null items/receipts do not become zero in metrics', async () => {
  const { service } = fixture();
  const partial = {
    storeId: DEV_STORE.id,
    employeeId: DEV_EMPLOYEES.find(e => e.displayName === 'Капитанова').id,
    shiftDate: '2026-08-05',
    shiftKey: 'main',
    cash: 10000,
    acquiring: 10000,
    qr: 0,
    receipts: 10,
    itemsSold: null,
    upsellReceipts: 0,
    treatsRevenue: 0,
    treatsReceipts: 0,
    comment: 'Partial shift',
  };
  const created = await service.createShift(partial, OWNER_ACTOR);
  assert.equal(created.metrics.itemsPerReceipt, null);
});

test('items/check coverage is exposed when some shifts lack itemsSold', async () => {
  const { service } = fixture();
  await service.createShift(ownerShift('2026-08-01', 17, 44, 13406), OWNER_ACTOR);
  await service.createShift(ownerShift('2026-08-02', 20, 70, 22306), OWNER_ACTOR);
  await service.createShift(sellerShift('Капитанова', '2026-08-03', 31372, 38, null), OWNER_ACTOR);

  const dashboard = await service.getDashboard({
    storeId: DEV_STORE.id, year: 2026, month: 8,
  }, OWNER_ACTOR);

  const coverage = dashboard.month.itemsCheckCoverage;
  assert.ok(coverage, 'itemsCheckCoverage must be present');
  assert.equal(coverage.totalShifts, 3);
  assert.equal(coverage.shiftsWithItems, 2);
  assert.equal(dashboard.month.itemsPerReceipt, null);
});
