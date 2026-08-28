'use strict';

const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_HTTP_HOST = '127.0.0.1';
const DEFAULT_HTTP_PORT = 3220;
const DATABASE_SCHEMA = 'business_kpi';
const DEFAULT_PUBLIC_ROOT = path.join(__dirname, 'public');
const DEFAULT_MIGRATIONS_ROOT = path.join(__dirname, 'storage', 'migrations');

function resolveHttpHost(value) {
  const host = value === undefined ? DEFAULT_HTTP_HOST : String(value).trim();
  if (!host || /[\s/]/.test(host)) {
    throw new TypeError('BUSINESS_KPI_HTTP_HOST must be a valid host name');
  }
  return host;
}

function resolveHttpPort(value) {
  if (value === undefined || value === '') return DEFAULT_HTTP_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError(
      'BUSINESS_KPI_HTTP_PORT must be an integer between 0 and 65535'
    );
  }
  return port;
}

function resolveDatabaseUrl(env) {
  return env.BUSINESS_KPI_DATABASE_URL || env.ARTHUR_DATABASE_URL || null;
}

function resolveStorageMode(value, databaseUrl) {
  const mode = value === undefined || value === ''
    ? (databaseUrl ? 'postgresql' : 'memory')
    : String(value).trim().toLowerCase();
  if (!['memory', 'postgresql'].includes(mode)) {
    throw new TypeError('BUSINESS_KPI_STORAGE_MODE must be memory or postgresql');
  }
  if (mode === 'postgresql' && !databaseUrl) {
    throw new TypeError(
      'BUSINESS_KPI_DATABASE_URL is required when BUSINESS_KPI_STORAGE_MODE=postgresql'
    );
  }
  if (mode === 'memory' && databaseUrl) {
    throw new TypeError(
      'Database URL must be unset when BUSINESS_KPI_STORAGE_MODE=memory'
    );
  }
  return mode;
}

function resolveBoolean(value, defaultValue, fieldName) {
  if (value === undefined || value === '') return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new TypeError(`${fieldName} must be true or false`);
}

function resolveServiceKeys(value) {
  if (value === undefined || value === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new TypeError(
      `BUSINESS_KPI_SERVICE_KEYS must be a JSON array: ${error.message}`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new TypeError('BUSINESS_KPI_SERVICE_KEYS must be a JSON array');
  }
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError(`BUSINESS_KPI_SERVICE_KEYS[${index}] must be an object`);
    }
    if (typeof entry.id !== 'string' || !entry.id.trim()) {
      throw new TypeError(`BUSINESS_KPI_SERVICE_KEYS[${index}].id is required`);
    }
    if (typeof entry.key !== 'string' || !entry.key.trim()) {
      throw new TypeError(`BUSINESS_KPI_SERVICE_KEYS[${index}].key is required`);
    }
    return {
      id: entry.id.trim(),
      name: typeof entry.name === 'string' && entry.name.trim()
        ? entry.name.trim()
        : entry.id.trim(),
      key: entry.key.trim(),
    };
  });
}

function loadConfig(env = process.env) {
  const databaseUrl = resolveDatabaseUrl(env);
  const storageMode = resolveStorageMode(
    env.BUSINESS_KPI_STORAGE_MODE,
    databaseUrl
  );
  if ((env.NODE_ENV || 'development') === 'test' &&
      databaseUrl && !/test/i.test(databaseUrl)) {
    throw new Error('Test runs require a database URL containing "test"');
  }

  return Object.freeze({
    databaseUrl,
    databaseSchema: DATABASE_SCHEMA,
    storageMode,
    // Fail-closed: dev auth bypass and CSRF skip are opt-in only.
    devMode: resolveBoolean(
      env.BUSINESS_KPI_DEV_MODE,
      false,
      'BUSINESS_KPI_DEV_MODE'
    ),
    host: resolveHttpHost(env.BUSINESS_KPI_HTTP_HOST),
    port: resolveHttpPort(env.BUSINESS_KPI_HTTP_PORT),
    publicRoot: DEFAULT_PUBLIC_ROOT,
    seedReferenceData: resolveBoolean(
      env.BUSINESS_KPI_SEED_REFERENCE_DATA,
      false,
      'BUSINESS_KPI_SEED_REFERENCE_DATA'
    ),
    // Opt-in Secure cookie flag for HTTPS / trusted reverse proxy deployments.
    cookieSecure: resolveBoolean(
      env.BUSINESS_KPI_COOKIE_SECURE,
      false,
      'BUSINESS_KPI_COOKIE_SECURE'
    ),
    serviceKeys: resolveServiceKeys(env.BUSINESS_KPI_SERVICE_KEYS),
  });
}

module.exports = {
  DATABASE_SCHEMA,
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_MIGRATIONS_ROOT,
  DEFAULT_PUBLIC_ROOT,
  REPOSITORY_ROOT,
  loadConfig,
  resolveDatabaseUrl,
  resolveBoolean,
  resolveHttpHost,
  resolveHttpPort,
  resolveServiceKeys,
  resolveStorageMode,
};
