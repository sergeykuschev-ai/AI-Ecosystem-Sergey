'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'arthur', 'migrations');
const SCHEMA_TABLE = 'arthur_migrations';

function log(level, message, meta = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event: 'migration',
    message,
    ...meta,
  }));
}

function computeChecksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

async function ensureSchemaTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA_TABLE} (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now(),
      checksum text NOT NULL,
      execution_time_ms integer NOT NULL
    );
  `);
}

async function loadAppliedMigrations(client) {
  const result = await client.query(`SELECT version, checksum FROM ${SCHEMA_TABLE}`);
  return new Map(result.rows.map(row => [row.version, row.checksum]));
}

function listMigrationFiles(migrationsDir) {
  return fs.readdirSync(migrationsDir)
    .filter(name => name.endsWith('.up.sql'))
    .sort();
}

async function runMigration(client, migrationsDir, fileName, applied) {
  const version = fileName.replace(/\.up\.sql$/, '');
  const filePath = path.join(migrationsDir, fileName);
  const content = fs.readFileSync(filePath, 'utf8');
  const checksum = computeChecksum(content);

  if (applied.has(version)) {
    const existingChecksum = applied.get(version);
    if (existingChecksum !== checksum) {
      throw new Error(`Migration ${version} checksum mismatch: expected ${existingChecksum}, found ${checksum}. Do not modify applied migrations.`);
    }
    log('info', `Migration already applied`, { version, checksum });
    return { applied: false, version };
  }

  const startTime = Date.now();
  await client.query('BEGIN');
  try {
    await client.query(content);
    await client.query(
      `INSERT INTO ${SCHEMA_TABLE} (version, checksum, execution_time_ms) VALUES ($1, $2, $3)`,
      [version, checksum, Date.now() - startTime]
    );
    await client.query('COMMIT');
    log('info', `Migration applied`, { version, checksum, executionTimeMs: Date.now() - startTime });
    return { applied: true, version };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function runMigrations(options = {}) {
  const databaseUrl = options.databaseUrl || process.env.ARTHUR_DATABASE_URL;
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;

  if (!databaseUrl) {
    throw new Error('ARTHUR_DATABASE_URL is required');
  }

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    log('info', 'Connected to database');

    await ensureSchemaTable(client);
    const applied = await loadAppliedMigrations(client);
    const files = listMigrationFiles(migrationsDir);

    if (files.length === 0) {
      log('warn', 'No migration files found', { migrationsDir });
      return { appliedCount: 0, totalCount: 0, skippedCount: 0 };
    }

    let appliedCount = 0;
    let skippedCount = 0;
    for (const fileName of files) {
      const result = await runMigration(client, migrationsDir, fileName, applied);
      if (result.applied) {
        appliedCount += 1;
      } else {
        skippedCount += 1;
      }
    }

    log('info', 'Migration run complete', { appliedCount, skippedCount, totalCount: files.length });
    return { appliedCount, skippedCount, totalCount: files.length };
  } finally {
    await client.end();
  }
}

async function main() {
  try {
    await runMigrations();
  } catch (error) {
    log('error', 'Migration run failed', { errorMessage: error.message });
    process.exitCode = 1;
  }
}

module.exports = {
  ensureSchemaTable,
  loadAppliedMigrations,
  runMigration,
  listMigrationFiles,
  computeChecksum,
  runMigrations,
  DEFAULT_MIGRATIONS_DIR,
  SCHEMA_TABLE,
};

if (require.main === module) {
  main();
}
