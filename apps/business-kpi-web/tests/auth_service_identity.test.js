'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { after, before, test } = require('node:test');

const {
  createBusinessKpiWebServer,
} = require('../server');
const { loadConfig } = require('../config');
const {
  DEV_EMPLOYEES,
  DEV_STORE,
} = require('../storage/in_memory_business_kpi_store');

const SERVICE_KEY = 'test-arthur-analytics-key-' + 'x'.repeat(32);
const SERVICE_ID = 'arthur.analytics';

let server;
let baseUrl;
let createdShiftId;

function serviceHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${SERVICE_KEY}`,
    ...extra,
  };
}

function ownerHeaders(extra = {}) {
  return {
    'x-business-kpi-actor-id': 'owner.test',
    'x-business-kpi-role': 'OWNER',
    ...extra,
  };
}

before(async () => {
  server = createBusinessKpiWebServer({
    config: loadConfig({
      BUSINESS_KPI_DEV_MODE: 'true',
      BUSINESS_KPI_SEED_REFERENCE_DATA: 'true',
      BUSINESS_KPI_SERVICE_KEYS: JSON.stringify([
        {
          id: SERVICE_ID,
          name: 'Arthur Analytics',
          key: SERVICE_KEY,
        },
      ]),
    }),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const input = {
    storeId: DEV_STORE.id,
    employeeId: DEV_EMPLOYEES[0].id,
    shiftDate: '2026-08-25',
    shiftKey: 'main',
    cash: 1000,
    acquiring: 2000,
    qr: 500,
    receipts: 10,
    itemsSold: 25,
    upsellReceipts: 2,
    treatsRevenue: 300,
    treatsReceipts: 1,
    comment: 'service identity test setup',
  };
  const createResponse = await fetch(`${baseUrl}/api/business-kpi/shifts`, {
    method: 'POST',
    headers: ownerHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  });
  if (!createResponse.ok) {
    throw new Error(`setup shift creation failed: ${createResponse.status} ${await createResponse.text()}`);
  }
  createdShiftId = (await createResponse.json()).data.id;
});

after(async () => {
  server.close();
  await once(server, 'close');
});

test('configuration rejects non-array service keys', () => {
  assert.throws(
    () => loadConfig({ BUSINESS_KPI_SERVICE_KEYS: '{"id":"x"}' }),
    /JSON array/
  );
});

test('configuration parses valid service keys', () => {
  const config = loadConfig({
    BUSINESS_KPI_SERVICE_KEYS: JSON.stringify([
      { id: 'svc-1', name: 'Service One', key: 'key-one' },
    ]),
  });
  assert.equal(config.serviceKeys.length, 1);
  assert.equal(config.serviceKeys[0].id, 'svc-1');
  assert.equal(config.serviceKeys[0].name, 'Service One');
  assert.equal(config.serviceKeys[0].key, 'key-one');
});

test('service identity can read dashboard', async () => {
  const response = await fetch(
    `${baseUrl}/api/business-kpi/dashboard?store=${DEV_STORE.id}&year=2026&month=8`,
    { headers: serviceHeaders() }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.api_version, 'v1');
  assert.ok(body.data.month);
});

test('service identity can read sellers', async () => {
  const response = await fetch(
    `${baseUrl}/api/business-kpi/sellers?store=${DEV_STORE.id}&year=2026&month=8`,
    { headers: serviceHeaders() }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data.items));
});

test('service identity can read shifts', async () => {
  const response = await fetch(
    `${baseUrl}/api/business-kpi/shifts?store=${DEV_STORE.id}&year=2026&month=8`,
    { headers: serviceHeaders() }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data.items));
});

test('service identity can read bonuses', async () => {
  const response = await fetch(
    `${baseUrl}/api/business-kpi/bonuses?store=${DEV_STORE.id}&year=2026&month=8`,
    { headers: serviceHeaders() }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data.items));
});

test('service identity can read seller performance', async () => {
  const response = await fetch(
    `${baseUrl}/api/business-kpi/seller-performance?store=${DEV_STORE.id}&year=2026&month=8`,
    { headers: serviceHeaders() }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data.items));
});

test('service identity cannot create shift', async () => {
  const response = await fetch(`${baseUrl}/api/business-kpi/shifts`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      storeId: DEV_STORE.id,
      employeeId: DEV_EMPLOYEES[0].id,
      shiftDate: '2026-08-26',
      shiftKey: 'main',
      cash: 1000,
      acquiring: 2000,
      qr: 500,
      receipts: 10,
      itemsSold: 25,
      upsellReceipts: 2,
      treatsRevenue: 300,
      treatsReceipts: 1,
    }),
  });

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, 'FORBIDDEN');
});

test('service identity cannot update shift', async () => {
  const response = await fetch(
    `${baseUrl}/api/business-kpi/shifts/${createdShiftId}`,
    {
      method: 'PATCH',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ cash: 999 }),
    }
  );

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, 'FORBIDDEN');
});

test('service identity cannot delete shift', async () => {
  const response = await fetch(
    `${baseUrl}/api/business-kpi/shifts/${createdShiftId}`,
    {
      method: 'DELETE',
      headers: serviceHeaders(),
    }
  );

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, 'FORBIDDEN');
});

test('service identity cannot update monthly plan', async () => {
  const response = await fetch(`${baseUrl}/api/business-kpi/plans/2026/8`, {
    method: 'PUT',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ storeId: DEV_STORE.id, revenuePlan: 1000000 }),
  });

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, 'FORBIDDEN');
});

test('service identity cannot create settings version', async () => {
  const response = await fetch(`${baseUrl}/api/business-kpi/settings`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ storeId: DEV_STORE.id, effectiveFrom: '2026-08-01', settings: {} }),
  });

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, 'FORBIDDEN');
});

test('missing service key returns 401', async () => {
  const response = await fetch(
    `${baseUrl}/api/business-kpi/dashboard?store=${DEV_STORE.id}&year=2026&month=8`
  );

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, 'AUTH_REQUIRED');
});

test('invalid service key returns 401', async () => {
  const response = await fetch(
    `${baseUrl}/api/business-kpi/dashboard?store=${DEV_STORE.id}&year=2026&month=8`,
    { headers: { Authorization: 'Bearer invalid-key' } }
  );

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, 'AUTH_REQUIRED');
});
