ALTER TABLE business_kpi.import_runs
  DROP CONSTRAINT IF EXISTS import_runs_status_check;

UPDATE business_kpi.import_runs SET status = upper(status);

ALTER TABLE business_kpi.import_runs
  ADD CONSTRAINT import_runs_status_check CHECK (
    status IN ('PENDING', 'VALIDATING', 'IMPORTING', 'RECONCILING', 'COMPLETED', 'FAILED')
  ),
  ADD COLUMN IF NOT EXISTS actor_id text,
  ADD COLUMN IF NOT EXISTS detected_version text,
  ADD COLUMN IF NOT EXISTS detected_year integer CHECK (detected_year BETWEEN 2000 AND 2200),
  ADD COLUMN IF NOT EXISTS detected_month integer CHECK (detected_month BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS rows_skipped integer NOT NULL DEFAULT 0 CHECK (rows_skipped >= 0),
  ADD COLUMN IF NOT EXISTS warnings_count integer NOT NULL DEFAULT 0 CHECK (warnings_count >= 0),
  ADD COLUMN IF NOT EXISTS errors_count integer NOT NULL DEFAULT 0 CHECK (errors_count >= 0),
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'NOT_RUN',
  ADD COLUMN IF NOT EXISTS validation_report_json jsonb,
  ADD COLUMN IF NOT EXISTS canonical_rows_json jsonb;

DROP INDEX IF EXISTS business_kpi.business_kpi_import_source_once;
CREATE UNIQUE INDEX IF NOT EXISTS business_kpi_import_source_once
  ON business_kpi.import_runs(store_id, source_checksum)
  WHERE source_checksum IS NOT NULL AND status = 'COMPLETED';

ALTER TABLE business_kpi.shifts
  ALTER COLUMN cash_amount DROP NOT NULL,
  ALTER COLUMN acquiring_amount DROP NOT NULL,
  ALTER COLUMN qr_amount DROP NOT NULL,
  ALTER COLUMN items_sold DROP NOT NULL,
  ALTER COLUMN upsell_receipts DROP NOT NULL,
  ALTER COLUMN treats_revenue DROP NOT NULL,
  ALTER COLUMN treats_receipts DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS historical_revenue numeric(14,2) CHECK (historical_revenue >= 0),
  ADD COLUMN IF NOT EXISTS revenue_source text NOT NULL DEFAULT 'payment_breakdown'
    CHECK (revenue_source IN ('payment_breakdown', 'historical_total')),
  ADD COLUMN IF NOT EXISTS payment_breakdown_available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source_reference_json jsonb,
  ADD COLUMN IF NOT EXISTS original_imported_input_json jsonb,
  ADD COLUMN IF NOT EXISTS override_json jsonb,
  ADD CONSTRAINT business_kpi_shift_revenue_source_check CHECK (
    (revenue_source = 'historical_total' AND historical_revenue IS NOT NULL
      AND cash_amount IS NULL AND acquiring_amount IS NULL AND qr_amount IS NULL
      AND payment_breakdown_available = false)
    OR
    (revenue_source = 'payment_breakdown' AND historical_revenue IS NULL
      AND cash_amount IS NOT NULL AND acquiring_amount IS NOT NULL AND qr_amount IS NOT NULL
      AND payment_breakdown_available = true)
  );

CREATE INDEX IF NOT EXISTS business_kpi_import_runs_history
  ON business_kpi.import_runs(store_id, started_at DESC);
