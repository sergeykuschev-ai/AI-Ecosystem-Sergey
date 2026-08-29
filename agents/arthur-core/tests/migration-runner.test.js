'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, describe } = require('node:test');
const { Client } = require('pg');

const {
  runMigrations,
  ensureSchemaTable,
  loadAppliedMigrations,
  listMigrationFiles,
  computeChecksum,
  DEFAULT_MIGRATIONS_DIR,
  SCHEMA_TABLE,
} = require('../runtime/migration_runner');

const databaseUrl = process.env.ARTHUR_DATABASE_URL;

function shouldSkip() {
  return !databaseUrl || !/test|ci/.test(databaseUrl);
}

async function connect() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

async function cleanDatabase(client) {
  await client.query(`
    DROP TABLE IF EXISTS arthur_audit_events CASCADE;
    DROP TABLE IF EXISTS arthur_memory CASCADE;
    DROP TABLE IF EXISTS arthur_profiles CASCADE;
    DROP TABLE IF EXISTS arthur_tasks CASCADE;
    DROP TABLE IF EXISTS arthur_decisions CASCADE;
    DROP TABLE IF EXISTS arthur_confirmations CASCADE;
    DROP TABLE IF EXISTS ${SCHEMA_TABLE} CASCADE;
  `);
}

async function tableExists(client, tableName) {
  const result = await client.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = $1
  `, [tableName]);
  return result.rows.length > 0;
}

async function appliedCount(client) {
  const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${SCHEMA_TABLE}`);
  return result.rows[0].count;
}

describe('migration runner integration', { skip: shouldSkip() }, () => {
  test('clean database applies all migrations', async () => {
    const client = await connect();
    try {
      await cleanDatabase(client);
      const result = await runMigrations({ databaseUrl, migrationsDir: DEFAULT_MIGRATIONS_DIR });
      assert.equal(result.appliedCount, 2);
      assert.equal(result.skippedCount, 0);
      assert.equal(await appliedCount(client), 2);
      assert.equal(await tableExists(client, 'arthur_profiles'), true);
      assert.equal(await tableExists(client, 'arthur_tasks'), true);
      assert.equal(await tableExists(client, SCHEMA_TABLE), true);
    } finally {
      await client.end();
    }
  });

  test('second migration run is idempotent', async () => {
    const client = await connect();
    try {
      await cleanDatabase(client);
      await runMigrations({ databaseUrl, migrationsDir: DEFAULT_MIGRATIONS_DIR });
      const result = await runMigrations({ databaseUrl, migrationsDir: DEFAULT_MIGRATIONS_DIR });
      assert.equal(result.appliedCount, 0);
      assert.equal(result.skippedCount, 2);
      assert.equal(await appliedCount(client), 2);
    } finally {
      await client.end();
    }
  });

  test('existing initialized database is baseline-tracked without data loss', async () => {
    const client = await connect();
    try {
      await cleanDatabase(client);
      await runMigrations({ databaseUrl, migrationsDir: DEFAULT_MIGRATIONS_DIR });
      await client.query(`DELETE FROM ${SCHEMA_TABLE}`);
      assert.equal(await appliedCount(client), 0);

      const result = await runMigrations({ databaseUrl, migrationsDir: DEFAULT_MIGRATIONS_DIR });
      assert.equal(result.appliedCount, 0);
      assert.equal(result.skippedCount, 2);
      assert.equal(await appliedCount(client), 2);
      assert.equal(await tableExists(client, 'arthur_profiles'), true);
    } finally {
      await client.end();
    }
  });

  test('migration failure does not record partial migration', async () => {
    const client = await connect();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arthur-migrations-'));
    try {
      await cleanDatabase(client);
      fs.copyFileSync(
        path.join(DEFAULT_MIGRATIONS_DIR, '001_core_profile_memory_audit.up.sql'),
        path.join(tempDir, '001_core_profile_memory_audit.up.sql')
      );
      fs.copyFileSync(
        path.join(DEFAULT_MIGRATIONS_DIR, '002_tasks_decisions_confirmations.up.sql'),
        path.join(tempDir, '002_tasks_decisions_confirmations.up.sql')
      );
      fs.writeFileSync(path.join(tempDir, '003_bad_migration.up.sql'), `
        BEGIN;
        CREATE TABLE this_will_fail_syntax_error (
        COMMIT;
      `);

      let error;
      try {
        await runMigrations({ databaseUrl, migrationsDir: tempDir });
      } catch (e) {
        error = e;
      }

      assert.ok(error, 'Expected migration run to fail');
      assert.equal(await appliedCount(client), 2);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      await client.end();
    }
  });
});

describe('migration runner unit helpers', () => {
  test('computeChecksum is deterministic sha256', () => {
    const a = computeChecksum('hello');
    const b = computeChecksum('hello');
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  test('listMigrationFiles returns only .up.sql files sorted', () => {
    const files = listMigrationFiles(DEFAULT_MIGRATIONS_DIR);
    assert.ok(files.length >= 2);
    assert.ok(files.every(name => name.endsWith('.up.sql')));
    const sorted = [...files].sort();
    assert.deepEqual(files, sorted);
  });

  test('migrations use IF NOT EXISTS for idempotency', () => {
    const files = listMigrationFiles(DEFAULT_MIGRATIONS_DIR);
    for (const file of files) {
      const content = fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, file), 'utf8');
      const hasIdempotentTableChange = /CREATE TABLE IF NOT EXISTS arthur_/.test(content)
        || /ALTER TABLE[\s\S]*?IF NOT EXISTS/.test(content);
      assert.ok(hasIdempotentTableChange, `expected idempotent CREATE/ALTER TABLE in ${file}`);
      if (/CREATE INDEX/.test(content)) {
        assert.match(content, /CREATE INDEX IF NOT EXISTS/, `expected idempotent CREATE INDEX in ${file}`);
      }
    }
  });
});
