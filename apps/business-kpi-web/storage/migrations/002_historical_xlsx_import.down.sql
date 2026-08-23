DROP INDEX IF EXISTS business_kpi.business_kpi_import_runs_history;
ALTER TABLE business_kpi.shifts
  DROP CONSTRAINT IF EXISTS business_kpi_shift_revenue_source_check,
  DROP COLUMN IF EXISTS override_json,
  DROP COLUMN IF EXISTS original_imported_input_json,
  DROP COLUMN IF EXISTS source_reference_json,
  DROP COLUMN IF EXISTS payment_breakdown_available,
  DROP COLUMN IF EXISTS revenue_source,
  DROP COLUMN IF EXISTS historical_revenue;
ALTER TABLE business_kpi.import_runs
  DROP COLUMN IF EXISTS canonical_rows_json,
  DROP COLUMN IF EXISTS validation_report_json,
  DROP COLUMN IF EXISTS reconciliation_status,
  DROP COLUMN IF EXISTS errors_count,
  DROP COLUMN IF EXISTS warnings_count,
  DROP COLUMN IF EXISTS rows_skipped,
  DROP COLUMN IF EXISTS detected_month,
  DROP COLUMN IF EXISTS detected_year,
  DROP COLUMN IF EXISTS detected_version,
  DROP COLUMN IF EXISTS actor_id;
