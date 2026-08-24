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
const {
  MISKA_AUGUST_2026_SETTINGS,
} = require('../../../agents/business-kpi/rules/reference_settings');

const OWNER = Object.freeze({ id: 'owner-test', role: 'OWNER' });
const MANAGER = Object.freeze({ id: 'manager-test', role: 'MANAGER' });
const SELLER = Object.freeze({ id: 'seller-test', role: 'SELLER' });

function shiftInput(overrides = {}) {
  return {
    storeId: DEV_STORE.id,
    employeeId: DEV_EMPLOYEES[0].id,
    shiftDate: '2026-08-12',
    shiftKey: 'main',
    cash: 12000,
    acquiring: 18000,
    qr: 3000,
    receipts: 25,
    itemsSold: 60,
    upsellReceipts: 8,
    treatsRevenue: 1500,
    treatsReceipts: 6,
    comment: 'Тестовая смена',
    ...overrides,
  };
}

function fixture() {
  const store = new InMemoryBusinessKpiStore();
  const service = new BusinessKpiService({
    store,
    now: () => new Date('2026-08-15T10:00:00.000Z'),
  });
  return { service, store };
}

test('manual create persists a source shift, KPI snapshot, and audit event', async () => {
  const { service, store } = fixture();
  const created = await service.createShift(shiftInput(), MANAGER);

  assert.equal(created.source, 'web_manual');
  assert.equal(created.metrics.revenue, 30000);
  assert.equal(created.metrics.averageCheck, 1200);
  assert.equal(created.metrics.itemsPerReceipt, 2.4);
  assert.equal(store.shifts.length, 1);
  assert.equal(store.kpiResults.length, 1);
  assert.equal(store.audit.length, 1);
  assert.equal(store.audit[0].action, 'SHIFT_CREATED');
  assert.equal(store.audit[0].actorId, MANAGER.id);
});

test('update recalculates KPI and retains old and new values in audit', async () => {
  const { service, store } = fixture();
  const created = await service.createShift(shiftInput(), OWNER);
  const updated = await service.updateShift(created.id, { cash: 22000 }, OWNER, {
    reason: 'Исправление кассы',
  });

  assert.equal(updated.metrics.revenue, 40000);
  assert.equal(updated.metrics.averageCheck, 1600);
  assert.equal(store.kpiResults.length, 2);
  assert.equal(store.audit[1].action, 'SHIFT_UPDATED');
  assert.equal(store.audit[1].oldValue.cash, 12000);
  assert.equal(store.audit[1].newValue.cash, 22000);
  assert.equal(store.audit[1].reason, 'Исправление кассы');
});

test('duplicate active identity is rejected and transaction leaves no partial audit', async () => {
  const { service, store } = fixture();
  await service.createShift(shiftInput(), OWNER);

  await assert.rejects(
    () => service.createShift(shiftInput(), OWNER),
    error => error.code === 'DUPLICATE_SHIFT' && error.statusCode === 409
  );
  assert.equal(store.shifts.length, 1);
  assert.equal(store.kpiResults.length, 1);
  assert.equal(store.audit.length, 1);

  const secondPart = await service.createShift(
    shiftInput({ shiftKey: 'evening' }),
    OWNER
  );
  assert.equal(secondPart.shiftKey, 'evening');
});

test('archive is owner-only, excludes shift from dashboard, and writes audit', async () => {
  const { service, store } = fixture();
  const created = await service.createShift(shiftInput(), OWNER);

  await assert.rejects(
    () => service.archiveShift(created.id, { id: 'seller-1', role: 'SELLER' }),
    error => error.code === 'FORBIDDEN'
  );
  await service.archiveShift(created.id, OWNER, { reason: 'Дубль' });
  const dashboard = await service.getDashboard({
    storeId: DEV_STORE.id,
    year: 2026,
    month: 8,
  });

  assert.equal(dashboard.month.shiftsCount, 0);
  assert.equal(store.audit.at(-1).action, 'SHIFT_ARCHIVED');
  assert.equal(store.audit.at(-1).reason, 'Дубль');
  const archived = await service.getShift(created.id);
  assert.equal(archived.archivedBy, OWNER.id);
  assert.deepEqual(
    archived.audit.map(item => item.action),
    ['SHIFT_CREATED', 'SHIFT_ARCHIVED']
  );
});

test('monthly plan update is owner-only and immediately changes dashboard', async () => {
  const { service, store } = fixture();

  await assert.rejects(
    () => service.updateMonthlyPlan({
      storeId: DEV_STORE.id, year: 2026, month: 8, revenuePlan: 800000,
    }, SELLER),
    error => error.code === 'FORBIDDEN'
  );
  await service.updateMonthlyPlan({
    storeId: DEV_STORE.id,
    year: 2026,
    month: 8,
    revenuePlan: 800000,
  }, OWNER);
  const dashboard = await service.getDashboard({
    storeId: DEV_STORE.id, year: 2026, month: 8,
  });

  assert.equal(dashboard.month.plan, 800000);
  assert.equal(store.audit.at(-1).action, 'MONTHLY_PLAN_UPDATED');
});

test('Excel import uses the identical shift model and calculations with provenance', async () => {
  const { service } = fixture();
  const imported = await service.importExcelShift(
    shiftInput({ shiftDate: '2026-08-13' }),
    MANAGER,
    { sourceRef: 'workbook.xlsx:Input:row-2' }
  );
  const manual = await service.createShift(
    shiftInput({ shiftDate: '2026-08-14' }),
    MANAGER
  );

  assert.equal(imported.source, 'excel_import');
  assert.equal(imported.sourceRef, 'workbook.xlsx:Input:row-2');
  assert.deepEqual(imported.metrics, manual.metrics);
});

test('server-derived fields and invalid QR are rejected at the boundary', async () => {
  const { service, store } = fixture();

  await assert.rejects(
    () => service.createShift({ ...shiftInput(), revenue: 30000 }, OWNER),
    error => error.code === 'UNSUPPORTED_SHIFT_FIELD'
  );
  await assert.rejects(
    () => service.createShift(shiftInput({ qr: 18000.01 }), OWNER),
    error => error.code === 'VALIDATION_ERROR' && /QR/.test(error.message)
  );
  assert.equal(store.shifts.length, 0);
});

test('year summary excludes current month from best/worst and splits YTD', async () => {
  const { service } = fixture();

  await service.createSettingsVersion({
    storeId: DEV_STORE.id,
    effectiveFrom: '2026-05-01',
    reason: 'тестовые нормативы',
    settings: {
      ...MISKA_AUGUST_2026_SETTINGS,
      version: undefined,
      effectiveFrom: undefined,
      effectiveTo: undefined,
      source: undefined,
      unresolved: undefined,
    },
  }, OWNER);

  const baseShift = {
    storeId: DEV_STORE.id,
    employeeId: DEV_EMPLOYEES[0].id,
    shiftKey: 'main',
    cash: 10000,
    acquiring: 14000,
    qr: 2400,
    receipts: 20,
    itemsSold: 50,
    upsellReceipts: 6,
    treatsRevenue: 1200,
    treatsReceipts: 4,
  };

  await service.createShift({ ...baseShift, shiftDate: '2026-05-10' }, OWNER);
  await service.createShift({ ...baseShift, shiftDate: '2026-06-10', cash: 8000, acquiring: 11200, qr: 1920 }, OWNER);
  await service.createShift({ ...baseShift, shiftDate: '2026-07-10', cash: 12000, acquiring: 16800, qr: 2880 }, OWNER);
  await service.createShift({ ...baseShift, shiftDate: '2026-08-10', cash: 6000, acquiring: 8400, qr: 1440 }, OWNER);

  const summary = await service.getYearSummary({ storeId: DEV_STORE.id, year: 2026 });
  const completedRevenues = summary.months
    .filter(m => m.month <= 7 && m.dataStatus !== 'NO_DATA')
    .map(m => m.revenue);

  assert.equal(summary.bests.revenue.month, 7);
  assert.equal(summary.worsts.revenue.month, 6);
  assert.ok(!completedRevenues.includes(summary.bests.revenue.revenue) || summary.bests.revenue.month !== 8);

  assert.ok(summary.ytdCompleted.revenue > 0);
  assert.ok(summary.currentMonthSummary);
  assert.equal(summary.currentMonthSummary.month, 8);
  assert.equal(
    summary.ytdCompleted.revenue + summary.currentMonthSummary.revenue,
    summary.ytd.revenue
  );
});
