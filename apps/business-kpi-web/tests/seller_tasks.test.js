'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { after, before, test } = require('node:test');

const { loadConfig } = require('../config');
const { createBusinessKpiWebServer } = require('../server');
const {
  DEV_EMPLOYEES,
  DEV_STORE,
  InMemoryBusinessKpiStore,
} = require('../storage/in_memory_business_kpi_store');
const {
  SELLER_TASK_LIBRARY,
} = require('../../../agents/business-kpi/rules/seller_task_library');
const {
  buildTaskProposals,
} = require('../../../agents/business-kpi/services/seller_task_planner');

const SHIFT_DATE = '2026-09-07';
const TODAY = '2026-09-06';

function seller(id, name) {
  return { id, displayName: name, participatesInSellerKpi: true };
}

function historyEntry(overrides = {}) {
  return {
    employeeId: 'e1',
    shiftDate: '2026-09-01',
    libraryCode: 'STORE-01',
    status: 'APPROVED',
    source: 'ARTHUR',
    ...overrides,
  };
}

test('planner proposes STORE + KNOWLEDGE for a calm seller without KPI problems', () => {
  const proposals = buildTaskProposals({
    sellers: [seller('e1', 'Капитанова')],
    targets: { itemsPerReceipt: 2.5, averageCheck: 1200, shiftRevenue: 24000 },
    performanceItems: [],
    historyEntries: [],
    shiftDate: SHIFT_DATE,
    today: TODAY,
    library: SELLER_TASK_LIBRARY,
  });
  assert.equal(proposals.length, 2);
  assert.equal(proposals[0].taskType, 'STORE');
  assert.equal(proposals[1].taskType, 'KNOWLEDGE');
  assert.ok(proposals.every(p => p.employeeId === 'e1' && p.shiftDate === SHIFT_DATE));
  assert.match(proposals[0].reason, /контроль магазина/i);
});

test('planner adds a third KPI task when a metric misses its target', () => {
  const proposals = buildTaskProposals({
    sellers: [seller('e1', 'Чередниченко')],
    targets: { itemsPerReceipt: 2.5, averageCheck: 1200, shiftRevenue: 24000 },
    performanceItems: [{
      employeeId: 'e1',
      itemsPerReceipt: 1.8,
      averageCheck: 1300,
      revenuePerShift: 25000,
      sellerQrShare: null,
    }],
    historyEntries: [],
    shiftDate: SHIFT_DATE,
    today: TODAY,
    library: SELLER_TASK_LIBRARY,
  });
  assert.equal(proposals.length, 3);
  assert.equal(proposals[0].taskType, 'SALES');
  assert.match(proposals[0].reason, /KPI|КПИ/);
});

test('planner respects the 30-day rotation window', () => {
  const recent = buildTaskProposals({
    sellers: [seller('e1', 'Капитанова')],
    targets: null,
    performanceItems: [],
    historyEntries: [],
    shiftDate: SHIFT_DATE,
    today: TODAY,
    library: SELLER_TASK_LIBRARY,
  });
  const blockedCode = recent[0].libraryCode;
  const rotated = buildTaskProposals({
    sellers: [seller('e1', 'Капитанова')],
    targets: null,
    performanceItems: [],
    historyEntries: [historyEntry({ libraryCode: blockedCode })],
    shiftDate: SHIFT_DATE,
    today: TODAY,
    library: SELLER_TASK_LIBRARY,
  });
  assert.ok(rotated.every(p => p.libraryCode !== blockedCode));
});

test('planner allows early repeat when the previous assignment was not completed', () => {
  const recent = buildTaskProposals({
    sellers: [seller('e1', 'Капитанова')],
    targets: null,
    performanceItems: [],
    historyEntries: [],
    shiftDate: SHIFT_DATE,
    today: TODAY,
    library: SELLER_TASK_LIBRARY,
  });
  const knowledgeCode = recent.find(p => p.taskType === 'KNOWLEDGE').libraryCode;
  const rotated = buildTaskProposals({
    sellers: [seller('e1', 'Капитанова')],
    targets: null,
    performanceItems: [],
    historyEntries: [historyEntry({ libraryCode: knowledgeCode, status: 'NOT_COMPLETED' })],
    shiftDate: SHIFT_DATE,
    today: TODAY,
    library: SELLER_TASK_LIBRARY,
  });
  assert.ok(rotated.some(p => p.libraryCode === knowledgeCode));
});

test('planner output is deterministic for identical inputs', () => {
  const options = {
    sellers: [seller('e2', 'Чередниченко'), seller('e1', 'Капитанова')],
    targets: null,
    performanceItems: [],
    historyEntries: [],
    shiftDate: SHIFT_DATE,
    today: TODAY,
    library: SELLER_TASK_LIBRARY,
  };
  assert.deepEqual(buildTaskProposals(options), buildTaskProposals(options));
});

test('low QR alone does not generate a task (MVP: Business KPI signal only)', () => {
  const proposals = buildTaskProposals({
    sellers: [seller('e1', 'Чередниченко')],
    targets: { qrShare: 0.2, itemsPerReceipt: 2.5, averageCheck: 1200 },
    performanceItems: [{
      employeeId: 'e1',
      itemsPerReceipt: 3.0,
      averageCheck: 1500,
      revenuePerShift: 30000,
      sellerQrShare: 0.05,
      attentionMetric: { key: 'qrShare', label: 'Доля QR' },
    }],
    historyEntries: [],
    shiftDate: SHIFT_DATE,
    today: TODAY,
    library: SELLER_TASK_LIBRARY,
  });
  assert.equal(proposals.filter(p => p.taskType === 'SALES').length, 0);
  assert.equal(proposals.length, 2);
});

test('overall KPI drop without a specific metric falls back to rotation', () => {
  const proposals = buildTaskProposals({
    sellers: [seller('e1', 'Капитанова')],
    targets: { itemsPerReceipt: 2.5, averageCheck: 1200 },
    performanceItems: [{
      employeeId: 'e1',
      itemsPerReceipt: 3.0,
      averageCheck: 1500,
      revenuePerShift: 30000,
      sellerQrShare: null,
      attentionMetric: { key: 'kpi', label: 'KPI' },
    }],
    historyEntries: [],
    shiftDate: SHIFT_DATE,
    today: TODAY,
    library: SELLER_TASK_LIBRARY,
  });
  assert.equal(proposals.filter(p => p.taskType === 'SALES').length, 0);
  assert.deepEqual(proposals.map(p => p.taskType), ['STORE', 'KNOWLEDGE']);
});

test('library composition matches the approved set: 16 STORE + 18 KNOWLEDGE + 10 SALES = 44', () => {
  const counts = { STORE: 0, KNOWLEDGE: 0, SALES: 0 };
  const codes = new Set();
  for (const task of SELLER_TASK_LIBRARY) {
    counts[task.type] += 1;
    assert.ok(!codes.has(task.code), `duplicate code ${task.code}`);
    codes.add(task.code);
  }
  assert.deepEqual(counts, { STORE: 16, KNOWLEDGE: 18, SALES: 10 });
  assert.equal(SELLER_TASK_LIBRARY.length, 44);
});

/* ---- HTTP contract ---- */

let server;
let baseUrl;
let ownerHeaders = {};
let sellerHeaders = {};

async function loginUser({ id, externalId, displayName, role, password }) {
  const authService = new (require('../application/auth_service').AuthService)({
    store: server.businessKpiStore,
  });
  await authService.createUser({ id, externalId, displayName, role, storeId: DEV_STORE.id, password });
  const login = await fetch(`${baseUrl}/api/business-kpi/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ externalId, password }),
  });
  assert.ok(login.ok, `login failed: ${login.status} ${await login.text()}`);
  const cookies = login.headers.get('set-cookie');
  const csrfMatch = cookies && cookies.match(/business_kpi_csrf=([^;]+)/);
  return {
    cookie: cookies,
    csrf: csrfMatch ? decodeURIComponent(csrfMatch[1]) : '',
  };
}

function authHeaders(headers, extra = {}) {
  return {
    Cookie: headers.cookie,
    ...(headers.csrf ? { 'X-CSRF-Token': headers.csrf } : {}),
    ...extra,
  };
}

function post(path, headers, body = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: authHeaders(headers, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

before(async () => {
  server = createBusinessKpiWebServer({
    store: new InMemoryBusinessKpiStore(),
    config: loadConfig({
      BUSINESS_KPI_DEV_MODE: 'true',
      BUSINESS_KPI_SEED_REFERENCE_DATA: 'true',
    }),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  ownerHeaders = await loginUser({
    id: '00000000-0000-4000-8000-000000000001',
    externalId: 'owner.test',
    displayName: 'Test Owner',
    role: 'OWNER',
    password: 'owner-test-password',
  });
  sellerHeaders = await loginUser({
    id: '00000000-0000-4000-8000-000000000003',
    externalId: 'seller.test',
    displayName: 'Test Seller',
    role: 'SELLER',
    password: 'seller-test-password',
  });
});

after(async () => {
  server.close();
  await once(server, 'close');
});

test('library endpoint returns the full seeded task library', async () => {
  const response = await fetch(`${baseUrl}/api/business-kpi/seller-tasks/library`, {
    headers: authHeaders(ownerHeaders),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(body.data.items.length >= 44);
  const types = new Set(body.data.items.map(task => task.taskType));
  assert.ok(types.has('STORE') && types.has('KNOWLEDGE') && types.has('SALES'));
  const knowledge = body.data.items.find(task => task.code === 'KNOW-07');
  assert.equal(knowledge.questions.length, 3);
});

test('generate creates proposals and a second run creates no duplicates', async () => {
  const first = await post('/api/business-kpi/seller-tasks/generate', ownerHeaders, {
    storeId: DEV_STORE.id,
    shiftDate: SHIFT_DATE,
  });
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.ok(firstBody.data.created.length >= 4, `expected proposals, got ${firstBody.data.created.length}`);
  assert.ok(firstBody.data.created.every(p => p.status === 'PENDING' && p.source === 'ARTHUR'));

  const second = await post('/api/business-kpi/seller-tasks/generate', ownerHeaders, {
    storeId: DEV_STORE.id,
    shiftDate: SHIFT_DATE,
  });
  const secondBody = await second.json();
  assert.equal(secondBody.data.created.length, 0);

  const pending = await fetch(
    `${baseUrl}/api/business-kpi/seller-tasks/proposals?store=${DEV_STORE.id}&status=PENDING`,
    { headers: authHeaders(ownerHeaders) }
  );
  assert.equal((await pending.json()).data.items.length, firstBody.data.created.length);
});

test('seller role is denied task management and reading', async () => {
  const generate = await post('/api/business-kpi/seller-tasks/generate', sellerHeaders, {
    storeId: DEV_STORE.id,
    shiftDate: SHIFT_DATE,
  });
  assert.equal(generate.status, 403);

  const library = await fetch(`${baseUrl}/api/business-kpi/seller-tasks/library`, {
    headers: authHeaders(sellerHeaders),
  });
  assert.equal(library.status, 403);
});

test('approve produces bitrix text, complete marks result, reject discards', async () => {
  const list = await fetch(
    `${baseUrl}/api/business-kpi/seller-tasks/proposals?store=${DEV_STORE.id}&status=PENDING`,
    { headers: authHeaders(ownerHeaders) }
  );
  const proposals = (await list.json()).data.items;
  assert.ok(proposals.length > 0);
  const target = proposals.find(p => p.taskType !== 'KNOWLEDGE') || proposals[0];

  const approved = await post(`/api/business-kpi/seller-tasks/${target.id}/approve`, ownerHeaders);
  assert.equal(approved.status, 200);
  const approvedBody = await approved.json();
  assert.equal(approvedBody.data.status, 'APPROVED');
  assert.ok(approvedBody.data.bitrixText.includes('Задача:'));
  assert.ok(approvedBody.data.bitrixText.includes('Битрикс24'));

  const completed = await post(`/api/business-kpi/seller-tasks/${proposals[0].id}/complete`, ownerHeaders, { note: 'Сделано' });
  assert.equal((await completed.json()).data.status, 'COMPLETED');

  const rejected = await post(`/api/business-kpi/seller-tasks/${proposals[1].id}/reject`, ownerHeaders);
  assert.equal((await rejected.json()).data.status, 'REJECTED');
});

test('approve-edited persists owner edits into bitrix text', async () => {
  const list = await fetch(
    `${baseUrl}/api/business-kpi/seller-tasks/proposals?store=${DEV_STORE.id}&status=PENDING`,
    { headers: authHeaders(ownerHeaders) }
  );
  const proposals = (await list.json()).data.items;
  const edited = await post(`/api/business-kpi/seller-tasks/${proposals[0].id}/approve-edited`, ownerHeaders, {
    title: 'Проверка полки с утренней выкладкой',
    description: 'Проверь полку до открытия: пустоты, ценники, порядок.',
  });
  const body = await edited.json();
  assert.equal(body.data.status, 'APPROVED');
  assert.match(body.data.title, /утренней выкладкой/);
  assert.match(body.data.bitrixText, /Проверь полку до открытия/);
});

test('manual assignment from library is approved immediately with bitrix text', async () => {
  const kapitanova = DEV_EMPLOYEES.find(e => e.employeeCode === 'seller-kapitanova');
  const response = await post('/api/business-kpi/seller-tasks', ownerHeaders, {
    storeId: DEV_STORE.id,
    employeeId: kapitanova.id,
    shiftDate: SHIFT_DATE,
    libraryCode: 'STORE-07',
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.data.status, 'APPROVED');
  assert.equal(body.data.source, 'MANUAL');
  assert.ok(body.data.bitrixText.includes('Задача:'));

  const notCompleted = await post(`/api/business-kpi/seller-tasks/${body.data.id}/not-complete`, ownerHeaders);
  assert.equal((await notCompleted.json()).data.status, 'NOT_COMPLETED');
});

test('manual custom one-off task is stored and visible in history', async () => {
  const cherednichenko = DEV_EMPLOYEES.find(e => e.employeeCode === 'seller-cherednichenko');
  const response = await post('/api/business-kpi/seller-tasks', ownerHeaders, {
    storeId: DEV_STORE.id,
    employeeId: cherednichenko.id,
    shiftDate: SHIFT_DATE,
    taskType: 'STORE',
    title: 'Протереть витрину',
    description: 'Протереть витрину изнутри и снаружи.',
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.data.libraryTaskId, null);

  const history = await fetch(
    `${baseUrl}/api/business-kpi/seller-tasks/history?store=${DEV_STORE.id}`,
    { headers: authHeaders(ownerHeaders) }
  );
  const items = (await history.json()).data.items;
  assert.ok(items.some(item => item.id === body.data.id && item.title === 'Протереть витрину'));
});

test('state-changing routes enforce status transitions', async () => {
  const list = await fetch(
    `${baseUrl}/api/business-kpi/seller-tasks/proposals?store=${DEV_STORE.id}&status=APPROVED`,
    { headers: authHeaders(ownerHeaders) }
  );
  const approved = (await list.json()).data.items;
  assert.ok(approved.length > 0);
  const again = await post(`/api/business-kpi/seller-tasks/${approved[0].id}/approve`, ownerHeaders);
  assert.equal(again.status, 409);
  const body = await again.json();
  assert.equal(body.error.code, 'INVALID_TASK_STATUS');
});

test('approved proposals expose library codes for the planner rotation window', async () => {
  const response = await fetch(
    `${baseUrl}/api/business-kpi/seller-tasks/proposals?store=${DEV_STORE.id}&status=APPROVED`,
    { headers: authHeaders(ownerHeaders) }
  );
  const items = (await response.json()).data.items;
  assert.ok(items.every(item => item.status === 'APPROVED'));
  assert.ok(items.some(item => item.libraryCode));
});
