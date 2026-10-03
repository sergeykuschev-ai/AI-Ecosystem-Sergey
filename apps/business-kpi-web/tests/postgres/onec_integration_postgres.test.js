'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { after, before, test } = require('node:test');
const { Pool } = require('pg');

const { loadConfig } = require('../../config');
const { createBusinessKpiWebServer } = require('../../server');
const { requirePostgresTestEnvironment } = require('./postgres_test_guard');

const postgres = requirePostgresTestEnvironment();
const KEY = 'onec-postgres-e2e-key';
let server;
let baseUrl;
let pool;

function batch(batchId, overrides = {}) {
  return {
    contractVersion: '1.0',
    sourceInstance: 'amursk-ut11-postgres-e2e',
    batchId,
    records: [{
      recordId: 'amper:2026-10-07',
      storeCode: 'amper',
      businessDate: '2026-10-07',
      sourceUpdatedAt: '2026-10-07T19:00:00+10:00',
      cash: 12345.67,
      acquiring: 23456.78,
      qr: 4567.89,
      b2b: 5000,
      b2bOrders: 1,
      receipts: 31,
      itemsSold: 72,
      returnsAmount: 700,
      returnReceipts: 1,
      ...overrides,
    }],
  };
}
async function post(payload) {
  const response = await fetch(`${baseUrl}/api/integration/1c/v1/daily-sales`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': payload.batchId,
    },
    body: JSON.stringify(payload),
  });
  return { response, body: await response.json() };
}

async function postShadow(payload) {
  const response = await fetch(`${baseUrl}/api/integration/1c/v1/daily-sales/shadow`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': payload.batchId,
    },
    body: JSON.stringify(payload),
  });
  return { response, body: await response.json() };
}

before(async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    BUSINESS_KPI_STORAGE_MODE: 'postgresql',
    BUSINESS_KPI_DATABASE_URL: postgres.databaseUrl,
    BUSINESS_KPI_SERVICE_KEYS: JSON.stringify([{
      id: 'onec-postgres-e2e',
      key: KEY,
      scopes: ['onec:read', 'onec:write'],
    }]),
  });
  server = createBusinessKpiWebServer({ config });
  await server.businessKpiStore.checkHealth();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  pool = new Pool({ connectionString: postgres.databaseUrl });
});

after(async () => {
  server.close();
  await once(server, 'close');
  await server.businessKpiStore.close();
  await pool.end();
});
test('1C HTTP ingest persists raw record, audit and KPI shift in PostgreSQL', async () => {
  const payload = batch(`pg-e2e-${Date.now()}`);
  const { response, body } = await post(payload);
  assert.equal(response.status, 201, body.error?.message);
  assert.equal(body.data.recordsApplied, 1);
  assert.equal(body.data.records[0].status, 'created');

  const shiftId = body.data.records[0].shiftId;
  const shift = await pool.query(
    `SELECT source, source_ref, cash_amount, acquiring_amount, qr_amount,
            b2b_amount, receipts, items_sold, source_reference_json
     FROM business_kpi.shifts WHERE id = $1`,
    [shiftId]
  );
  assert.equal(shift.rowCount, 1);
  assert.equal(shift.rows[0].source, '1c');
  assert.equal(Number(shift.rows[0].cash_amount), 12345.67);
  assert.equal(Number(shift.rows[0].acquiring_amount), 23456.78);
  assert.equal(Number(shift.rows[0].qr_amount), 4567.89);
  assert.equal(Number(shift.rows[0].b2b_amount), 5000);
  assert.equal(Number(shift.rows[0].receipts), 31);
  assert.equal(Number(shift.rows[0].items_sold), 72);
  assert.equal(Number(shift.rows[0].source_reference_json.returnsAmount), 700);

  const raw = await pool.query(
    `SELECT returns_amount, return_receipts, payload_sha256, applied_shift_id
     FROM business_kpi.onec_daily_sales
     WHERE source_instance=$1 AND external_record_id=$2`,
    [payload.sourceInstance, payload.records[0].recordId]
  );
  assert.equal(raw.rowCount, 1);
  assert.equal(Number(raw.rows[0].returns_amount), 700);
  assert.equal(Number(raw.rows[0].return_receipts), 1);
  assert.equal(raw.rows[0].applied_shift_id, shiftId);
  assert.equal(raw.rows[0].payload_sha256.length, 64);

  const audit = await pool.query(
    `SELECT actor_type, action, source FROM business_kpi.audit_log
     WHERE entity_id=$1 ORDER BY occurred_at DESC LIMIT 1`,
    [shiftId]
  );
  assert.equal(audit.rows[0].actor_type, 'future_1c');
  assert.equal(audit.rows[0].action, 'SHIFT_ONEC_CREATED');
  assert.equal(audit.rows[0].source, '1c');
});
test('shadow ingest persists 1C facts without changing a manual PostgreSQL shift', async () => {
  const shiftId = '71000000-0000-4000-8000-000000000001';
  const now = new Date().toISOString();
  await server.businessKpiStore.createShift({
    id: shiftId,
    storeId: '10000000-0000-4000-8000-000000000002',
    employeeId: '20000000-0000-4000-8000-000000000101',
    employeeName: 'Ампер · магазин',
    shiftDate: '2026-10-09',
    shiftKey: 'main',
    cash: 12345.67,
    acquiring: 23456.78,
    qr: 4567.89,
    b2b: 5000,
    b2bOrders: 1,
    receipts: 31,
    itemsSold: 72,
    upsellReceipts: null,
    treatsRevenue: null,
    treatsReceipts: null,
    comment: null,
    source: 'web_manual',
    sourceRef: null,
    createdAt: now,
    updatedAt: now,
    importRunId: null,
    historicalRevenue: null,
    revenueSource: 'payment_breakdown',
    paymentBreakdownAvailable: true,
    sourceReference: null,
    originalImportedInput: null,
  });

  const payload = batch(`pg-shadow-${Date.now()}`, {
    recordId: 'amper:2026-10-09',
    businessDate: '2026-10-09',
    sourceUpdatedAt: '2026-10-09T19:00:00+10:00',
  });
  const { response, body } = await postShadow(payload);
  assert.equal(response.status, 201, body.error?.message);
  assert.equal(body.data.mode, 'shadow');
  assert.equal(body.data.recordsApplied, 0);
  assert.equal(body.data.records[0].status, 'matched_manual');

  const manual = await pool.query(
    'SELECT cash_amount, source FROM business_kpi.shifts WHERE id=$1',
    [shiftId]
  );
  assert.equal(Number(manual.rows[0].cash_amount), 12345.67);
  assert.equal(manual.rows[0].source, 'web_manual');

  const raw = await pool.query(
    `SELECT applied_shift_id, cash_amount
     FROM business_kpi.onec_daily_sales
     WHERE source_instance=$1 AND external_record_id=$2`,
    [payload.sourceInstance, payload.records[0].recordId]
  );
  assert.equal(raw.rowCount, 1);
  assert.equal(raw.rows[0].applied_shift_id, null);
  assert.equal(Number(raw.rows[0].cash_amount), 12345.67);
});

test('PostgreSQL path keeps failed batches atomic and records diagnostics', async () => {
  const payload = batch(`pg-fail-${Date.now()}`, {
    recordId: `unknown:${Date.now()}`,
    storeCode: 'not-configured',
    businessDate: '2026-10-08',
    sourceUpdatedAt: '2026-10-08T19:00:00+10:00',
  });
  const { response, body } = await post(payload);
  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'ONEC_STORE_MAPPING_MISSING');

  const completed = await pool.query(
    'SELECT count(*)::int AS count FROM business_kpi.onec_sync_batches WHERE idempotency_key=$1',
    [payload.batchId]
  );
  assert.equal(completed.rows[0].count, 0);

  const failure = await pool.query(
    `SELECT error_code, payload_sha256
     FROM business_kpi.onec_sync_failures
     WHERE idempotency_key=$1 ORDER BY failed_at DESC LIMIT 1`,
    [payload.batchId]
  );
  assert.equal(failure.rowCount, 1);
  assert.equal(failure.rows[0].error_code, 'ONEC_STORE_MAPPING_MISSING');
  assert.equal(failure.rows[0].payload_sha256.length, 64);
});
