'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertSafeDatabase,
  buildPoolConfig,
  createArthurRuntime
} = require('../runtime/create-runtime');

class FakePool {
  constructor(config) {
    this.config = config;
    this.queries = [];
    this.closed = false;
  }

  async query(text) {
    this.queries.push(text);
    if (text === 'SELECT 1 AS ok') return { rows: [{ ok: 1 }] };
    return { rows: [] };
  }

  async end() {
    this.closed = true;
  }
}

test('test runtime refuses a database without test or ci in its name', () => {
  assert.throws(() => assertSafeDatabase({
    connectionString: 'postgresql://arthur:secret@localhost:5432/arthur',
    nodeEnv: 'test'
  }), /test or ci/);
});

test('production-like database requires explicit opt-in', () => {
  assert.throws(() => assertSafeDatabase({
    connectionString: 'postgresql://arthur:secret@db:5432/arthur_prod',
    nodeEnv: 'production'
  }), /ARTHUR_ALLOW_PRODUCTION=true/);

  assert.doesNotThrow(() => assertSafeDatabase({
    connectionString: 'postgresql://arthur:secret@db:5432/arthur_prod',
    nodeEnv: 'production',
    allowProduction: true
  }));
});

test('pool configuration validates positive integer limits', () => {
  const config = buildPoolConfig({
    ARTHUR_DATABASE_URL: 'postgresql://arthur:secret@localhost:5432/arthur_test',
    NODE_ENV: 'test',
    ARTHUR_DB_POOL_MAX: '7',
    ARTHUR_DB_IDLE_TIMEOUT_MS: '12000',
    ARTHUR_DB_CONNECTION_TIMEOUT_MS: '4000'
  });

  assert.equal(config.max, 7);
  assert.equal(config.idleTimeoutMillis, 12000);
  assert.equal(config.connectionTimeoutMillis, 4000);

  assert.throws(() => buildPoolConfig({
    ARTHUR_DATABASE_URL: 'postgresql://arthur:secret@localhost:5432/arthur_test',
    NODE_ENV: 'test',
    ARTHUR_DB_POOL_MAX: '0'
  }), /positive integer/);
});

test('runtime wires pool, store and service and closes cleanly', async () => {
  const runtime = createArthurRuntime({
    env: {
      ARTHUR_DATABASE_URL: 'postgresql://arthur:secret@localhost:5432/arthur_test',
      NODE_ENV: 'test'
    },
    PoolClass: FakePool
  });

  assert.equal(runtime.pool.config.application_name, 'arthur-core');
  assert.equal(await runtime.healthcheck(), true);
  assert.deepEqual(runtime.pool.queries, ['SELECT 1 AS ok']);
  assert.ok(runtime.store);
  assert.ok(runtime.service);

  await runtime.close();
  assert.equal(runtime.pool.closed, true);
});
