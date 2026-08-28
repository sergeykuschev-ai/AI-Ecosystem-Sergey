'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

const {
  createBusinessKpiClient,
  BusinessKpiConfigError,
  BusinessKpiAuthError,
  BusinessKpiNotFoundError,
  BusinessKpiServerError,
  BusinessKpiTimeoutError,
} = require('../skills/business_kpi/business_kpi_client');

function createFakeFetch(responses) {
  const calls = [];
  let index = 0;
  return {
    calls,
    async fetch(url, options) {
      calls.push({ url, options });
      const response = responses[index] ?? responses[responses.length - 1];
      index += 1;
      if (typeof response === 'function') {
        return response(url, options);
      }
      return response;
    },
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

const TEST_KEYS = [
  { id: 'arthur.analytics', name: 'Arthur Analytics', key: 'test-key-secret' },
];

function createTestClient(options = {}) {
  return createBusinessKpiClient({
    baseUrl: 'http://localhost:3000',
    serviceKeys: TEST_KEYS,
    serviceId: 'arthur.analytics',
    timeoutMs: 100,
    maxRetries: 0,
    ...options,
  });
}

function urlString(call) {
  return call && call.url ? String(call.url) : '';
}

describe('BusinessKpiClient configuration', () => {
  test('rejects missing base URL', () => {
    assert.throws(() => createBusinessKpiClient({ baseUrl: '', serviceKeys: TEST_KEYS }), BusinessKpiConfigError);
  });

  test('rejects invalid base URL', () => {
    assert.throws(() => createBusinessKpiClient({ baseUrl: 'not-a-url', serviceKeys: TEST_KEYS }), BusinessKpiConfigError);
  });

  test('rejects non-http protocol', () => {
    assert.throws(() => createBusinessKpiClient({ baseUrl: 'ftp://example.com', serviceKeys: TEST_KEYS }), BusinessKpiConfigError);
  });

  test('rejects missing service keys', () => {
    assert.throws(() => createBusinessKpiClient({ baseUrl: 'http://localhost:3000', serviceKeys: [] }), BusinessKpiConfigError);
  });

  test('rejects unknown service id', () => {
    assert.throws(() => createTestClient({ serviceId: 'unknown' }), BusinessKpiConfigError);
  });

  test('selects configured service key and strips trailing slash from base URL', () => {
    const client = createBusinessKpiClient({
      baseUrl: 'http://localhost:3000/',
      serviceKeys: TEST_KEYS,
      serviceId: 'arthur.analytics',
      timeoutMs: 100,
      maxRetries: 0,
    });
    assert.equal(client.baseUrl, 'http://localhost:3000');
    assert.equal(client.serviceId, 'arthur.analytics');
    assert.equal(client.apiKey, 'test-key-secret');
  });
});

describe('BusinessKpiClient requests', () => {
  test('sends Bearer authorization and query parameters', async () => {
    const fake = createFakeFetch([jsonResponse(200, { data: { ok: true } })]);
    const client = createTestClient({ fetchImpl: fake.fetch });
    await client.getDashboard({ storeId: 'miska', year: 2026, month: 8 });

    assert.equal(fake.calls.length, 1);
    const url = urlString(fake.calls[0]);
    assert.ok(url.includes('/api/business-kpi/dashboard'));
    assert.ok(url.includes('store=miska'));
    assert.ok(url.includes('year=2026'));
    assert.ok(url.includes('month=8'));
    assert.equal(fake.calls[0].options.headers.authorization, 'Bearer test-key-secret');
    assert.equal(fake.calls[0].options.method, 'GET');
  });

  test('returns nested data envelope', async () => {
    const fake = createFakeFetch([jsonResponse(200, { data: { revenue: 100 } })]);
    const client = createTestClient({ fetchImpl: fake.fetch });
    const result = await client.getDashboard({ storeId: 'miska', year: 2026, month: 8 });
    assert.equal(result.revenue, 100);
  });

  test('returns top-level data when no envelope', async () => {
    const fake = createFakeFetch([jsonResponse(200, { revenue: 200 })]);
    const client = createTestClient({ fetchImpl: fake.fetch });
    const result = await client.getDashboard({ storeId: 'miska', year: 2026, month: 8 });
    assert.equal(result.revenue, 200);
  });

  test('throws auth error on 401', async () => {
    const fake = createFakeFetch([jsonResponse(401, { error: 'Unauthorized' })]);
    const client = createTestClient({ fetchImpl: fake.fetch });
    await assert.rejects(client.health(), BusinessKpiAuthError);
  });

  test('throws auth error on 403', async () => {
    const fake = createFakeFetch([jsonResponse(403, { error: 'Forbidden' })]);
    const client = createTestClient({ fetchImpl: fake.fetch });
    await assert.rejects(client.getSellers({}), BusinessKpiAuthError);
  });

  test('throws not found on 404', async () => {
    const fake = createFakeFetch([jsonResponse(404, { error: 'Not found' })]);
    const client = createTestClient({ fetchImpl: fake.fetch });
    await assert.rejects(client.getShift('shift-1'), BusinessKpiNotFoundError);
  });

  test('throws server error on 500', async () => {
    const fake = createFakeFetch([jsonResponse(500, { error: 'Server error' })]);
    const client = createTestClient({ fetchImpl: fake.fetch });
    await assert.rejects(client.getBonuses({}), BusinessKpiServerError);
  });

  test('throws timeout error on abort', async () => {
    const fake = createFakeFetch([
      async () => {
        throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
      },
    ]);
    const client = createTestClient({ fetchImpl: fake.fetch });
    await assert.rejects(client.health(), BusinessKpiTimeoutError);
  });

  test('retries idempotent GET on server error then succeeds', async () => {
    const fake = createFakeFetch([
      jsonResponse(503, { error: 'Unavailable' }),
      jsonResponse(200, { data: { ok: true } }),
    ]);
    const client = createTestClient({ fetchImpl: fake.fetch, maxRetries: 2 });
    const result = await client.health();
    assert.equal(result.ok, true);
    assert.equal(fake.calls.length, 2);
  });

  test('omits null/empty query values', async () => {
    const fake = createFakeFetch([jsonResponse(200, { data: [] })]);
    const client = createTestClient({ fetchImpl: fake.fetch });
    await client.getShifts({ storeId: 'miska', employeeId: null, year: 2026, month: 8, dateFrom: '', dateTo: undefined });
    const url = urlString(fake.calls[0]);
    assert.ok(url.includes('store=miska'));
    assert.ok(url.includes('year=2026'));
    assert.ok(url.includes('month=8'));
    assert.ok(!url.includes('employee'));
    assert.ok(!url.includes('date_from'));
    assert.ok(!url.includes('date_to'));
  });
});
