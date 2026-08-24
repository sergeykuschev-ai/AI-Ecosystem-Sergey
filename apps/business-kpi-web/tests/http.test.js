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

before(async () => {
  server = createBusinessKpiWebServer({ config: loadConfig({}) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const created = (await createResponse.json()).data;

  assert.equal(createResponse.status, 201);
  assert.equal(created.source, 'web_manual');
  assert.equal(created.metrics.revenue, 24000);
  assert.equal(created.metrics.averageCheck, 1200);
  assert.equal(created.metrics.itemsPerReceipt, 2.5);

  const dashboardResponse = await fetch(
    `${baseUrl}/api/business-kpi/dashboard?store=${DEV_STORE.id}&year=2026&month=8`
  );
  const dashboard = (await dashboardResponse.json()).data;
  assert.equal(dashboard.month.revenue, 24000);
  assert.equal(dashboard.month.shiftsCount, 1);
  assert.equal(dashboard.days[0].revenue, 24000);
  assert.equal(dashboard.sellers[0].revenue, 24000);

  const filtered = await fetch(
    `${baseUrl}/api/business-kpi/shifts?store=${DEV_STORE.id}` +
    `&employee=${DEV_EMPLOYEES[0].id}&date_from=2026-08-20&date_to=2026-08-20`
  ).then(response => response.json());
  assert.equal(filtered.data.items.length, 1);

  const patchResponse = await fetch(
    `${baseUrl}/api/business-kpi/shifts/${created.id}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Change-Reason': 'cash correction',
      },
      body: JSON.stringify({ cash: 12000 }),
    }
  );
  const updated = (await patchResponse.json()).data;
  assert.equal(updated.metrics.revenue, 26000);

  const detail = await fetch(
    `${baseUrl}/api/business-kpi/shifts/${created.id}`
  ).then(response => response.json());
  assert.deepEqual(
    detail.data.audit.map(item => item.action),
    ['SHIFT_CREATED', 'SHIFT_UPDATED']
  );

  const duplicateResponse = await fetch(`${baseUrl}/api/business-kpi/shifts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const duplicate = await duplicateResponse.json();
  assert.equal(duplicateResponse.status, 409);
  assert.equal(duplicate.error.code, 'DUPLICATE_SHIFT');

  const forbiddenDelete = await fetch(
    `${baseUrl}/api/business-kpi/shifts/${created.id}`,
    { method: 'DELETE', headers: { 'X-Business-KPI-Role': 'SELLER' } }
  );
  assert.equal(forbiddenDelete.status, 403);

  const deleteResponse = await fetch(
    `${baseUrl}/api/business-kpi/shifts/${created.id}`,
    { method: 'DELETE', headers: { 'X-Change-Reason': 'archive test' } }
  );
  assert.equal(deleteResponse.status, 200);

  const list = await fetch(
    `${baseUrl}/api/business-kpi/shifts?store=${DEV_STORE.id}&year=2026&month=8`
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const qrBody = await qrResponse.json();
  assert.equal(qrResponse.status, 422);
  assert.equal(qrBody.error.code, 'VALIDATION_ERROR');
  assert.match(qrBody.error.message, /QR/);

  const derivedResponse = await fetch(`${baseUrl}/api/business-kpi/shifts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, qr: 5, averageCheck: 30 }),
  });
  const derivedBody = await derivedResponse.json();
  assert.equal(derivedResponse.status, 422);
  assert.equal(derivedBody.error.code, 'UNSUPPORTED_SHIFT_FIELD');

  const invalidRange = await fetch(
    `${baseUrl}/api/business-kpi/shifts?date_from=2026-08-22&date_to=2026-08-21`
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
    method: 'POST', body: form,
  });
  const dryBody = await dryResponse.json();
  assert.equal(dryResponse.status, 201);
  assert.equal(dryBody.data.status, 'VALIDATING');
  assert.equal(dryBody.data.originalFilename, 'сентябрь.xlsx');
  assert.equal(dryBody.data.rowsImported, 0);
  assert.equal(dryBody.data.canonicalRows, undefined);

  const commitResponse = await fetch(
    `${baseUrl}/api/business-kpi/imports/${dryBody.data.id}/commit`,
    { method: 'POST' }
  );
  const commitBody = await commitResponse.json();
  assert.equal(commitResponse.status, 200);
  assert.equal(commitBody.data.status, 'COMPLETED');
  assert.equal(commitBody.data.rowsImported, 1);
});
