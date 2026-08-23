'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  requirePostgresTestEnvironment,
} = require('./postgres/postgres_test_guard');

test('PostgreSQL integration refuses missing URL instead of using memory', () => {
  assert.throws(
    () => requirePostgresTestEnvironment({}),
    /never falls back to memory/
  );
});

test('PostgreSQL integration accepts only the named isolated test database', () => {
  assert.throws(
    () => requirePostgresTestEnvironment({
      BUSINESS_KPI_DATABASE_URL: 'postgresql://user:secret@postgres:5432/arthur',
      BUSINESS_KPI_TEST_DATABASE_NAME: 'business_kpi_test',
    }),
    /Refusing PostgreSQL integration/
  );
  const config = requirePostgresTestEnvironment({
    BUSINESS_KPI_DATABASE_URL: 'postgresql://user:secret@postgres:5432/business_kpi_test',
    BUSINESS_KPI_TEST_DATABASE_NAME: 'business_kpi_test',
  });
  assert.equal(config.databaseName, 'business_kpi_test');
  assert.equal(config.phase, 'full');
});
