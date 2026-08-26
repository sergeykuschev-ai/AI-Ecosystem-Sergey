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
const { makeXlsx } = require('./xlsx_fixture');

let server;
let baseUrl;
let ownerHeaders = {};

async function loginAsOwner() {
  const authService = new (require('../application/auth_service').AuthService)({
    store: server.businessKpiStore,
  });
  await authService.createUser({
    id: '00000000-0000-4000-8000-000000000001',
    externalId: 'owner.test',
    displayName: 'Test Owner',
    role: 'OWNER',
    storeId: DEV_STORE.id,
    password: 'owner-test-password',
  });
  const login = await fetch(`${baseUrl}/api/business-kpi/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ externalId: 'owner.test', password: 'owner-test-password' }),
  });
  if (!login.ok) {
    throw new Error(`login failed: ${login.status} ${await login.text()}`);
  }
  const cookies = login.headers.get('set-cookie');
  const csrfMatch = cookies && cookies.match(/business_kpi_csrf=([^;]+)/);
  return {
    cookie: cookies,
    csrf: csrfMatch ? decodeURIComponent(csrfMatch[1]) : '',
  };
}

function authHeaders(extra = {}) {
  return {
    Cookie: ownerHeaders.cookie,
    ...(ownerHeaders.csrf ? { 'X-CSRF-Token': ownerHeaders.csrf } : {}),
    ...extra,
  };
}

function sellerHeaders(extra = {}) {
  return {
    Cookie: testSellerHeaders.cookie,
    ...(testSellerHeaders.csrf ? { 'X-CSRF-Token': testSellerHeaders.csrf } : {}),
    ...extra,
  };
}

let testSellerHeaders = {};

async function createTestSeller() {
  const authService = new (require('../application/auth_service').AuthService)({
    store: server.businessKpiStore,
  });
  await authService.createUser({
    id: '00000000-0000-4000-8000-000000000003',
    externalId: 'seller.test',
    displayName: 'Test Seller',
    role: 'SELLER',
    storeId: DEV_STORE.id,
    password: 'seller-test-password',
  });
  const login = await fetch(`${baseUrl}/api/business-kpi/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ externalId: 'seller.test', password: 'seller-test-password' }),
  });
  if (!login.ok) {
    throw new Error(`seller login failed: ${login.status} ${await login.text()}`);
  }
  const cookies = login.headers.get('set-cookie');
  const csrfMatch = cookies && cookies.match(/business_kpi_csrf=([^;]+)/);
  return {
    cookie: cookies,
    csrf: csrfMatch ? decodeURIComponent(csrfMatch[1]) : '',
  };
}

before(async () => {
  server = createBusinessKpiWebServer({
    config: loadConfig({
      BUSINESS_KPI_DEV_MODE: 'true',
      BUSINESS_KPI_SEED_REFERENCE_DATA: 'true',
    }),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  ownerHeaders = await loginAsOwner();
  testSellerHeaders = await createTestSeller();
});

after(async () => {
  server.close();
  await once(server, 'close');
});

test('health endpoint reports the service without claiming a DB check', async () => {
  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.api_version, 'v1');
  assert.equal(body.data.status, 'ok');
  assert.equal(body.data.service, 'business-kpi-web');
  assert.equal(body.data.storage.schema, 'business_kpi');
  assert.equal(body.data.storage.provider, 'memory');
  assert.equal(body.data.storage.configured, false);
  assert.equal(body.data.storage.checked, false);
  assert.equal(body.data.storage.healthy, null);
});

test('frontend shell exposes every planned section', async () => {
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  for (const label of [
    'Главная',
    'Смены',
    'Месяцы',
    'Год',
    'Продавцы',
    'Премии',
    'Настройки',
    'Импорт / экспорт',
  ]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(response.headers.get('content-security-policy'), /default-src/);
});

test('static handler serves UX v2 formatters script', async () => {
  const response = await fetch(`${baseUrl}/formatters.js`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/javascript/);
  assert.match(body, /formatMoney|formatPercent|NA_TEXT/);
});

test('unknown API routes return a versioned error contract', async () => {
  const response = await fetch(`${baseUrl}/api/v1/unknown`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.api_version, 'v1');
  assert.equal(body.error.code, 'ROUTE_NOT_FOUND');
});

test('manual API shift flows through storage, KPI, dashboard, update, and audit', async () => {
  const input = {
    storeId: DEV_STORE.id,
    employeeId: DEV_EMPLOYEES[0].id,
    shiftDate: '2026-08-20',
    shiftKey: 'main',
    cash: 10000,
    acquiring: 14000,
    qr: 2400,
    receipts: 20,
    itemsSold: 50,
    upsellReceipts: 6,
    treatsRevenue: 1200,
    treatsReceipts: 4,
    comment: 'HTTP integration',
  };
  const createResponse = await fetch(`${baseUrl}/api/business-kpi/shifts`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  });
  const created = (await createResponse.json()).data;

  assert.equal(createResponse.status, 201);
  assert.equal(created.source, 'web_manual');
  assert.equal(created.metrics.revenue, 24000);
  assert.equal(created.metrics.averageCheck, 1200);
  assert.equal(created.metrics.itemsPerReceipt, 2.5);

  const dashboardResponse = await fetch(
    `${baseUrl}/api/business-kpi/dashboard?store=${DEV_STORE.id}&year=2026&month=8`,
    { headers: authHeaders() }
  );
  const dashboard = (await dashboardResponse.json()).data;
  assert.equal(dashboard.month.revenue, 24000);
  assert.equal(dashboard.month.shiftsCount, 1);
  assert.equal(dashboard.days[0].revenue, 24000);
  assert.equal(dashboard.sellers[0].revenue, 24000);

  const filtered = await fetch(
    `${baseUrl}/api/business-kpi/shifts?store=${DEV_STORE.id}` +
    `&employee=${DEV_EMPLOYEES[0].id}&date_from=2026-08-20&date_to=2026-08-20`,
    { headers: authHeaders() }
  ).then(response => response.json());
  assert.equal(filtered.data.items.length, 1);

  const patchResponse = await fetch(
    `${baseUrl}/api/business-kpi/shifts/${created.id}`,
    {
      method: 'PATCH',
      headers: authHeaders({
        'Content-Type': 'application/json',
        'X-Change-Reason': 'cash correction',
      }),
      body: JSON.stringify({ cash: 12000 }),
    }
  );
  const updated = (await patchResponse.json()).data;
  assert.equal(updated.metrics.revenue, 26000);

  const detail = await fetch(
    `${baseUrl}/api/business-kpi/shifts/${created.id}`,
    { headers: authHeaders() }
  ).then(response => response.json());
  assert.deepEqual(
    detail.data.audit.map(item => item.action),
    ['SHIFT_CREATED', 'SHIFT_UPDATED']
  );

  const duplicateResponse = await fetch(`${baseUrl}/api/business-kpi/shifts`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  });
  const duplicate = await duplicateResponse.json();
  assert.equal(duplicateResponse.status, 409);
  assert.equal(duplicate.error.code, 'DUPLICATE_SHIFT');

  const forbiddenDelete = await fetch(
    `${baseUrl}/api/business-kpi/shifts/${created.id}`,
    { method: 'DELETE', headers: sellerHeaders({ 'X-Change-Reason': 'forbidden test' }) }
  );
  assert.equal(forbiddenDelete.status, 403);

  const deleteResponse = await fetch(
    `${baseUrl}/api/business-kpi/shifts/${created.id}`,
    { method: 'DELETE', headers: authHeaders({ 'X-Change-Reason': 'archive test' }) }
  );
  assert.equal(deleteResponse.status, 200);

  const list = await fetch(
    `${baseUrl}/api/business-kpi/shifts?store=${DEV_STORE.id}&year=2026&month=8`,
    { headers: authHeaders() }
  ).then(response => response.json());
  assert.equal(list.data.items.length, 0);
});

test('manual API rejects derived fields and QR above acquiring', async () => {
  const input = {
    storeId: DEV_STORE.id,
    employeeId: DEV_EMPLOYEES[0].id,
    shiftDate: '2026-08-21',
    cash: 10,
    acquiring: 20,
    qr: 21,
    receipts: 1,
    itemsSold: 1,
    upsellReceipts: 0,
    treatsRevenue: 0,
    treatsReceipts: 0,
  };
  const qrResponse = await fetch(`${baseUrl}/api/business-kpi/shifts`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  });
  const qrBody = await qrResponse.json();
  assert.equal(qrResponse.status, 422);
  assert.equal(qrBody.error.code, 'VALIDATION_ERROR');
  assert.match(qrBody.error.message, /QR/);

  const derivedResponse = await fetch(`${baseUrl}/api/business-kpi/shifts`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ...input, qr: 5, averageCheck: 30 }),
  });
  const derivedBody = await derivedResponse.json();
  assert.equal(derivedResponse.status, 422);
  assert.equal(derivedBody.error.code, 'UNSUPPORTED_SHIFT_FIELD');

  const invalidRange = await fetch(
    `${baseUrl}/api/business-kpi/shifts?date_from=2026-08-22&date_to=2026-08-21`,
    { headers: authHeaders() }
  );
  const invalidRangeBody = await invalidRange.json();
  assert.equal(invalidRange.status, 422);
  assert.equal(invalidRangeBody.error.code, 'VALIDATION_ERROR');
});

test('multipart XLSX API enforces dry-run before atomic commit', async () => {
  const workbook = makeXlsx([{ name: 'KPI_Контроль', rows: [
    ['Дата', 'Продавец', 'Выручка ₽', 'Количество чеков'],
    ['10.09.2026', 'Горбунова', 1234.5, 3],
  ] }]);
  const form = new FormData();
  form.set('storeId', DEV_STORE.id);
  form.set('file', new Blob([workbook]), 'сентябрь.xlsx');
  const dryResponse = await fetch(`${baseUrl}/api/business-kpi/imports/dry-run`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  const dryBody = await dryResponse.json();
  assert.equal(dryResponse.status, 201);
  assert.equal(dryBody.data.status, 'VALIDATING');
  assert.equal(dryBody.data.originalFilename, 'сентябрь.xlsx');
  assert.equal(dryBody.data.rowsImported, 0);
  assert.equal(dryBody.data.canonicalRows, undefined);

  const commitResponse = await fetch(
    `${baseUrl}/api/business-kpi/imports/${dryBody.data.id}/commit`,
    { method: 'POST', headers: authHeaders() }
  );
  const commitBody = await commitResponse.json();
  assert.equal(commitResponse.status, 200);
  assert.equal(commitBody.data.status, 'COMPLETED');
  assert.equal(commitBody.data.rowsImported, 1);
});

test('logout invalidates DB session and clears cookies', async () => {
  const meBefore = await fetch(`${baseUrl}/api/business-kpi/auth/me`, {
    headers: authHeaders(),
  });
  assert.equal(meBefore.status, 200);

  const logout = await fetch(`${baseUrl}/api/business-kpi/auth/logout`, {
    method: 'POST',
    headers: authHeaders(),
  });
  assert.equal(logout.status, 200);
  const clearCookies = logout.headers.get('set-cookie') || '';
  assert.match(clearCookies, /business_kpi_session=;.*Max-Age=0/);
  assert.match(clearCookies, /business_kpi_csrf=;.*Max-Age=0/);

  const meAfter = await fetch(`${baseUrl}/api/business-kpi/auth/me`, {
    headers: authHeaders(),
  });
  assert.equal(meAfter.status, 401);
});

test('dev mode does not auto-authenticate without explicit actor headers', async () => {
  const me = await fetch(`${baseUrl}/api/business-kpi/auth/me`);
  assert.equal(me.status, 401);
});

test('OWNER logout then SELLER login switches role correctly', async () => {
  await fetch(`${baseUrl}/api/business-kpi/auth/logout`, {
    method: 'POST',
    headers: authHeaders(),
  });

  const sellerLogin = await fetch(`${baseUrl}/api/business-kpi/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ externalId: 'seller.test', password: 'seller-test-password' }),
  });
  assert.equal(sellerLogin.status, 200);
  const sellerCookies = sellerLogin.headers.get('set-cookie');
  const sellerMe = await fetch(`${baseUrl}/api/business-kpi/auth/me`, {
    headers: { Cookie: sellerCookies },
  });
  const sellerBody = await sellerMe.json();
  assert.equal(sellerMe.status, 200);
  assert.equal(sellerBody.data.user.role, 'SELLER');
});
