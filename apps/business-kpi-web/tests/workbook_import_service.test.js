'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { BusinessKpiService } = require('../application/business_kpi_service');
const {
  WorkbookImportService,
  settingsEqual,
} = require('../application/workbook_import_service');
const {
  MISKA_AUGUST_2026_SETTINGS,
} = require('../../../agents/business-kpi/rules/reference_settings');
const { DEV_STORE, InMemoryBusinessKpiStore } = require('../storage/in_memory_business_kpi_store');
const { parseWorkbook } = require('../xlsx/ooxml_workbook');
const { makeXlsx } = require('./xlsx_fixture');

const OWNER = Object.freeze({ id: 'import-owner', role: 'OWNER' });

function fixture() {
  const store = new InMemoryBusinessKpiStore();
  const businessKpiService = new BusinessKpiService({ store });
  const importService = new WorkbookImportService({ store, businessKpiService });
  return { store, businessKpiService, importService };
}

function historicalWorkbook(revenue = 300) {
  return makeXlsx([{ name: 'KPI_Контроль', rows: [
    ['Дата', 'Продавец', 'Выручка ₽', 'Количество чеков', 'Товаров в чеке'],
    ['01.09.2026', 'Горбунова', revenue, 2, 2.5],
    ['02.09.2026', 'Чередниченко', 200, 3, 2.1],
  ] }]);
}

function reorderNestedObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reorderNestedObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).reverse().map(([key, nested]) => [
      key,
      reorderNestedObjectKeys(nested),
    ])
  );
}

test('settings equality ignores nested object key order but preserves array order', () => {
  const reordered = reorderNestedObjectKeys(MISKA_AUGUST_2026_SETTINGS);
  reordered.source = 'jsonb-roundtrip-metadata';
  reordered.version = 999;
  assert.equal(settingsEqual(MISKA_AUGUST_2026_SETTINGS, reordered), true);

  const reorderedLevels = structuredClone(reordered);
  reorderedLevels.levels.reverse();
  assert.equal(settingsEqual(MISKA_AUGUST_2026_SETTINGS, reorderedLevels), false);
});

test('XLSX dry-run, atomic commit, dashboard, duplicate no-op, and export form one flow', async () => {
  const { store, businessKpiService, importService } = fixture();
  const buffer = historicalWorkbook();
  const dryRun = await importService.dryRun({
    filename: 'september.xlsx', buffer, storeId: DEV_STORE.id,
  }, OWNER);
  assert.equal(dryRun.status, 'VALIDATING');
  assert.equal(dryRun.rowsRead, 2);
  assert.equal(store.shifts.length, 0);
  assert.equal(dryRun.report.paymentBreakdownAvailable, false);

  const completed = await importService.commit(dryRun.id, OWNER);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.rowsImported, 2);
  assert.equal(store.shifts.length, 2);
  const dashboard = await businessKpiService.getDashboard({
    storeId: DEV_STORE.id, year: 2026, month: 9,
  });
  assert.equal(dashboard.month.revenue, 500);
  assert.equal(dashboard.month.receipts, 5);
  assert.equal(dashboard.month.averageCheck, 100);
  assert.equal(dashboard.month.qrShare, null);
  assert.equal(dashboard.settingsStatus, 'CONFIRMED');

  const firstShift = store.shifts[0];
  const overridden = await businessKpiService.updateShift(
    firstShift.id,
    { comment: 'Проверено владельцем' },
    OWNER
  );
  assert.equal(overridden.source, 'excel_import');
  assert.equal(overridden.historicalRevenue, firstShift.historicalRevenue);
  assert.equal(overridden.originalImportedInput.historicalRevenue, firstShift.historicalRevenue);
  assert.equal(overridden.override.source, 'web_manual');
  assert.equal(store.audit.at(-1).action, 'SHIFT_UPDATED');

  const duplicate = await importService.dryRun({
    filename: 'renamed.xlsx', buffer, storeId: DEV_STORE.id,
  }, OWNER);
  assert.equal(duplicate.resultCode, 'DUPLICATE_IMPORT');
  assert.equal(store.shifts.length, 2);

  const exported = await businessKpiService.exportMonth({
    storeId: DEV_STORE.id, year: 2026, month: 9,
  });
  const workbook = parseWorkbook(exported);
  assert.deepEqual(workbook.sheets.map(sheet => sheet.name), ['Shifts', 'Summary']);
  assert.match(workbook.sheets[0].rows[0].join('|'), /Revenue source/);
});

test('modified workbook reports canonical identity conflict before commit', async () => {
  const { importService } = fixture();
  const first = await importService.dryRun({
    filename: 'one.xlsx', buffer: historicalWorkbook(), storeId: DEV_STORE.id,
  }, OWNER);
  await importService.commit(first.id, OWNER);
  const changed = await importService.dryRun({
    filename: 'changed.xlsx', buffer: historicalWorkbook(301), storeId: DEV_STORE.id,
  }, OWNER);
  assert.ok(changed.report.errors.some(item => item.code === 'EXISTING_SHIFT_CONFLICT'));
  await assert.rejects(() => importService.commit(changed.id, OWNER), error => error.code === 'IMPORT_NOT_READY');
});

test('critical conflict rolls every shift back and preserves FAILED validation report', async () => {
  const { store, importService } = fixture();
  const dryRun = await importService.dryRun({
    filename: 'rollback.xlsx', buffer: historicalWorkbook(), storeId: DEV_STORE.id,
  }, OWNER);
  const storedRun = await store.getImportRun(dryRun.id);
  const corrupted = structuredClone(storedRun.canonicalRows);
  corrupted[1] = { ...corrupted[0] };
  await store.updateImportRun(dryRun.id, { canonicalRows: corrupted });
  await assert.rejects(() => importService.commit(dryRun.id, OWNER), /атомарный импорт отменён/);
  assert.equal(store.shifts.length, 0);
  const failed = await store.getImportRun(dryRun.id);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.rowsImported, 0);
  assert.ok(failed.report.errors.length > 0);
});

const realRoot = process.env.BUSINESS_KPI_REAL_XLSX_ROOT;
const realFiles = [
  ['KPI_магазин05.26.xlsx', 5, 739091.2, 727],
  ['KPI_Миска_06.26_премия_смены_исправлены (2).xlsx', 6, 736517.85, 715],
  ['KPI_Миска_07.2026_понятный_дашборд (7).xlsx', 7, 794937.1, 735],
  ['KPI_Миска_08.2026_ИТОГ_FIXED_v2 (3)_BACKUP_before_final_items_fix_2026-08-13 (4).xlsx', 8, 593037.6, 437],
];

test('real May-August workbooks reconcile through dry-run and commit', {
  skip: !realRoot || realFiles.some(([name]) => !fs.existsSync(path.join(realRoot, name))),
}, async () => {
  const { store, businessKpiService, importService } = fixture();
  store.settings = [];
  for (const [name, month, expectedRevenue, expectedReceipts] of realFiles) {
    const dryRun = await importService.dryRun({
      filename: name,
      buffer: fs.readFileSync(path.join(realRoot, name)),
      storeId: DEV_STORE.id,
    }, OWNER);
    assert.equal(dryRun.errorsCount, 0);
    assert.equal(dryRun.report.reconciliation.status, 'PASS');
    assert.equal(
      dryRun.report.settings.status,
      month === 8 ? 'CONFIRMED' : 'PARTIAL'
    );
    assert.equal(
      dryRun.report.settings.action,
      month === 8 ? 'CREATE_EFFECTIVE_VERSION' : 'UNRESOLVED'
    );
    const completed = await importService.commit(dryRun.id, OWNER);
    assert.equal(completed.reconciliationStatus, 'PASS');
    const dashboard = await businessKpiService.getDashboard({
      storeId: DEV_STORE.id, year: 2026, month,
    });
    assert.equal(dashboard.month.revenue, expectedRevenue);
    assert.equal(dashboard.month.receipts, expectedReceipts);
    assert.equal(dashboard.settingsStatus, month === 8 ? 'CONFIRMED' : 'UNRESOLVED');
  }
  const augustSettings = await store.getEffectiveSettings(DEV_STORE.id, '2026-08-01');
  assert.equal(augustSettings.version, 202608);
  assert.equal(augustSettings.settings.source.startsWith('excel_import:'), true);
});
