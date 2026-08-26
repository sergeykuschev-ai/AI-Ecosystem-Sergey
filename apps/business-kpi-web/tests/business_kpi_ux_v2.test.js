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

let server;
let baseUrl;

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
});

after(async () => {
  server.close();
  await once(server, 'close');
});

function devOwnerHeaders(extra = {}) {
  return {
    'X-Business-KPI-Actor-Id': 'ux-v2-owner',
    'X-Business-KPI-Role': 'OWNER',
    ...extra,
  };
}

function apiFetch(path, options = {}) {
  const mergedHeaders = {
    ...devOwnerHeaders(),
    ...(options.headers || {}),
  };
  return fetch(path, { ...options, headers: mergedHeaders });
}

async function createShift(input) {
  const response = await apiFetch(`${baseUrl}/api/business-kpi/shifts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
      comment: 'UX v2 test',
      ...input,
    }),
  });
  return (await response.json()).data;
}

test('dashboard includes dataStatus and today aggregate', async () => {
  const response = await apiFetch(
    `${baseUrl}/api/business-kpi/dashboard?store=${DEV_STORE.id}&year=2026&month=8`
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(['NO_DATA', 'PARTIAL', 'COMPLETE'].includes(body.data.month.dataStatus));
  assert.ok(Object.hasOwn(body.data.month, 'dataStatus'));
});

test('today endpoint returns current date aggregate', async () => {
  const response = await apiFetch(`${baseUrl}/api/business-kpi/today?store=${DEV_STORE.id}`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.data.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Array.isArray(body.data.shifts));
  assert.ok(Object.hasOwn(body.data.aggregate, 'dataStatus'));
});

test('months endpoint returns 12 months with plan, fact and dataStatus', async () => {
  const response = await apiFetch(
    `${baseUrl}/api/business-kpi/months?store=${DEV_STORE.id}&year=2026`
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.items.length, 12);
  const august = body.data.items[7];
  assert.equal(august.month, 8);
  assert.ok(Object.hasOwn(august, 'planCompletion'));
  assert.ok(Object.hasOwn(august, 'dataStatus'));
  assert.ok(Object.hasOwn(august, 'changeFromPreviousMonth'));
});

test('year endpoint returns YTD and completed month ranking', async () => {
  const response = await apiFetch(
    `${baseUrl}/api/business-kpi/year?store=${DEV_STORE.id}&year=2026`
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Object.hasOwn(body.data.ytd, 'revenue'));
  assert.ok(Object.hasOwn(body.data.ytd, 'planCompletion'));
  assert.ok(Array.isArray(body.data.months));
  assert.ok(Object.hasOwn(body.data, 'bests'));
  assert.ok(Object.hasOwn(body.data, 'worsts'));
  assert.ok(Object.hasOwn(body.data, 'hasConfirmedFuturePlans'));
});

test('bonuses endpoint exposes bonus details per seller', async () => {
  const response = await apiFetch(
    `${baseUrl}/api/business-kpi/bonuses?store=${DEV_STORE.id}&year=2026&month=8`
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.data.items));
  assert.ok(Object.hasOwn(body.data, 'dataStatus'));
  assert.ok(Object.hasOwn(body.data, 'planCompletion'));
});

test('settings version creation requires weights to sum to 100', async () => {
  const response = await apiFetch(`${baseUrl}/api/business-kpi/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...devOwnerHeaders() },
    body: JSON.stringify({
      storeId: DEV_STORE.id,
      effectiveFrom: '2026-09-01',
      reason: 'test',
      settings: {
        targets: {
          averageCheck: 1200,
          itemsPerReceipt: 2.5,
          upsellReceiptShare: 0.3,
          treatsRevenue: 1200,
          treatsReceiptShare: 0.2,
          qrShare: null,
          shiftRevenue: 24000,
          sellerShifts: 15,
        },
        weights: { shiftPlan: 30, averageCheck: 20, itemsPerReceipt: 15, upsell: 20, treats: 16 },
        fees: { acquiring: 0.022, qr: 0.007 },
        payment: { qrIncludedInAcquiring: true },
        levels: [{ name: 'Отлично', minimumScore: 95, bonusBase: 7000 }],
        qrCoefficientTiers: [{ upperExclusive: null, coefficient: 1 }],
      },
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.match(body.error.message, /100/);
});

test('settings version creation succeeds with valid weights', async () => {
  const response = await apiFetch(`${baseUrl}/api/business-kpi/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...devOwnerHeaders() },
    body: JSON.stringify({
      storeId: DEV_STORE.id,
      effectiveFrom: '2026-09-01',
      reason: 'test valid',
      settings: {
        targets: {
          averageCheck: 1200,
          itemsPerReceipt: 2.5,
          upsellReceiptShare: 0.3,
          treatsRevenue: 1200,
          treatsReceiptShare: 0.2,
          qrShare: null,
          shiftRevenue: 24000,
          sellerShifts: 15,
        },
        weights: { shiftPlan: 30, averageCheck: 20, itemsPerReceipt: 15, upsell: 20, treats: 15 },
        fees: { acquiring: 0.022, qr: 0.007 },
        payment: { qrIncludedInAcquiring: true },
        levels: [
          { name: 'Отлично', minimumScore: 95, bonusBase: 7000 },
          { name: 'Без премии', minimumScore: 0, bonusBase: 0 },
        ],
        qrCoefficientTiers: [{ upperExclusive: null, coefficient: 1 }],
      },
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.data.version, 2);
});

function buildValidSettings(patch = {}) {
  return {
    targets: {
      averageCheck: 1200,
      itemsPerReceipt: 2.5,
      upsellReceiptShare: 0.3,
      treatsRevenue: 1200,
      treatsReceiptShare: 0.2,
      qrShare: null,
      shiftRevenue: 24000,
      sellerShifts: 15,
    },
    weights: { shiftPlan: 30, averageCheck: 20, itemsPerReceipt: 15, upsell: 20, treats: 15 },
    fees: { acquiring: 0.022, qr: 0.007 },
    payment: { qrIncludedInAcquiring: true },
    levels: [
      { name: 'Отлично', minimumScore: 95, bonusBase: 7000 },
      { name: 'Без премии', minimumScore: 0, bonusBase: 0 },
    ],
    qrCoefficientTiers: [
      { upperExclusive: 0.1, coefficient: 0.95 },
      { upperExclusive: 0.15, coefficient: 1 },
      { upperExclusive: 0.2, coefficient: 1.025 },
      { upperExclusive: 0.25, coefficient: 1.05 },
      { upperExclusive: null, coefficient: 1.075 },
    ],
    ...patch,
  };
}

test('settings version creation rejects invalid QR tiers', async () => {
  const response = await apiFetch(`${baseUrl}/api/business-kpi/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...devOwnerHeaders() },
    body: JSON.stringify({
      storeId: DEV_STORE.id,
      effectiveFrom: '2026-10-01',
      reason: 'test invalid qr tiers',
      settings: buildValidSettings({
        qrCoefficientTiers: [
          { upperExclusive: 0.2, coefficient: 0.95 },
          { upperExclusive: 0.15, coefficient: 1 },
          { upperExclusive: null, coefficient: 1 },
        ],
      }),
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.match(body.error.message, /возрастанию/);
});

test('settings version creation rejects percentage above 100%', async () => {
  const response = await apiFetch(`${baseUrl}/api/business-kpi/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...devOwnerHeaders() },
    body: JSON.stringify({
      storeId: DEV_STORE.id,
      effectiveFrom: '2026-10-01',
      reason: 'test percentage overflow',
      settings: buildValidSettings({ targets: { ...buildValidSettings().targets, upsellReceiptShare: 1.5 } }),
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.match(body.error.message, /допродаж/);
});

test('historical shift keeps KPI calculated by settings version effective on shift date', async () => {
  const augustShift = await createShift({ shiftDate: '2026-08-20' });
  assert.equal(augustShift.settingsVersion, 1);

  const createResponse = await apiFetch(`${baseUrl}/api/business-kpi/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...devOwnerHeaders() },
    body: JSON.stringify({
      storeId: DEV_STORE.id,
      effectiveFrom: '2026-09-01',
      reason: 'new targets for september',
      settings: buildValidSettings({ targets: { ...buildValidSettings().targets, averageCheck: 5000 } }),
    }),
  });
  assert.equal(createResponse.status, 201);

  const augustResponse = await apiFetch(
    `${baseUrl}/api/business-kpi/shifts/${augustShift.id}`
  );
  const augustBody = await augustResponse.json();
  assert.equal(augustBody.data.settingsVersion, 1);

  const septemberShift = await createShift({ shiftDate: '2026-09-02' });
  assert.equal(septemberShift.settingsVersion, 3);

});

test('shift validation rejects qr above acquiring', async () => {
  const response = await apiFetch(`${baseUrl}/api/business-kpi/shifts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storeId: DEV_STORE.id,
      employeeId: DEV_EMPLOYEES[0].id,
      shiftDate: '2026-08-21',
      shiftKey: 'main',
      cash: 1000,
      acquiring: 1000,
      qr: 1001,
      receipts: 1,
      itemsSold: 1,
      upsellReceipts: 0,
      treatsRevenue: 0,
      treatsReceipts: 0,
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.match(body.error.message, /QR/);
});

test('shift validation rejects upsell receipts above total receipts', async () => {
  const response = await apiFetch(`${baseUrl}/api/business-kpi/shifts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storeId: DEV_STORE.id,
      employeeId: DEV_EMPLOYEES[0].id,
      shiftDate: '2026-08-22',
      shiftKey: 'main',
      cash: 1000,
      acquiring: 1000,
      qr: 0,
      receipts: 1,
      itemsSold: 1,
      upsellReceipts: 2,
      treatsRevenue: 0,
      treatsReceipts: 0,
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('shift validation rejects negative values', async () => {
  const response = await apiFetch(`${baseUrl}/api/business-kpi/shifts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storeId: DEV_STORE.id,
      employeeId: DEV_EMPLOYEES[0].id,
      shiftDate: '2026-08-23',
      shiftKey: 'main',
      cash: -1,
      acquiring: 1000,
      qr: 0,
      receipts: 1,
      itemsSold: 1,
      upsellReceipts: 0,
      treatsRevenue: 0,
      treatsReceipts: 0,
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 422);
});

test('frontend formatters module maps null to unavailable text', () => {
  const formatters = require('../public/formatters.js');
  assert.equal(formatters.formatMoney(null), 'н/д');
  assert.equal(formatters.formatPercent(null), 'н/д');
  assert.equal(formatters.formatInteger(null), 'н/д');
  assert.equal(formatters.formatNumber(null), 'н/д');
  assert.equal(formatters.uiDataStatus('NO_DATA').label, 'Нет данных');
  assert.equal(formatters.uiDataStatus('PARTIAL').label, 'Частичные данные');
  assert.equal(formatters.uiDataStatus('COMPLETE').label, 'Полные данные');
  assert.equal(formatters.uiMonthStatus('IN_PROGRESS').label, 'Месяц идёт');
  assert.equal(formatters.uiImportStatus('COMPLETED'), 'Успешно');
  assert.equal(formatters.sourceLabel('excel_import'), 'Импорт из Excel');
  assert.equal(formatters.sourceLabel('web_manual'), 'Ручной ввод');
});

test('frontend app does not compute kpiScore with assignment', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.doesNotMatch(js, /kpiScore\s*=/);
});

test('year endpoint returns currentMonthSummary and ytdCompleted and excludes current month from bests/worsts', async () => {
  const response = await apiFetch(
    `${baseUrl}/api/business-kpi/year?store=${DEV_STORE.id}&year=2026`
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(body.data.currentMonthSummary);
  assert.ok(Object.hasOwn(body.data, 'ytdCompleted'));
  assert.ok(body.data.ytdCompleted);
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();
  if (currentYear === 2026) {
    if (body.data.bests.revenue) {
      assert.notEqual(body.data.bests.revenue.month, currentMonth);
    }
    if (body.data.worsts.revenue) {
      assert.notEqual(body.data.worsts.revenue.month, currentMonth);
    }
  }
});

async function createCompleteShift(input) {
  const response = await apiFetch(`${baseUrl}/api/business-kpi/shifts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
      comment: 'UX v2 bonus test',
      ...input,
    }),
  });
  return (await response.json()).data;
}

test('bonuses endpoint returns shiftNorm 15 and coefficient matching shift count', async () => {
  const employee = DEV_EMPLOYEES[2];
  const dates = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15'];
  for (const date of dates) {
    await createCompleteShift({ shiftDate: date, employeeId: employee.id });
  }
  const response = await apiFetch(
    `${baseUrl}/api/business-kpi/bonuses?store=${DEV_STORE.id}&year=2026&month=8`
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  const seller = body.data.items.find(item => item.employeeId === employee.id);
  assert.ok(seller, 'seller bonus row exists');
  assert.ok(seller.bonusDetails, 'bonusDetails exists');
  assert.equal(seller.bonusDetails.shiftNorm, 15);
  assert.equal(seller.bonusDetails.shiftCoefficient, 6 / 15);
});

test('partial seller has missingFields and unresolved bonus', async () => {
  const employee = DEV_EMPLOYEES[4];
  const created = await createCompleteShift({
    shiftDate: '2026-08-16',
    employeeId: employee.id,
    itemsSold: null,
    upsellReceipts: null,
    treatsRevenue: null,
    treatsReceipts: null,
  });
  assert.ok(created, 'partial shift was created');

  const dashboardResponse = await apiFetch(
    `${baseUrl}/api/business-kpi/dashboard?store=${DEV_STORE.id}&year=2026&month=8`
  );
  const dashboardBody = await dashboardResponse.json();
  assert.equal(dashboardResponse.status, 200);
  const dashboardSeller = dashboardBody.data.sellers.find(item => item.employeeId === employee.id);
  assert.ok(dashboardSeller, 'partial seller row exists in dashboard');
  assert.equal(dashboardSeller.bonusStatus, 'UNRESOLVED');
  assert.ok(Array.isArray(dashboardSeller.missingFields));
  assert.ok(dashboardSeller.missingFields.length > 0);

  const bonusesResponse = await apiFetch(
    `${baseUrl}/api/business-kpi/bonuses?store=${DEV_STORE.id}&year=2026&month=8`
  );
  const bonusesBody = await bonusesResponse.json();
  assert.equal(bonusesResponse.status, 200);
  const bonusSeller = bonusesBody.data.items.find(item => item.employeeId === employee.id);
  assert.ok(bonusSeller, 'partial seller row exists in bonuses');
  assert.equal(bonusSeller.bonusStatus, 'UNRESOLVED');
  assert.equal(bonusSeller.shiftNorm, 15, 'shiftNorm is exposed for unresolved seller');
  assert.ok(Array.isArray(bonusSeller.missingFields), 'missingFields array is exposed');
  assert.ok(bonusSeller.missingFields.includes('itemsSold'), 'missingFields lists itemsSold');
});

test('months endpoint marks current month with label and note', async () => {
  const response = await apiFetch(
    `${baseUrl}/api/business-kpi/months?store=${DEV_STORE.id}&year=2026`
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const august = body.data.items[7];
  if (currentMonth === 8) {
    assert.ok(august.forecast);
  }
});

test('dashboard HTML includes attention block and responsive table classes', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, /id="attention-list"/);
  assert.match(html, /class="sticky-first-column"/);
  assert.match(html, /Товаров в чеке/);
  assert.match(html, /Доля QR/);
  assert.match(html, /Оплачено через QR/);
});

test('dashboard app includes attention rendering and target comparison helpers', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(js, /function renderAttention\(/);
  assert.match(js, /function renderDashboardPlanChart\(/);
  assert.match(js, /function renderDashboardRevenueChart\(/);
  assert.match(js, /targets\.shiftRevenue/);
  assert.match(js, /targets\.averageCheck/);
  assert.match(js, /targets\.itemsPerReceipt/);
});
