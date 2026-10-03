CREATE TABLE IF NOT EXISTS business_kpi.onec_sync_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  source_instance text NOT NULL CHECK (btrim(source_instance) <> ''),
  contract_version text NOT NULL CHECK (btrim(contract_version) <> ''),
  payload_sha256 text NOT NULL CHECK (length(payload_sha256) = 64),
  status text NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  records_received integer NOT NULL DEFAULT 0 CHECK (records_received >= 0),
  records_applied integer NOT NULL DEFAULT 0 CHECK (records_applied >= 0),
  payload_json jsonb NOT NULL,
  result_json jsonb,
  error_json jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (completed_at IS NULL OR completed_at >= received_at)
);

CREATE INDEX IF NOT EXISTS business_kpi_onec_batches_received
  ON business_kpi.onec_sync_batches(received_at DESC);

CREATE TABLE IF NOT EXISTS business_kpi.onec_daily_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES business_kpi.onec_sync_batches(id) ON DELETE RESTRICT,
  source_instance text NOT NULL CHECK (btrim(source_instance) <> ''),
  external_record_id text NOT NULL CHECK (btrim(external_record_id) <> ''),
  store_id uuid NOT NULL REFERENCES business_kpi.stores(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES business_kpi.employees(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  cash_amount numeric(14,2) NOT NULL CHECK (cash_amount >= 0),
  acquiring_amount numeric(14,2) NOT NULL CHECK (acquiring_amount >= 0),
  qr_amount numeric(14,2) NOT NULL CHECK (qr_amount >= 0),
  b2b_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (b2b_amount >= 0),
  b2b_orders integer NOT NULL DEFAULT 0 CHECK (b2b_orders >= 0),
  receipts integer NOT NULL CHECK (receipts >= 0),
  items_sold integer CHECK (items_sold >= 0),
  returns_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (returns_amount >= 0),
  return_receipts integer NOT NULL DEFAULT 0 CHECK (return_receipts >= 0),
  source_updated_at timestamptz NOT NULL,
  payload_sha256 text NOT NULL CHECK (length(payload_sha256) = 64),
  payload_json jsonb NOT NULL,
  applied_shift_id uuid REFERENCES business_kpi.shifts(id) ON DELETE RESTRICT,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (qr_amount <= acquiring_amount),
  UNIQUE (source_instance, external_record_id)
);

CREATE INDEX IF NOT EXISTS business_kpi_onec_daily_sales_date
  ON business_kpi.onec_daily_sales(store_id, business_date DESC);

CREATE TABLE IF NOT EXISTS business_kpi.onec_sync_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text,
  source_instance text,
  contract_version text,
  payload_sha256 text CHECK (payload_sha256 IS NULL OR length(payload_sha256) = 64),
  error_code text NOT NULL CHECK (btrim(error_code) <> ''),
  error_message text NOT NULL CHECK (btrim(error_message) <> ''),
  error_details_json jsonb,
  payload_json jsonb,
  failed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_kpi_onec_failures_failed
  ON business_kpi.onec_sync_failures(failed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS business_kpi_onec_shift_source_ref
  ON business_kpi.shifts(source_ref)
  WHERE source = '1c' AND source_ref IS NOT NULL AND archived_at IS NULL;

INSERT INTO business_kpi.stores (id, code, name, timezone, active)
VALUES
  ('10000000-0000-4000-8000-000000000004', 'metiz-market', 'Метиз Маркет', 'Asia/Vladivostok', true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  timezone = EXCLUDED.timezone,
  active = true,
  updated_at = now();

INSERT INTO business_kpi.employees
  (id, store_id, employee_code, display_name, active)
VALUES
  ('20000000-0000-4000-8000-000000000103',
   '10000000-0000-4000-8000-000000000004',
   'metiz-market-store-input', 'Метиз Маркет · магазин', true)
ON CONFLICT (store_id, employee_code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  active = true,
  updated_at = now();
