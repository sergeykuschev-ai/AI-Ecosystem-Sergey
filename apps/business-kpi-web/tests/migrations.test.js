'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  computeChecksum,
  listMigrationFiles,
} = require('../storage/migration_runner');

const migrationsRoot = path.join(__dirname, '../storage/migrations');
const migrationPath = path.join(migrationsRoot, '001_initial_schema.up.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const importMigrationSql = fs.readFileSync(
  path.join(migrationsRoot, '002_historical_xlsx_import.up.sql'),
  'utf8'
);

test('initial migration owns the required isolated Business KPI entities', () => {
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS business_kpi/);
  for (const table of [
    'stores',
    'users',
    'employees',
    'shifts',
    'monthly_plans',
    'kpi_settings',
    'kpi_results',
    'bonuses',
    'audit_log',
    'import_runs',
  ]) {
    assert.match(
      sql,
      new RegExp(`CREATE TABLE IF NOT EXISTS business_kpi\\.${table}`)
    );
  }
});

test('migration supports required roles and append-only audit', () => {
  assert.match(sql, /'OWNER', 'MANAGER', 'SELLER'/);
  assert.match(sql, /business_kpi_active_shift_identity/);
  assert.match(sql, /archived_at timestamptz/);
  assert.match(sql, /old_value_json jsonb/);
  assert.match(sql, /new_value_json jsonb/);
  assert.match(sql, /source text NOT NULL/);
  assert.match(sql, /business_kpi_audit_no_update/);
  assert.match(sql, /business_kpi_audit_no_delete/);
});

test('migration files are ordered and checksummed deterministically', () => {
  assert.deepEqual(listMigrationFiles(migrationsRoot), [
    '001_initial_schema.up.sql',
    '002_historical_xlsx_import.up.sql',
  ]);
  assert.equal(computeChecksum(sql), computeChecksum(sql));
  assert.equal(computeChecksum(sql).length, 64);
});

test('historical import migration supports lifecycle, nullable facts, and idempotency', () => {
  for (const status of [
    'PENDING', 'VALIDATING', 'IMPORTING', 'RECONCILING', 'COMPLETED', 'FAILED',
  ]) {
    assert.match(importMigrationSql, new RegExp(`'${status}'`));
  }
  assert.match(importMigrationSql, /historical_revenue numeric\(14,2\)/);
  assert.match(importMigrationSql, /payment_breakdown_available boolean/);
  assert.match(importMigrationSql, /canonical_rows_json jsonb/);
  assert.match(importMigrationSql, /business_kpi_shift_revenue_source_check/);
  assert.match(importMigrationSql, /business_kpi_import_source_once/);
  assert.match(importMigrationSql, /business_kpi_import_runs_history/);
});
