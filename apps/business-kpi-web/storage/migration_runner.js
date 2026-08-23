'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const {
  DATABASE_SCHEMA,
  DEFAULT_MIGRATIONS_ROOT,
  resolveDatabaseUrl,
} = require('../config');

const MIGRATIONS_TABLE = `${DATABASE_SCHEMA}.schema_migrations`;

function computeChecksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function listMigrationFiles(migrationsRoot = DEFAULT_MIGRATIONS_ROOT) {
  return fs.readdirSync(migrationsRoot)
    .filter(fileName => fileName.endsWith('.up.sql'))
    .sort();
}

async function ensureMigrationsTable(client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${DATABASE_SCHEMA}`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function runMigrations(options = {}) {
  const env = options.env || process.env;
  const databaseUrl = options.databaseUrl || resolveDatabaseUrl(env);
  const migrationsRoot = options.migrationsRoot || DEFAULT_MIGRATIONS_ROOT;
  if (!databaseUrl) {
    throw new Error(
      'BUSINESS_KPI_DATABASE_URL or ARTHUR_DATABASE_URL is required'
    );
  }
  if ((env.NODE_ENV || 'development') === 'test' &&
      !/test/i.test(databaseUrl)) {
    throw new Error('Test migrations require a database URL containing "test"');
  }

  const client = options.client || new Client({ connectionString: databaseUrl });
  const ownsClient = !options.client;
  if (ownsClient) await client.connect();

  try {
    await ensureMigrationsTable(client);
    const appliedResult = await client.query(
      `SELECT version, checksum FROM ${MIGRATIONS_TABLE}`
    );
    const applied = new Map(
      appliedResult.rows.map(row => [row.version, row.checksum])
    );
    let appliedCount = 0;

    for (const fileName of listMigrationFiles(migrationsRoot)) {
      const version = fileName.replace(/\.up\.sql$/, '');
      const sql = fs.readFileSync(path.join(migrationsRoot, fileName), 'utf8');
      const checksum = computeChecksum(sql);
      if (applied.has(version)) {
        if (applied.get(version) !== checksum) {
          throw new Error(
            `Migration ${version} checksum mismatch; applied migrations are immutable`
          );
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (version, checksum) VALUES ($1, $2)`,
          [version, checksum]
        );
        await client.query('COMMIT');
        appliedCount += 1;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return {
      appliedCount,
      totalCount: listMigrationFiles(migrationsRoot).length,
    };
  } finally {
    if (ownsClient) await client.end();
  }
}

module.exports = {
  MIGRATIONS_TABLE,
  computeChecksum,
  ensureMigrationsTable,
  listMigrationFiles,
  runMigrations,
};
