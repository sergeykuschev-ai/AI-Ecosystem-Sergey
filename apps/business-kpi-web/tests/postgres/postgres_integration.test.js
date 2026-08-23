'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client, Pool } = require('pg');

const {
  MISKA_AUGUST_2026_SETTINGS,
} = require('../../../../agents/business-kpi/rules/reference_settings');
const {
  DEV_EMPLOYEES,
  DEV_STORE,
} = require('../../storage/in_memory_business_kpi_store');
const { runMigrations } = require('../../storage/migration_runner');
const { parseWorkbook } = require('../../xlsx/ooxml_workbook');
const { makeXlsx } = require('../xlsx_fixture');
const { requirePostgresTestEnvironment } = require('./postgres_test_guard');

const config = requirePostgresTestEnvironment();
const OWNER_HEADERS = {
  'x-business-kpi-actor-id': 'postgres-integration-owner',
  'x-business-kpi-role': 'OWNER',
};
const REAL_EMPLOYEE_NAMES = new Set([
  'Горбунова', 'Капитанова', 'Кущев', 'Чередниченко',
]);
const REAL_EMPLOYEES = DEV_EMPLOYEES.filter(employee =>
  REAL_EMPLOYEE_NAMES.has(employee.displayName)
);
const REAL_FILES = [
  ['KPI_магазин05.26.xlsx', 5, 739091.2, 727, 31],
  ['KPI_Миска_06.26_премия_смены_исправлены (2).xlsx', 6, 736517.85, 715, 30],
  ['KPI_Миска_07.2026_понятный_дашборд (7).xlsx', 7, 794937.1, 735, 31],
  ['KPI_Миска_08.2026_ИТОГ_FIXED_v2 (3)_BACKUP_before_final_items_fix_2026-08-13 (4).xlsx', 8, 593037.6, 437, 22],
];

function employee(name) {
  return REAL_EMPLOYEES.find(item => item.displayName === name);
}

async function api(route, options = {}, expectedStatus = 200) {
  const response = await fetch(`${config.baseUrl}${route}`, {
    ...options,
    headers: { ...OWNER_HEADERS, ...(options.headers || {}) },
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  assert.equal(
    response.status,
    expectedStatus,
    `Unexpected ${response.status} for ${route}: ${Buffer.isBuffer(body) ? '<binary>' : JSON.stringify(body)}`
  );
  return { response, body };
}

async function apiJson(route, options = {}, expectedStatus = 200) {
  const result = await api(route, options, expectedStatus);
  return result.body.data;
}

async function resetAndMigrate() {
  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    const current = await client.query('SELECT current_database() AS name');
    assert.equal(current.rows[0].name, config.databaseName);
    await client.query('DROP SCHEMA IF EXISTS business_kpi CASCADE');
  } finally {
    await client.end();
  }
  const first = await runMigrations({
    databaseUrl: config.databaseUrl,
    env: { NODE_ENV: 'test' },
  });
  assert.ok(first.totalCount >= 2);
  assert.equal(first.appliedCount, first.totalCount);
  const second = await runMigrations({
    databaseUrl: config.databaseUrl,
    env: { NODE_ENV: 'test' },
  });
  assert.equal(second.appliedCount, 0);
}

async function seedReferenceData(pool) {
  await pool.query(
    `INSERT INTO business_kpi.stores (id, code, name, timezone)
     VALUES ($1,$2,$3,$4)`,
    [DEV_STORE.id, DEV_STORE.code, DEV_STORE.name, DEV_STORE.timezone]
  );
  for (const item of REAL_EMPLOYEES) {
    await pool.query(
      `INSERT INTO business_kpi.employees
       (id, store_id, employee_code, display_name)
       VALUES ($1,$2,$3,$4)`,
      [item.id, item.storeId, item.employeeCode, item.displayName]
    );
  }
  await pool.query(
    `INSERT INTO business_kpi.kpi_settings
     (id, store_id, version, effective_from, settings_json, source)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    ['30000000-0000-4000-8000-000000000001', DEV_STORE.id, 1,
      MISKA_AUGUST_2026_SETTINGS.effectiveFrom,
      MISKA_AUGUST_2026_SETTINGS,
      MISKA_AUGUST_2026_SETTINGS.source]
  );
  for (const [month, revenuePlan] of [[5, 750200], [6, 750000], [7, 745000], [8, 745000]]) {
    await pool.query(
      `INSERT INTO business_kpi.monthly_plans
       (store_id, plan_year, plan_month, revenue_plan, source)
       VALUES ($1,2026,$2,$3,'issue_25_control')`,
      [DEV_STORE.id, month, revenuePlan]
    );
  }
}

async function verifySchema(pool) {
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='business_kpi' ORDER BY table_name`
  );
  for (const required of [
    'audit_log', 'employees', 'import_runs', 'kpi_settings', 'monthly_plans',
    'schema_migrations', 'shifts', 'stores',
  ]) {
    assert.ok(tables.rows.some(row => row.table_name === required), required);
  }
  const indexes = await pool.query(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname='business_kpi'`
  );
  assert.match(
    indexes.rows.find(row => row.indexname === 'business_kpi_active_shift_identity').indexdef,
    /WHERE \(archived_at IS NULL\)/
  );
  assert.match(
    indexes.rows.find(row => row.indexname === 'business_kpi_import_source_once').indexdef,
    /status = 'COMPLETED'/
  );
  const triggers = await pool.query(
    `SELECT trigger_name FROM information_schema.triggers
     WHERE event_object_schema='business_kpi' AND event_object_table='audit_log'`
  );
  assert.deepEqual(
    new Set(triggers.rows.map(row => row.trigger_name)),
    new Set(['business_kpi_audit_no_update', 'business_kpi_audit_no_delete'])
  );
}

async function createManual(input, expectedStatus = 201) {
  return apiJson('/api/business-kpi/shifts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, expectedStatus);
}

async function importRealWorkbooks() {
  assert.ok(config.xlsxRoot, 'BUSINESS_KPI_REAL_XLSX_ROOT is required');
  for (const [fileName, month, revenue, receipts, shifts] of REAL_FILES) {
    const filePath = path.join(config.xlsxRoot, fileName);
    assert.ok(fs.existsSync(filePath), `Missing read-only XLSX input: ${fileName}`);
    const form = new FormData();
    form.append('storeId', DEV_STORE.id);
    form.append('file', new Blob([fs.readFileSync(filePath)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }), fileName);
    const dryRun = await apiJson('/api/business-kpi/imports/dry-run', {
      method: 'POST',
      body: form,
    }, 201);
    assert.equal(dryRun.errorsCount, 0);
    assert.equal(dryRun.rowsRead, shifts);
    assert.equal(dryRun.report.reconciliation.status, 'PASS');
    const completed = await apiJson(
      `/api/business-kpi/imports/${dryRun.id}/commit`,
      { method: 'POST' }
    );
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.reconciliationStatus, 'PASS');
    const dashboard = await apiJson(
      `/api/business-kpi/dashboard?store=${DEV_STORE.id}&year=2026&month=${month}`
    );
    assert.equal(dashboard.month.revenue, revenue);
    assert.equal(dashboard.month.receipts, receipts);
    assert.equal(dashboard.month.shiftsCount, shifts);
    assert.equal(
      dashboard.month.averageCheck,
      revenue / receipts
    );
    assert.equal(
      dashboard.month.paymentBreakdownAvailable,
      month === 8
    );
    assert.equal(dashboard.month.plan, [750200, 750000, 745000, 745000][month - 5]);
    assert.equal(
      dashboard.month.planCompletion,
      revenue / [750200, 750000, 745000, 745000][month - 5]
    );
    assert.equal(dashboard.month.itemsSold, null);
    assert.equal(dashboard.month.itemsPerReceipt, null);
    assert.equal(dashboard.month.qr, month === 8 ? 166519.8 : null);
    const sellers = await apiJson(
      `/api/business-kpi/sellers?store=${DEV_STORE.id}&year=2026&month=${month}`
    );
    assert.equal(
      sellers.items.reduce(
        (sum, item) => sum + Math.round(item.revenue * 100),
        0
      ),
      Math.round(revenue * 100)
    );
    assert.equal(
      sellers.items.reduce((sum, item) => sum + item.receipts, 0),
      receipts
    );

    const duplicateForm = new FormData();
    duplicateForm.append('storeId', DEV_STORE.id);
    duplicateForm.append('file', new Blob([fs.readFileSync(filePath)]), fileName);
    const duplicate = await apiJson('/api/business-kpi/imports/dry-run', {
      method: 'POST',
      body: duplicateForm,
    }, 201);
    assert.equal(duplicate.resultCode, 'DUPLICATE_IMPORT');
  }
}

async function verifyPersistedMonths(pool) {
  for (const [, month, revenue, receipts, shifts] of REAL_FILES) {
    const dashboard = await apiJson(
      `/api/business-kpi/dashboard?store=${DEV_STORE.id}&year=2026&month=${month}`
    );
    assert.equal(dashboard.month.revenue, revenue);
    assert.equal(dashboard.month.receipts, receipts);
    assert.equal(dashboard.month.shiftsCount, shifts);
    const period = `${String(month).padStart(2, '0')}`;
    const exact = await pool.query(
      `SELECT
         sum(CASE WHEN revenue_source='historical_total'
           THEN historical_revenue ELSE cash_amount + acquiring_amount END)::text AS revenue,
         sum(receipts)::text AS receipts,
         min(to_char(shift_date, 'YYYY-MM-DD')) AS first_date,
         max(to_char(shift_date, 'YYYY-MM-DD')) AS last_date
       FROM business_kpi.shifts
       WHERE store_id=$1
         AND shift_date >= $2::date
         AND shift_date < ($2::date + interval '1 month')
         AND archived_at IS NULL`,
      [DEV_STORE.id, `2026-${period}-01`]
    );
    assert.equal(exact.rows[0].revenue, revenue.toFixed(2));
    assert.equal(exact.rows[0].receipts, String(receipts));
    assert.match(exact.rows[0].first_date, new RegExp(`^2026-${period}-`));
    assert.match(exact.rows[0].last_date, new RegExp(`^2026-${period}-`));
  }
  const exact = await pool.query(
    `SELECT
       COALESCE(sum(CASE WHEN revenue_source='historical_total'
         THEN historical_revenue ELSE cash_amount + acquiring_amount END),0)::text AS revenue,
       sum(receipts)::text AS receipts,
       COALESCE(sum(qr_amount),0)::text AS qr
     FROM business_kpi.shifts
     WHERE store_id=$1 AND shift_date >= '2026-08-01' AND shift_date < '2026-09-01'
       AND archived_at IS NULL`,
    [DEV_STORE.id]
  );
  assert.equal(exact.rows[0].revenue, '593037.60');
  assert.equal(exact.rows[0].receipts, '437');
  assert.equal(exact.rows[0].qr, '166519.80');
}

async function runFull(pool) {
  await resetAndMigrate();
  await verifySchema(pool);
  await seedReferenceData(pool);

  const health = await apiJson('/health');
  assert.equal(health.storage.provider, 'postgresql');
  assert.equal(health.storage.configured, true);
  assert.equal(health.storage.checked, true);
  assert.equal(health.storage.healthy, true);

  const precision = await pool.query(
    `SELECT
       (0.01::numeric(14,2) + 10.10::numeric(14,2))::text AS cents,
       999999999999.99::numeric(14,2)::text AS large,
       to_char($1::date, 'YYYY-MM-DD') AS local_date`,
    ['2026-08-10']
  );
  assert.deepEqual(precision.rows[0], {
    cents: '10.11', large: '999999999999.99', local_date: '2026-08-10',
  });

  const manualInput = {
    storeId: DEV_STORE.id,
    employeeId: employee('Горбунова').id,
    shiftDate: '2026-09-10',
    shiftKey: 'main',
    cash: 0.01,
    acquiring: 10.10,
    qr: 0.01,
    receipts: 1,
    itemsSold: 2,
    upsellReceipts: 1,
    treatsRevenue: 0.01,
    treatsReceipts: 1,
    comment: 'PostgreSQL manual create',
  };
  const manual = await createManual(manualInput);
  assert.equal(manual.metrics.revenue, 10.11);
  await createManual(manualInput, 409);
  const updated = await apiJson(`/api/business-kpi/shifts/${manual.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cash: 10.01, receipts: 2, itemsSold: 5, comment: 'PostgreSQL PATCH' }),
  });
  assert.equal(updated.metrics.revenue, 20.11);
  assert.equal(updated.metrics.averageCheck, 10.055);
  assert.equal(updated.metrics.itemsPerReceipt, 2.5);
  await apiJson(`/api/business-kpi/shifts/${manual.id}`, { method: 'DELETE' });
  const archived = await apiJson(`/api/business-kpi/shifts/${manual.id}`);
  assert.ok(archived.archivedAt);
  assert.deepEqual(
    archived.audit.map(item => item.action),
    ['SHIFT_CREATED', 'SHIFT_UPDATED', 'SHIFT_ARCHIVED']
  );
  const auditId = archived.audit[0].id;
  await assert.rejects(
    pool.query(`UPDATE business_kpi.audit_log SET reason='mutated' WHERE id=$1`, [auditId]),
    /append-only/
  );
  await assert.rejects(
    pool.query('DELETE FROM business_kpi.audit_log WHERE id=$1', [auditId]),
    /append-only/
  );

  await importRealWorkbooks();
  await verifyPersistedMonths(pool);

  const julyExport = await api(
    `/api/business-kpi/export?store=${DEV_STORE.id}&year=2026&month=7`
  );
  assert.match(julyExport.response.headers.get('content-type'), /spreadsheetml/);
  assert.deepEqual(
    parseWorkbook(julyExport.body).sheets.map(sheet => sheet.name),
    ['Shifts', 'Summary']
  );

  const rollbackBook = makeXlsx([{ name: 'KPI_Контроль', rows: [
    ['Дата', 'Продавец', 'Выручка ₽', 'Количество чеков'],
    ['01.09.2026', 'Горбунова', 100, 1],
    ['02.09.2026', 'Чередниченко', 200, 2],
  ] }]);
  const rollbackForm = new FormData();
  rollbackForm.append('storeId', DEV_STORE.id);
  rollbackForm.append('file', new Blob([rollbackBook]), 'rollback.xlsx');
  const rollbackRun = await apiJson('/api/business-kpi/imports/dry-run', {
    method: 'POST', body: rollbackForm,
  }, 201);
  const conflict = await createManual({
    ...manualInput,
    employeeId: employee('Чередниченко').id,
    shiftDate: '2026-09-02',
    cash: 100,
    acquiring: 100,
    qr: 20,
    receipts: 2,
    itemsSold: 4,
    upsellReceipts: 1,
    treatsRevenue: 10,
    treatsReceipts: 1,
    comment: 'Rollback conflict',
  });
  await api(
    `/api/business-kpi/imports/${rollbackRun.id}/commit`,
    { method: 'POST' },
    409
  );
  const rollbackRows = await apiJson(
    `/api/business-kpi/shifts?store=${DEV_STORE.id}&date_from=2026-09-01&date_to=2026-09-02`
  );
  assert.equal(rollbackRows.items.some(row => row.shiftDate === '2026-09-01'), false);
  assert.equal(rollbackRows.items.filter(row => row.shiftDate === '2026-09-02').length, 1);
  const runs = await apiJson(`/api/business-kpi/imports?store=${DEV_STORE.id}`);
  assert.equal(runs.items.find(run => run.id === rollbackRun.id).status, 'FAILED');
  await apiJson(`/api/business-kpi/shifts/${conflict.id}`, { method: 'DELETE' });

  const probe = await createManual({
    ...manualInput,
    shiftDate: '2026-09-30',
    shiftKey: 'evening',
    cash: 12000,
    acquiring: 12000,
    qr: 2400,
    receipts: 20,
    itemsSold: 50,
    upsellReceipts: 6,
    treatsRevenue: 1200,
    treatsReceipts: 4,
    comment: 'POSTGRES_PERSISTENCE_PROBE',
  });
  assert.equal(probe.metrics.revenue, 24000);
}

async function verifyPersistence(pool) {
  const health = await apiJson('/health');
  assert.equal(health.storage.provider, 'postgresql');
  assert.equal(health.storage.checked, true);
  assert.equal(health.storage.healthy, true);
  await verifyPersistedMonths(pool);
  const rows = await apiJson(
    `/api/business-kpi/shifts?store=${DEV_STORE.id}&year=2026&month=9`
  );
  const probe = rows.items.find(row => row.comment === 'POSTGRES_PERSISTENCE_PROBE');
  assert.ok(probe, 'Persistence probe was lost after container restart');
  const runs = await apiJson(`/api/business-kpi/imports?store=${DEV_STORE.id}`);
  assert.equal(runs.items.filter(run => run.status === 'COMPLETED').length, 4);
  const persistedExport = await api(
    `/api/business-kpi/export?store=${DEV_STORE.id}&year=2026&month=8`
  );
  assert.deepEqual(
    parseWorkbook(persistedExport.body).sheets.map(sheet => sheet.name),
    ['Shifts', 'Summary']
  );
  await apiJson(`/api/business-kpi/shifts/${probe.id}`, { method: 'DELETE' });
  const archived = await apiJson(`/api/business-kpi/shifts/${probe.id}`);
  assert.ok(archived.audit.some(item => item.action === 'SHIFT_ARCHIVED'));
}

test(`Business KPI PostgreSQL integration phase: ${config.phase}`, async () => {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    application_name: 'business-kpi-postgres-integration',
    max: 4,
  });
  try {
    const current = await pool.query('SELECT current_database() AS name');
    assert.equal(current.rows[0].name, config.databaseName);
    if (config.phase === 'full') await runFull(pool);
    else await verifyPersistence(pool);
  } finally {
    await pool.end();
  }
});
