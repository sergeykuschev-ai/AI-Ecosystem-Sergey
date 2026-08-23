'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DATABASE_SCHEMA,
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  loadConfig,
  resolveHttpPort,
} = require('../config');

test('configuration uses an isolated schema and a free local default port', () => {
  const config = loadConfig({});

  assert.equal(config.host, DEFAULT_HTTP_HOST);
  assert.equal(config.port, DEFAULT_HTTP_PORT);
  assert.equal(config.port, 3220);
  assert.equal(config.databaseSchema, DATABASE_SCHEMA);
  assert.equal(config.databaseSchema, 'business_kpi');
  assert.equal(config.databaseUrl, null);
  assert.equal(config.storageMode, 'memory');
});

test('configuration accepts the shared Arthur database URL', () => {
  const config = loadConfig({
    ARTHUR_DATABASE_URL: 'postgresql://arthur:secret@postgres:5432/arthur',
  });

  assert.equal(config.databaseUrl.includes('postgresql://'), true);
  assert.equal(config.storageMode, 'postgresql');
});

test('explicit PostgreSQL mode requires a database URL and memory rejects one', () => {
  assert.throws(
    () => loadConfig({ BUSINESS_KPI_STORAGE_MODE: 'postgresql' }),
    /DATABASE_URL is required/
  );
  assert.throws(
    () => loadConfig({
      BUSINESS_KPI_STORAGE_MODE: 'memory',
      BUSINESS_KPI_DATABASE_URL: 'postgresql://user:secret@postgres:5432/business_kpi_test',
    }),
    /must be unset/
  );
});

test('invalid HTTP ports fail with an actionable error', () => {
  assert.throws(() => resolveHttpPort('-1'), /between 0 and 65535/);
  assert.throws(() => resolveHttpPort('abc'), /between 0 and 65535/);
});
