'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');

const {
  createBusinessKpiWebServer,
  startBusinessKpiWebServer,
} = require('../server');
const { loadConfig } = require('../config');

function postgresConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    BUSINESS_KPI_DATABASE_URL: 'postgresql://user:secret@postgres:5432/business_kpi_test',
    BUSINESS_KPI_STORAGE_MODE: 'postgresql',
    BUSINESS_KPI_SEED_REFERENCE_DATA: 'false',
    BUSINESS_KPI_HTTP_PORT: '0',
  });
}

test('PostgreSQL mode fails startup and closes storage when preflight fails', async () => {
  let closed = false;
  const store = {
    checkHealth: async () => { throw new Error('database unavailable'); },
    close: async () => { closed = true; },
  };
  await assert.rejects(
    () => startBusinessKpiWebServer({ config: postgresConfig(), store }),
    /database unavailable/
  );
  assert.equal(closed, true);
});

test('PostgreSQL health endpoint returns 503 when a live check fails', async () => {
  const store = {
    checkHealth: async () => { throw new Error('secret connection detail'); },
    close: async () => {},
  };
  const server = createBusinessKpiWebServer({ config: postgresConfig(), store });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.data.status, 'degraded');
    assert.equal(body.data.storage.provider, 'postgresql');
    assert.equal(body.data.storage.checked, true);
    assert.equal(body.data.storage.healthy, false);
    assert.doesNotMatch(JSON.stringify(body), /secret connection detail/);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
