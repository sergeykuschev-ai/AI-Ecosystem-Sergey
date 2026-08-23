'use strict';

function requirePostgresTestEnvironment(env = process.env) {
  const databaseUrl = env.BUSINESS_KPI_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'BUSINESS_KPI_DATABASE_URL is required; PostgreSQL integration never falls back to memory storage.'
    );
  }
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('BUSINESS_KPI_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('BUSINESS_KPI_DATABASE_URL must use postgres or postgresql.');
  }
  const expectedDatabase = env.BUSINESS_KPI_TEST_DATABASE_NAME || 'business_kpi_test';
  const actualDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/test/iu.test(expectedDatabase) || actualDatabase !== expectedDatabase) {
    throw new Error(
      `Refusing PostgreSQL integration: expected isolated test database ${expectedDatabase}.`
    );
  }
  const phase = env.BUSINESS_KPI_POSTGRES_PHASE || 'full';
  if (!['full', 'verify-persistence'].includes(phase)) {
    throw new Error(
      'BUSINESS_KPI_POSTGRES_PHASE must be full or verify-persistence.'
    );
  }
  return {
    databaseUrl,
    databaseName: actualDatabase,
    baseUrl: env.BUSINESS_KPI_TEST_BASE_URL || 'http://127.0.0.1:3220',
    xlsxRoot: env.BUSINESS_KPI_REAL_XLSX_ROOT || null,
    phase,
  };
}

module.exports = { requirePostgresTestEnvironment };
