'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PostgresBusinessKpiStore,
} = require('../storage/postgres_business_kpi_store');

const STARTED_AT = '2026-08-23T00:00:00.000Z';

function importRunRow(overrides = {}) {
  return {
    id: '70000000-0000-4000-8000-000000000001',
    store_id: '10000000-0000-4000-8000-000000000001',
    actor_id: 'local-owner',
    original_file_name: 'KPI-test.xlsx',
    source_checksum: 'test-checksum',
    status: 'PENDING',
    detected_version: null,
    detected_year: null,
    detected_month: null,
    rows_received: 0,
    rows_imported: 0,
    rows_skipped: 0,
    warnings_count: 0,
    errors_count: 0,
    reconciliation_status: 'NOT_RUN',
    validation_report_json: null,
    canonical_rows_json: null,
    started_at: STARTED_AT,
    completed_at: null,
    ...overrides,
  };
}

test('PostgresBusinessKpiStore serializes a top-level canonicalRows array for jsonb', async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (/^SELECT \* FROM business_kpi\.import_runs/u.test(sql)) {
        return { rows: [importRunRow()] };
      }
      const report = JSON.parse(values[14]);
      const canonicalRows = JSON.parse(values[15]);
      return {
        rows: [importRunRow({
          status: values[4],
          validation_report_json: report,
          canonical_rows_json: canonicalRows,
        })],
      };
    },
  };
  const store = new PostgresBusinessKpiStore({ client });
  const report = { rows: { read: 1, valid: 1 } };
  const canonicalRows = [{ shiftDate: '2026-05-01', receipts: 10 }];

  const updated = await store.updateImportRun(
    '70000000-0000-4000-8000-000000000001',
    { status: 'VALIDATING', report, canonicalRows }
  );

  const updateCall = calls.find(call => /^UPDATE business_kpi\.import_runs/u.test(call.sql));
  assert.equal(updateCall.values[14], JSON.stringify(report));
  assert.equal(updateCall.values[15], JSON.stringify(canonicalRows));
  assert.deepEqual(updated.canonicalRows, canonicalRows);
});
