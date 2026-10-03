'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { after, before, test } = require('node:test');

const { BusinessKpiService } = require('../application/business_kpi_service');
const { createBusinessKpiWebServer } = require('../server');
const { loadConfig } = require('../config');

let server;
let baseUrl;
let store;

const WRITE_KEY = 'onec-test-write-key';
const READ_KEY = 'onec-test-read-key';
const writeHeaders = {
  Authorization: `Bearer ${WRITE_KEY}`,
  'Content-Type': 'application/json',
};
const readHeaders = { Authorization: `Bearer ${READ_KEY}` };

function makeBatch(batchId, recordOverrides = {}) {
  return {
    contractVersion: '1.0',
    sourceInstance: 'amursk-ut11-test',
    batchId,
    records: [{
      recordId: 'amper:2026-10-03',
      storeCode: 'amper',
      businessDate: '2026-10-03',
      sourceUpdatedAt: '2026-10-03T09:00:00+10:00',
      cash: 10000,
      acquiring: 20000,
      qr: 5000,
      b2b: 3000,
      b2bOrders: 1,
      receipts: 20,
      itemsSold: 50,
      returnsAmount: 500,
      returnReceipts: 1,
      ...recordOverrides,
    }],
  };
}
async function postBatch(batch, headers = writeHeaders) {
  const response = await fetch(`${baseUrl}/api/integration/1c/v1/daily-sales`, {
    method: 'POST',
    headers: { ...headers, 'X-Idempotency-Key': batch.batchId },
    body: JSON.stringify(batch),
  });
  return { response, body: await response.json() };
}

async function postShadowBatch(batch, headers = writeHeaders) {
  const response = await fetch(`${baseUrl}/api/integration/1c/v1/daily-sales/shadow`, {
    method: 'POST',
    headers: { ...headers, 'X-Idempotency-Key': batch.batchId },
    body: JSON.stringify(batch),
  });
  return { response, body: await response.json() };
}

before(async () => {
  const config = loadConfig({
    BUSINESS_KPI_SERVICE_KEYS: JSON.stringify([
      {
        id: 'onec-writer',
        name: '1C test writer',
        key: WRITE_KEY,
        scopes: ['onec:read', 'onec:write'],
      },
      {
        id: 'onec-reader',
        name: '1C test reader',
        key: READ_KEY,
        scopes: ['onec:read'],
      },
    ]),
  });
  server = createBusinessKpiWebServer({ config });
  store = server.businessKpiStore;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await once(server, 'close');
});

test('1C endpoints require a scoped service key', async () => {
  const anonymous = await fetch(`${baseUrl}/api/integration/1c/v1/ping`);
  assert.equal(anonymous.status, 401);

  const ping = await fetch(`${baseUrl}/api/integration/1c/v1/ping`, {
    headers: readHeaders,
  });
  const pingBody = await ping.json();
  assert.equal(ping.status, 200);
  assert.equal(pingBody.data.contractVersion, '1.0');

  const batch = makeBatch('batch-scope-denied');
  const denied = await postBatch(batch, {
    ...readHeaders,
    'Content-Type': 'application/json',
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.error.code, 'SERVICE_SCOPE_REQUIRED');
});
test('1C daily sales create one KPI shift and preserve payment semantics', async () => {
  const batch = makeBatch('batch-create-1');
  const { response, body } = await postBatch(batch);
  assert.equal(response.status, 201, body.error?.message);
  assert.equal(body.data.recordsApplied, 1);
  assert.equal(body.data.records[0].status, 'created');

  const amper = store.stores.find(item => item.code === 'amper');
  const shifts = await store.listShifts({
    storeId: amper.id,
    dateFrom: '2026-10-03',
    dateTo: '2026-10-03',
  });
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0].source, '1c');
  assert.equal(shifts[0].cash, 10000);
  assert.equal(shifts[0].acquiring, 20000);
  assert.equal(shifts[0].qr, 5000);
  assert.equal(shifts[0].b2b, 3000);
  assert.equal(shifts[0].sourceReference.returnsAmount, 500);

  const dashboard = await fetch(
    `${baseUrl}/api/business-kpi/dashboard?store=${amper.id}&year=2026&month=10`,
    { headers: readHeaders }
  );
  const dashboardBody = await dashboard.json();
  assert.equal(dashboard.status, 200);
  assert.equal(dashboardBody.data.month.revenue, 33000);
  assert.equal(dashboardBody.data.month.retailRevenue, 30000);
  assert.equal(dashboardBody.data.month.b2bRevenue, 3000);
  assert.equal(dashboardBody.data.month.qrShare, 0.25);
});
test('1C shifts are read-only to portal users', async () => {
  const amper = store.stores.find(item => item.code === 'amper');
  const shift = (await store.listShifts({
    storeId: amper.id,
    dateFrom: '2026-10-03',
    dateTo: '2026-10-03',
  }))[0];
  const service = new BusinessKpiService({ store });
  const owner = { id: 'owner-read-only-test', role: 'OWNER' };

  await assert.rejects(
    service.updateShift(shift.id, { cash: 99999 }, owner),
    error => error.code === 'ONEC_SHIFT_READ_ONLY' && error.statusCode === 409
  );
  await assert.rejects(
    service.archiveShift(shift.id, owner),
    error => error.code === 'ONEC_SHIFT_READ_ONLY' && error.statusCode === 409
  );
});

test('repeating the same batch is a no-op', async () => {
  const batch = makeBatch('batch-create-1');
  const { response, body } = await postBatch(batch);
  assert.equal(response.status, 200);
  assert.equal(body.data.duplicateBatch, true);

  const amper = store.stores.find(item => item.code === 'amper');
  const shifts = await store.listShifts({
    storeId: amper.id,
    dateFrom: '2026-10-03',
    dateTo: '2026-10-03',
  });
  assert.equal(shifts.length, 1);
});

test('a newer 1C version updates the existing shift instead of duplicating it', async () => {
  const batch = makeBatch('batch-update-1', {
    sourceUpdatedAt: '2026-10-03T10:00:00+10:00',
    cash: 11000,
  });
  const { response, body } = await postBatch(batch);
  assert.equal(response.status, 201, body.error?.message);
  assert.equal(body.data.records[0].status, 'updated');

  const amper = store.stores.find(item => item.code === 'amper');
  const shifts = await store.listShifts({
    storeId: amper.id,
    dateFrom: '2026-10-03',
    dateTo: '2026-10-03',
  });
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0].cash, 11000);
});

test('an older changed 1C record is rejected and leaves the accepted value intact', async () => {
  const batch = makeBatch('batch-stale-1', {
    sourceUpdatedAt: '2026-10-03T09:30:00+10:00',
    cash: 9000,
  });
  const { response, body } = await postBatch(batch);
  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'ONEC_STALE_RECORD');

  const amper = store.stores.find(item => item.code === 'amper');
  const shift = (await store.listShifts({
    storeId: amper.id,
    dateFrom: '2026-10-03',
    dateTo: '2026-10-03',
  }))[0];
  assert.equal(shift.cash, 11000);
});
test('a manual shift is never overwritten by 1C', async () => {
  const amper = store.stores.find(item => item.code === 'amper');
  const employee = store.employees.find(item =>
    item.storeId === amper.id && item.employeeCode === 'amper-store-input'
  );
  store.shifts.push({
    id: '70000000-0000-4000-8000-000000000001',
    storeId: amper.id,
    employeeId: employee.id,
    employeeName: employee.displayName,
    shiftDate: '2026-10-04',
    shiftKey: 'main',
    cash: 100,
    acquiring: 200,
    qr: 50,
    b2b: 0,
    b2bOrders: 0,
    receipts: 1,
    itemsSold: 1,
    upsellReceipts: null,
    treatsRevenue: null,
    treatsReceipts: null,
    comment: null,
    historicalRevenue: null,
    revenueSource: 'payment_breakdown',
    paymentBreakdownAvailable: true,
    source: 'web_manual',
    sourceRef: null,
    sourceReference: null,
    archivedAt: null,
    archivedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const batch = makeBatch('batch-conflict-manual', {
    recordId: 'amper:2026-10-04',
    businessDate: '2026-10-04',
    sourceUpdatedAt: '2026-10-04T19:00:00+10:00',
  });
  const { response, body } = await postBatch(batch);
  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'ONEC_SHIFT_SOURCE_CONFLICT');
});
test('shadow mode compares 1C with manual KPI without changing shifts', async () => {
  const amper = store.stores.find(item => item.code === 'amper');
  const employee = store.employees.find(item =>
    item.storeId === amper.id && item.employeeCode === 'amper-store-input'
  );
  store.shifts.push({
    id: '70000000-0000-4000-8000-000000000002',
    storeId: amper.id,
    employeeId: employee.id,
    employeeName: employee.displayName,
    shiftDate: '2026-10-09',
    shiftKey: 'main',
    cash: 10000,
    acquiring: 20000,
    qr: 5000,
    b2b: 3000,
    b2bOrders: 1,
    receipts: 20,
    itemsSold: 50,
    upsellReceipts: null,
    treatsRevenue: null,
    treatsReceipts: null,
    comment: null,
    historicalRevenue: null,
    revenueSource: 'payment_breakdown',
    paymentBreakdownAvailable: true,
    source: 'web_manual',
    sourceRef: null,
    sourceReference: null,
    archivedAt: null,
    archivedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const matching = makeBatch('shadow-match-1', {
    recordId: 'amper:2026-10-09',
    businessDate: '2026-10-09',
    sourceUpdatedAt: '2026-10-09T19:00:00+10:00',
  });
  let result = await postShadowBatch(matching);
  assert.equal(result.response.status, 201, result.body.error?.message);
  assert.equal(result.body.data.mode, 'shadow');
  assert.equal(result.body.data.recordsApplied, 0);
  assert.equal(result.body.data.recordsShadowed, 1);
  assert.equal(result.body.data.records[0].status, 'matched_manual');
  assert.deepEqual(result.body.data.records[0].differences, {});

  const raw = await store.getOnecDailySalesRecord(
    matching.sourceInstance,
    matching.records[0].recordId
  );
  assert.equal(raw.appliedShiftId, null);

  const changed = makeBatch('shadow-diff-1', {
    recordId: 'amper:2026-10-09',
    businessDate: '2026-10-09',
    sourceUpdatedAt: '2026-10-09T20:00:00+10:00',
    cash: 10100,
  });
  result = await postShadowBatch(changed);
  assert.equal(result.response.status, 201, result.body.error?.message);
  assert.equal(result.body.data.records[0].status, 'differs_manual');
  assert.equal(result.body.data.records[0].differences.cash, 100);

  result = await postShadowBatch(changed);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.duplicateBatch, true);

  const applySameBatchId = await postBatch(changed);
  assert.equal(applySameBatchId.response.status, 409);
  assert.equal(applySameBatchId.body.error.code, 'ONEC_IDEMPOTENCY_CONFLICT');

  const manualShift = await store.getShift('70000000-0000-4000-8000-000000000002');
  assert.equal(manualShift.cash, 10000);
  assert.equal(manualShift.source, 'web_manual');

  const noManual = makeBatch('shadow-no-manual-1', {
    recordId: 'amper:2026-10-10',
    businessDate: '2026-10-10',
    sourceUpdatedAt: '2026-10-10T19:00:00+10:00',
  });
  result = await postShadowBatch(noManual);
  assert.equal(result.response.status, 201, result.body.error?.message);
  assert.equal(result.body.data.records[0].status, 'no_manual_record');
  const shifts = await store.listShifts({
    storeId: amper.id,
    dateFrom: '2026-10-10',
    dateTo: '2026-10-10',
  });
  assert.equal(shifts.length, 0);
});

test('a failing multi-record batch rolls back every record', async () => {
  const valid = makeBatch('batch-atomic-1', {
    recordId: 'amper:2026-10-05',
    businessDate: '2026-10-05',
    sourceUpdatedAt: '2026-10-05T19:00:00+10:00',
  }).records[0];
  const batch = {
    contractVersion: '1.0',
    sourceInstance: 'amursk-ut11-test',
    batchId: 'batch-atomic-1',
    records: [
      valid,
      {
        ...valid,
        recordId: 'unknown:2026-10-05',
        storeCode: 'unknown-store',
      },
    ],
  };
  const { response, body } = await postBatch(batch);
  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'ONEC_STORE_MAPPING_MISSING');

  const amper = store.stores.find(item => item.code === 'amper');
  const shifts = await store.listShifts({
    storeId: amper.id,
    dateFrom: '2026-10-05',
    dateTo: '2026-10-05',
  });
  assert.equal(shifts.length, 0);
  assert.equal(await store.getOnecBatchByKey('batch-atomic-1'), null);
  const failures = await store.listOnecFailures({ limit: 10 });
  assert.ok(failures.some(item =>
    item.idempotencyKey === 'batch-atomic-1' &&
    item.errorCode === 'ONEC_STORE_MAPPING_MISSING'
  ));
});

test('idempotency header must match batchId', async () => {
  const batch = makeBatch('batch-header-1', {
    recordId: 'amper:2026-10-06',
    businessDate: '2026-10-06',
    sourceUpdatedAt: '2026-10-06T19:00:00+10:00',
  });
  const response = await fetch(`${baseUrl}/api/integration/1c/v1/daily-sales`, {
    method: 'POST',
    headers: {
      ...writeHeaders,
      'X-Idempotency-Key': 'different-key',
    },
    body: JSON.stringify(batch),
  });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, 'ONEC_IDEMPOTENCY_MISMATCH');
});
