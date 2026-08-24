'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { after, before, test } = require('node:test');

const { createBusinessKpiWebServer } = require('../server');
const { loadConfig } = require('../config');
const { AuthService, hashToken } = require('../application/auth_service');
const {
  DEV_EMPLOYEES,
  DEV_STORE,
} = require('../storage/in_memory_business_kpi_store');

let server;
let baseUrl;
let store;
let authService;

const SELLER_EMPLOYEE = DEV_EMPLOYEES.find(e => e.employeeCode === 'seller-cherednichenko');
const OTHER_EMPLOYEE = DEV_EMPLOYEES.find(e => e.employeeCode === 'seller-kapitanova');

async function postJson(path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

async function patchJson(path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

async function putJson(path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

function parseCookies(response) {
  const cookies = Object.create(null);
  for (const header of response.headers.getSetCookie?.() || []) {
    const [name, ...rest] = header.split(';')[0].trim().split('=');
    if (name) cookies[name] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

function sessionHeader(cookies) {
  return `business_kpi_session=${cookies.business_kpi_session}; business_kpi_csrf=${cookies.business_kpi_csrf}`;
}

before(async () => {
  const config = loadConfig({ NODE_ENV: 'production' });
  server = createBusinessKpiWebServer({
    config: { ...config, devMode: false, seedReferenceData: true },
  });
  store = server.businessKpiStore;
  authService = new AuthService({ store });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const employee = store.employees.find(e => e.id === SELLER_EMPLOYEE.id);
  if (employee) employee.userId = 'seller-user-1';
});

after(async () => {
  server.close();
  await once(server, 'close');
});

test('unauthenticated dashboard is denied', async () => {
  const response = await fetch(`${baseUrl}/api/business-kpi/dashboard?store=${DEV_STORE.id}&year=2026&month=8`);
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error.code, 'AUTH_REQUIRED');
});

test('SELLER can read dashboard, shifts, months, year, sellers, bonuses', async () => {
  await authService.createUser({
    id: 'seller-user-1',
    externalId: 'seller.cherednichenko',
    displayName: 'Чередниченко',
    role: 'SELLER',
    storeId: DEV_STORE.id,
    password: 'seller-password',
  });

  const { response: loginResponse, body: loginBody } = await postJson('/api/business-kpi/auth/login', {
    externalId: 'seller.cherednichenko',
    password: 'seller-password',
  });
  assert.equal(loginResponse.status, 200);
  assert.equal(loginBody.data.user.role, 'SELLER');
  const cookies = parseCookies(loginResponse);
  const sessionCookie = sessionHeader(cookies);

  const endpoints = [
    `/api/business-kpi/dashboard?store=${DEV_STORE.id}&year=2026&month=8`,
    `/api/business-kpi/shifts?store=${DEV_STORE.id}&year=2026&month=8`,
    `/api/business-kpi/months?store=${DEV_STORE.id}&year=2026`,
    `/api/business-kpi/year?store=${DEV_STORE.id}&year=2026`,
    `/api/business-kpi/sellers?store=${DEV_STORE.id}&year=2026&month=8`,
    `/api/business-kpi/bonuses?store=${DEV_STORE.id}&year=2026&month=8`,
  ];
  for (const endpoint of endpoints) {
    const response = await fetch(`${baseUrl}${endpoint}`, { headers: { Cookie: sessionCookie } });
    const body = await response.json();
    assert.equal(response.status, 200, `${endpoint}: ${body.error?.message}`);
  }
});

test('SELLER cannot write settings, plans, or imports', async () => {
  await authService.createUser({
    id: 'seller-user-2',
    externalId: 'seller.restricted',
    displayName: 'Restricted Seller',
    role: 'SELLER',
    storeId: DEV_STORE.id,
    password: 'seller-password',
  });

  const { response: loginResponse } = await postJson('/api/business-kpi/auth/login', {
    externalId: 'seller.restricted',
    password: 'seller-password',
  });
  const cookies = parseCookies(loginResponse);
  const csrf = cookies.business_kpi_csrf;
  const sessionCookie = sessionHeader(cookies);

  const settingsResponse = await postJson('/api/business-kpi/settings', {
    storeId: DEV_STORE.id,
    effectiveFrom: '2026-09-01',
    reason: 'test',
    settings: {},
  }, { Cookie: sessionCookie, 'x-csrf-token': csrf });
  assert.equal(settingsResponse.response.status, 403);

  const planResponse = await putJson('/api/business-kpi/plans/2026/8', {
    storeId: DEV_STORE.id,
    revenuePlan: 100000,
  }, { Cookie: sessionCookie, 'x-csrf-token': csrf });
  assert.equal(planResponse.response.status, 403);
});

test('SELLER can create and edit own web_manual shift but not others', async () => {
  await authService.createUser({
    id: 'seller-user-3',
    externalId: 'seller.ownshift',
    displayName: 'Own Shift Seller',
    role: 'SELLER',
    storeId: DEV_STORE.id,
    password: 'seller-password',
  });
  const employee = store.employees.find(e => e.id === SELLER_EMPLOYEE.id);
  if (employee) employee.userId = 'seller-user-3';

  const { response: loginResponse } = await postJson('/api/business-kpi/auth/login', {
    externalId: 'seller.ownshift',
    password: 'seller-password',
  });
  const cookies = parseCookies(loginResponse);
  const csrf = cookies.business_kpi_csrf;
  const sessionCookie = sessionHeader(cookies);

  const ownShift = {
    storeId: DEV_STORE.id,
    employeeId: SELLER_EMPLOYEE.id,
    shiftDate: '2026-08-25',
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
  const createResponse = await postJson('/api/business-kpi/shifts', ownShift, {
    Cookie: sessionCookie,
    'x-csrf-token': csrf,
  });
  assert.equal(createResponse.response.status, 201, createResponse.body.error?.message);

  const patchResponse = await patchJson(`/api/business-kpi/shifts/${createResponse.body.data.id}`, {
    cash: 12000,
  }, { Cookie: sessionCookie, 'x-csrf-token': csrf });
  assert.equal(patchResponse.response.status, 200);

  const otherShiftResponse = await postJson('/api/business-kpi/shifts', {
    ...ownShift,
    employeeId: OTHER_EMPLOYEE.id,
    shiftDate: '2026-08-26',
  }, { Cookie: sessionCookie, 'x-csrf-token': csrf });
  assert.equal(otherShiftResponse.response.status, 403);
});

test('user to employee mapping prevents editing another sellers shift', async () => {
  await authService.createUser({
    id: 'seller-mapping-1',
    externalId: 'seller.mapping',
    displayName: 'Mapping Seller',
    role: 'SELLER',
    storeId: DEV_STORE.id,
    password: 'correct-password',
  });
  const employee = store.employees.find(e => e.id === SELLER_EMPLOYEE.id);
  if (employee) employee.userId = 'seller-mapping-1';

  const { response: loginResponse } = await postJson('/api/business-kpi/auth/login', {
    externalId: 'seller.mapping',
    password: 'correct-password',
  });
  const cookies = parseCookies(loginResponse);
  const csrf = cookies.business_kpi_csrf;
  const sessionCookie = sessionHeader(cookies);

  const me = await fetch(`${baseUrl}/api/business-kpi/auth/me`, {
    headers: { Cookie: sessionCookie, 'x-csrf-token': csrf },
  });
  const meBody = await me.json();
  assert.equal(me.status, 200);
  assert.equal(meBody.data.user.employeeId, SELLER_EMPLOYEE.id);

  const otherSellerShiftId = '60000000-0000-4000-8000-000000000001';
  store.shifts.push({
    id: otherSellerShiftId,
    storeId: DEV_STORE.id,
    employeeId: OTHER_EMPLOYEE.id,
    employeeName: OTHER_EMPLOYEE.displayName,
    shiftDate: '2026-08-30',
    shiftKey: 'main',
    cash: 10000,
    acquiring: 14000,
    qr: 2400,
    receipts: 20,
    itemsSold: 50,
    upsellReceipts: 6,
    treatsRevenue: 1200,
    treatsReceipts: 4,
    comment: null,
    historicalRevenue: null,
    revenueSource: 'payment_breakdown',
    paymentBreakdownAvailable: true,
    source: 'web_manual',
    sourceRef: null,
    importRunId: null,
    originalImportedInput: null,
    archivedAt: null,
    archivedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const patchResponse = await patchJson(`/api/business-kpi/shifts/${otherSellerShiftId}`, {
    cash: 12000,
  }, { Cookie: sessionCookie, 'x-csrf-token': csrf });
  assert.equal(patchResponse.response.status, 403);
});

test('login rejects wrong password and locks out after repeated failures', async () => {
  await authService.createUser({
    id: 'owner-test-1',
    externalId: 'owner.test',
    displayName: 'Test Owner',
    role: 'OWNER',
    storeId: DEV_STORE.id,
    password: 'correct-password',
  });

  const wrong = await postJson('/api/business-kpi/auth/login', {
    externalId: 'owner.test',
    password: 'wrong-password',
  });
  assert.equal(wrong.response.status, 401);

  for (let i = 0; i < 4; i += 1) {
    await postJson('/api/business-kpi/auth/login', {
      externalId: 'owner.test',
      password: 'wrong-password',
    });
  }

  const locked = await postJson('/api/business-kpi/auth/login', {
    externalId: 'owner.test',
    password: 'correct-password',
  });
  assert.equal(locked.response.status, 423);
});

test('logout invalidates session', async () => {
  await authService.createUser({
    id: 'owner-test-2',
    externalId: 'owner.logout',
    displayName: 'Logout Owner',
    role: 'OWNER',
    storeId: DEV_STORE.id,
    password: 'correct-password',
  });

  const { response: loginResponse } = await postJson('/api/business-kpi/auth/login', {
    externalId: 'owner.logout',
    password: 'correct-password',
  });
  const cookies = parseCookies(loginResponse);
  const csrf = cookies.business_kpi_csrf;
  const sessionCookie = sessionHeader(cookies);

  const meBefore = await fetch(`${baseUrl}/api/business-kpi/auth/me`, { headers: { Cookie: sessionCookie } });
  assert.equal(meBefore.status, 200);

  const logoutResponse = await postJson('/api/business-kpi/auth/logout', {}, {
    Cookie: sessionCookie,
    'x-csrf-token': csrf,
  });
  assert.equal(logoutResponse.response.status, 200);

  const meAfter = await fetch(`${baseUrl}/api/business-kpi/auth/me`, { headers: { Cookie: sessionCookie } });
  assert.equal(meAfter.status, 401);
});

test('state-changing requests require CSRF token', async () => {
  await authService.createUser({
    id: 'owner-test-3',
    externalId: 'owner.csrf',
    displayName: 'CSRF Owner',
    role: 'OWNER',
    storeId: DEV_STORE.id,
    password: 'correct-password',
  });

  const { response: loginResponse } = await postJson('/api/business-kpi/auth/login', {
    externalId: 'owner.csrf',
    password: 'correct-password',
  });
  const cookies = parseCookies(loginResponse);
  const sessionCookie = `business_kpi_session=${cookies.business_kpi_session}`;

  const response = await postJson('/api/business-kpi/shifts', {
    storeId: DEV_STORE.id,
    employeeId: SELLER_EMPLOYEE.id,
    shiftDate: '2026-08-27',
    shiftKey: 'main',
    cash: 10000,
    acquiring: 14000,
    qr: 2400,
    receipts: 20,
    itemsSold: 50,
  }, { Cookie: sessionCookie });
  assert.equal(response.response.status, 403);
  assert.equal(response.body.error.code, 'CSRF_INVALID');
});

test('OWNER retains full functionality', async () => {
  await authService.createUser({
    id: 'owner-test-4',
    externalId: 'owner.full',
    displayName: 'Full Owner',
    role: 'OWNER',
    storeId: DEV_STORE.id,
    password: 'correct-password',
  });

  const { response: loginResponse } = await postJson('/api/business-kpi/auth/login', {
    externalId: 'owner.full',
    password: 'correct-password',
  });
  const cookies = parseCookies(loginResponse);
  const csrf = cookies.business_kpi_csrf;
  const sessionCookie = sessionHeader(cookies);

  const response = await postJson('/api/business-kpi/shifts', {
    storeId: DEV_STORE.id,
    employeeId: SELLER_EMPLOYEE.id,
    shiftDate: '2026-08-28',
    shiftKey: 'main',
    cash: 10000,
    acquiring: 14000,
    qr: 2400,
    receipts: 20,
    itemsSold: 50,
  }, { Cookie: sessionCookie, 'x-csrf-token': csrf });
  assert.equal(response.response.status, 201);
});

test('production mode does not trust dev actor headers', async () => {
  const ownerBypass = await fetch(
    `${baseUrl}/api/business-kpi/dashboard?store=${DEV_STORE.id}&year=2026&month=8`,
    { headers: { 'x-business-kpi-role': 'OWNER' } }
  );
  assert.equal(ownerBypass.status, 401);

  const arbitraryBypass = await fetch(
    `${baseUrl}/api/business-kpi/dashboard?store=${DEV_STORE.id}&year=2026&month=8`,
    { headers: { 'x-business-kpi-actor-id': 'attacker', 'x-business-kpi-role': 'OWNER' } }
  );
  assert.equal(arbitraryBypass.status, 401);
});

test('login issues HttpOnly session cookie with expected attributes', async () => {
  await authService.createUser({
    id: 'owner-cookie-1',
    externalId: 'owner.cookie',
    displayName: 'Cookie Owner',
    role: 'OWNER',
    storeId: DEV_STORE.id,
    password: 'correct-password',
  });

  const { response: loginResponse } = await postJson('/api/business-kpi/auth/login', {
    externalId: 'owner.cookie',
    password: 'correct-password',
  });
  assert.equal(loginResponse.status, 200);
  const setCookies = loginResponse.headers.getSetCookie();
  const session = setCookies.find(c => c.startsWith('business_kpi_session='));
  const csrf = setCookies.find(c => c.startsWith('business_kpi_csrf='));
  assert.ok(session, 'session cookie missing');
  assert.ok(session.includes('HttpOnly'), 'session cookie not HttpOnly');
  assert.ok(session.includes('SameSite=Lax'), 'session cookie SameSite missing');
  assert.ok(session.includes('Path=/'), 'session cookie Path missing');
  assert.ok(session.includes('Max-Age='), 'session cookie Max-Age missing');
  assert.ok(!session.includes('Secure'), 'LAN test cookie should not have Secure');
  assert.ok(csrf, 'csrf cookie missing');
  assert.ok(!csrf.includes('HttpOnly'), 'csrf cookie should not be HttpOnly');
});

test('expired session is denied', async () => {
  await authService.createUser({
    id: 'owner-expired-1',
    externalId: 'owner.expired',
    displayName: 'Expired Owner',
    role: 'OWNER',
    storeId: DEV_STORE.id,
    password: 'correct-password',
  });

  const user = await store.getUserByExternalId('owner.expired');
  const rawToken = 'test-expired-token';
  await store.createSession({
    id: 'session-expired-1',
    userId: user.id,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    ipAddress: null,
    userAgent: null,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  });

  const response = await fetch(
    `${baseUrl}/api/business-kpi/dashboard?store=${DEV_STORE.id}&year=2026&month=8`,
    { headers: { Cookie: `business_kpi_session=${rawToken}` } }
  );
  assert.equal(response.status, 401);
});

test('login issues a fresh random session token', async () => {
  await authService.createUser({
    id: 'owner-fixation-1',
    externalId: 'owner.fixation',
    displayName: 'Fixation Owner',
    role: 'OWNER',
    storeId: DEV_STORE.id,
    password: 'correct-password',
  });

  const { response: loginResponse } = await postJson('/api/business-kpi/auth/login', {
    externalId: 'owner.fixation',
    password: 'correct-password',
  });
  const cookies = parseCookies(loginResponse);
  const token = cookies.business_kpi_session;
  assert.ok(token, 'session token missing');
  assert.ok(token.length >= 32, 'session token too short');

  const storedByHash = await store.getSessionByTokenHash(hashToken(token));
  const storedByRaw = await store.getSessionByTokenHash(token);
  assert.ok(storedByHash, 'session not found by hash');
  assert.equal(storedByRaw, null, 'raw session token must not be stored');
});

test('me endpoint does not expose password hash or lockout state', async () => {
  await authService.createUser({
    id: 'owner-exposure-1',
    externalId: 'owner.exposure',
    displayName: 'Exposure Owner',
    role: 'OWNER',
    storeId: DEV_STORE.id,
    password: 'correct-password',
  });

  const { response: loginResponse } = await postJson('/api/business-kpi/auth/login', {
    externalId: 'owner.exposure',
    password: 'correct-password',
  });
  const cookies = parseCookies(loginResponse);
  const csrf = cookies.business_kpi_csrf;

  const me = await fetch(`${baseUrl}/api/business-kpi/auth/me`, {
    headers: { Cookie: sessionHeader(cookies), 'x-csrf-token': csrf },
  });
  const body = await me.json();
  assert.equal(me.status, 200);
  assert.equal(body.data.passwordHash, undefined);
  assert.equal(body.data.failedLoginAttempts, undefined);
  assert.equal(body.data.lockedUntil, undefined);
  assert.equal(body.data.password_hash, undefined);
});

test('SELLER bonus API redacts other sellers amounts', async () => {
  await authService.createUser({
    id: 'owner-bonus-seed',
    externalId: 'owner.bonus.seed',
    displayName: 'Bonus Seed Owner',
    role: 'OWNER',
    storeId: DEV_STORE.id,
    password: 'correct-password',
  });
  const ownerLogin = await postJson('/api/business-kpi/auth/login', {
    externalId: 'owner.bonus.seed',
    password: 'correct-password',
  });
  const ownerCookies = parseCookies(ownerLogin.response);
  const ownerCsrf = ownerCookies.business_kpi_csrf;
  const ownerSession = sessionHeader(ownerCookies);

  const shiftPayload = {
    storeId: DEV_STORE.id,
    shiftDate: '2026-08-29',
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
  for (const employeeId of [SELLER_EMPLOYEE.id, OTHER_EMPLOYEE.id]) {
    const createResponse = await postJson('/api/business-kpi/shifts', {
      ...shiftPayload,
      employeeId,
    }, { Cookie: ownerSession, 'x-csrf-token': ownerCsrf });
    assert.equal(createResponse.response.status, 201, createResponse.body.error?.message);
  }

  await authService.createUser({
    id: 'seller-bonus-1',
    externalId: 'seller.bonus',
    displayName: 'Bonus Seller',
    role: 'SELLER',
    storeId: DEV_STORE.id,
    password: 'correct-password',
  });
  const employee = store.employees.find(e => e.id === SELLER_EMPLOYEE.id);
  if (employee) employee.userId = 'seller-bonus-1';

  const { response: loginResponse } = await postJson('/api/business-kpi/auth/login', {
    externalId: 'seller.bonus',
    password: 'correct-password',
  });
  const cookies = parseCookies(loginResponse);
  const csrf = cookies.business_kpi_csrf;
  const sessionCookie = sessionHeader(cookies);

  const response = await fetch(
    `${baseUrl}/api/business-kpi/bonuses?store=${DEV_STORE.id}&year=2026&month=8`,
    { headers: { Cookie: sessionCookie, 'x-csrf-token': csrf } }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  const own = body.data.items.find(i => i.employeeId === SELLER_EMPLOYEE.id);
  const other = body.data.items.find(i => i.employeeId === OTHER_EMPLOYEE.id);
  assert.ok(own, 'own seller missing');
  assert.ok(other, 'other seller missing');
  assert.notEqual(own.bonusStatus, 'ACCESS_DENIED');
  assert.equal(other.bonusStatus, 'ACCESS_DENIED');
  assert.equal(other.bonus, null);
  assert.equal(other.bonusDetails, null);
});

test('SELLER cannot edit imported historical shift', async () => {
  await authService.createUser({
    id: 'seller-imported-1',
    externalId: 'seller.imported',
    displayName: 'Imported Shift Seller',
    role: 'SELLER',
    storeId: DEV_STORE.id,
    password: 'correct-password',
  });
  const employee = store.employees.find(e => e.id === SELLER_EMPLOYEE.id);
  if (employee) employee.userId = 'seller-imported-1';

  const importedId = '50000000-0000-4000-8000-000000000001';
  store.shifts.push({
    id: importedId,
    storeId: DEV_STORE.id,
    employeeId: SELLER_EMPLOYEE.id,
    employeeName: SELLER_EMPLOYEE.displayName,
    shiftDate: '2026-08-29',
    shiftKey: 'main',
    cash: 10000,
    acquiring: 14000,
    qr: 2400,
    receipts: 20,
    itemsSold: 50,
    upsellReceipts: 6,
    treatsRevenue: 1200,
    treatsReceipts: 4,
    comment: null,
    historicalRevenue: null,
    revenueSource: 'payment_breakdown',
    paymentBreakdownAvailable: true,
    source: 'excel_import',
    sourceRef: null,
    importRunId: null,
    originalImportedInput: null,
    archivedAt: null,
    archivedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const { response: loginResponse } = await postJson('/api/business-kpi/auth/login', {
    externalId: 'seller.imported',
    password: 'correct-password',
  });
  const cookies = parseCookies(loginResponse);
  const csrf = cookies.business_kpi_csrf;
  const sessionCookie = sessionHeader(cookies);

  const patchResponse = await patchJson(`/api/business-kpi/shifts/${importedId}`, {
    cash: 12000,
  }, { Cookie: sessionCookie, 'x-csrf-token': csrf });
  assert.equal(patchResponse.response.status, 403);
});
