'use strict';

const { TaskListingPostgresStore } = require('../services/task-listing-postgres-store');
const { TaskBriefingService } = require('../services/task-briefing-service');

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function parseDatabaseName(connectionString) {
  try {
    const url = new URL(connectionString);
    return url.pathname.replace(/^\//, '');
  } catch {
    throw new TypeError('ARTHUR_DATABASE_URL must be a valid PostgreSQL URL');
  }
}

function assertSafeDatabase({ connectionString, nodeEnv, allowProduction = false }) {
  requireString(connectionString, 'ARTHUR_DATABASE_URL');
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) {
    throw new TypeError('ARTHUR_DATABASE_URL must use postgresql:// or postgres://');
  }

  const databaseName = parseDatabaseName(connectionString).toLowerCase();
  const isTest = nodeEnv === 'test';
  const looksProduction = /(prod|production|live)/.test(databaseName);

  if (isTest && !/(test|ci)/.test(databaseName)) {
    throw new Error('Test runtime requires a database name containing test or ci');
  }

  if (looksProduction && !allowProduction) {
    throw new Error('Production-like Arthur database requires ARTHUR_ALLOW_PRODUCTION=true');
  }
}

function buildPoolConfig(env = process.env) {
  const connectionString = env.ARTHUR_DATABASE_URL;
  const nodeEnv = env.NODE_ENV || 'development';
  const allowProduction = env.ARTHUR_ALLOW_PRODUCTION === 'true';
  assertSafeDatabase({ connectionString, nodeEnv, allowProduction });

  const max = Number(env.ARTHUR_DB_POOL_MAX || 5);
  const idleTimeoutMillis = Number(env.ARTHUR_DB_IDLE_TIMEOUT_MS || 10000);
  const connectionTimeoutMillis = Number(env.ARTHUR_DB_CONNECTION_TIMEOUT_MS || 5000);

  for (const [name, value] of Object.entries({ max, idleTimeoutMillis, connectionTimeoutMillis })) {
    if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
  }

  return {
    connectionString,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    application_name: env.ARTHUR_DB_APPLICATION_NAME || 'arthur-core'
  };
}

function loadPoolClass() {
  try {
    return require('pg').Pool;
  } catch (error) {
    error.message = `Arthur Core runtime requires the pg package: ${error.message}`;
    throw error;
  }
}

function createArthurRuntime({ env = process.env, PoolClass, clock, idFactory } = {}) {
  const RuntimePool = PoolClass || loadPoolClass();
  const pool = new RuntimePool(buildPoolConfig(env));
  const store = new TaskListingPostgresStore({ client: pool });
  const service = new TaskBriefingService({ store, clock, idFactory });

  return {
    pool,
    store,
    service,
    async healthcheck() {
      const result = await pool.query('SELECT 1 AS ok');
      return Boolean(result.rows && result.rows[0] && Number(result.rows[0].ok) === 1);
    },
    async close() {
      if (typeof pool.end === 'function') await pool.end();
    }
  };
}

module.exports = {
  assertSafeDatabase,
  buildPoolConfig,
  createArthurRuntime
};