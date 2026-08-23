CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS business_kpi;

CREATE TABLE IF NOT EXISTS business_kpi.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  timezone text NOT NULL DEFAULT 'Asia/Vladivostok',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_kpi.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE CHECK (btrim(external_id) <> ''),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  role text NOT NULL CHECK (role IN ('OWNER', 'MANAGER', 'SELLER')),
  store_id uuid REFERENCES business_kpi.stores(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role = 'OWNER' OR store_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS business_kpi.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES business_kpi.stores(id) ON DELETE RESTRICT,
  user_id uuid UNIQUE REFERENCES business_kpi.users(id) ON DELETE SET NULL,
  employee_code text NOT NULL CHECK (btrim(employee_code) <> ''),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  active boolean NOT NULL DEFAULT true,
  hired_on date,
  terminated_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, employee_code),
  CHECK (terminated_on IS NULL OR hired_on IS NULL OR terminated_on >= hired_on)
);

CREATE TABLE IF NOT EXISTS business_kpi.import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES business_kpi.stores(id) ON DELETE RESTRICT,
  requested_by_user_id uuid REFERENCES business_kpi.users(id) ON DELETE SET NULL,
  source_type text NOT NULL CHECK (source_type IN ('excel_2026', 'manual', 'future_1c')),
  original_file_name text,
  source_checksum text,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'rejected')),
  rows_received integer NOT NULL DEFAULT 0 CHECK (rows_received >= 0),
  rows_imported integer NOT NULL DEFAULT 0 CHECK (rows_imported >= 0),
  diagnostics_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS business_kpi_import_source_once
  ON business_kpi.import_runs(store_id, source_checksum)
  WHERE source_checksum IS NOT NULL AND status = 'completed';

CREATE TABLE IF NOT EXISTS business_kpi.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES business_kpi.stores(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES business_kpi.employees(id) ON DELETE RESTRICT,
  import_run_id uuid REFERENCES business_kpi.import_runs(id) ON DELETE RESTRICT,
  shift_date date NOT NULL,
  shift_key text NOT NULL DEFAULT 'main' CHECK (btrim(shift_key) <> ''),
  cash_amount numeric(14,2) NOT NULL CHECK (cash_amount >= 0),
  acquiring_amount numeric(14,2) NOT NULL CHECK (acquiring_amount >= 0),
  qr_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (qr_amount >= 0),
  acquiring_includes_qr boolean NOT NULL DEFAULT true,
  receipts integer NOT NULL CHECK (receipts >= 0),
  items_sold integer NOT NULL CHECK (items_sold >= 0),
  upsell_receipts integer NOT NULL DEFAULT 0 CHECK (upsell_receipts >= 0),
  treats_revenue numeric(14,2) NOT NULL DEFAULT 0 CHECK (treats_revenue >= 0),
  treats_receipts integer NOT NULL DEFAULT 0 CHECK (treats_receipts >= 0),
  comment text,
  source text NOT NULL DEFAULT 'web_manual'
    CHECK (source IN ('web_manual', 'excel_import', '1c')),
  source_ref text,
  archived_at timestamptz,
  archived_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (qr_amount <= acquiring_amount),
  CHECK (upsell_receipts <= receipts),
  CHECK (treats_receipts <= receipts)
);

CREATE INDEX IF NOT EXISTS business_kpi_shifts_period_lookup
  ON business_kpi.shifts(store_id, shift_date, employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS business_kpi_active_shift_identity
  ON business_kpi.shifts(store_id, employee_id, shift_date, shift_key)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS business_kpi.monthly_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES business_kpi.stores(id) ON DELETE RESTRICT,
  plan_year integer NOT NULL CHECK (plan_year BETWEEN 2000 AND 2200),
  plan_month integer NOT NULL CHECK (plan_month BETWEEN 1 AND 12),
  revenue_plan numeric(14,2) NOT NULL CHECK (revenue_plan >= 0),
  source text NOT NULL,
  created_by_user_id uuid REFERENCES business_kpi.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, plan_year, plan_month)
);

CREATE TABLE IF NOT EXISTS business_kpi.kpi_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES business_kpi.stores(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  effective_from date NOT NULL,
  effective_to date,
  settings_json jsonb NOT NULL,
  source text NOT NULL,
  created_by_user_id uuid REFERENCES business_kpi.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS business_kpi_global_settings_version
  ON business_kpi.kpi_settings(version)
  WHERE store_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS business_kpi_store_settings_version
  ON business_kpi.kpi_settings(store_id, version)
  WHERE store_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS business_kpi.kpi_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES business_kpi.stores(id) ON DELETE RESTRICT,
  employee_id uuid REFERENCES business_kpi.employees(id) ON DELETE RESTRICT,
  shift_id uuid REFERENCES business_kpi.shifts(id) ON DELETE RESTRICT,
  settings_id uuid NOT NULL REFERENCES business_kpi.kpi_settings(id) ON DELETE RESTRICT,
  result_scope text NOT NULL CHECK (result_scope IN ('shift', 'month', 'year')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  calculation_version text NOT NULL,
  input_fingerprint text NOT NULL,
  result_json jsonb NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (result_scope <> 'shift' OR shift_id IS NOT NULL),
  UNIQUE (store_id, result_scope, input_fingerprint, calculation_version)
);

CREATE INDEX IF NOT EXISTS business_kpi_results_period_lookup
  ON business_kpi.kpi_results(store_id, period_start, period_end);

CREATE TABLE IF NOT EXISTS business_kpi.bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES business_kpi.stores(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES business_kpi.employees(id) ON DELETE RESTRICT,
  kpi_result_id uuid NOT NULL REFERENCES business_kpi.kpi_results(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL CHECK (status IN ('calculated', 'reviewed', 'approved', 'paid', 'cancelled')),
  calculation_details_json jsonb NOT NULL,
  approved_by_user_id uuid REFERENCES business_kpi.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (status NOT IN ('approved', 'paid') OR approved_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS business_kpi.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES business_kpi.users(id) ON DELETE SET NULL,
  actor_id text NOT NULL CHECK (btrim(actor_id) <> ''),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'system', 'import', 'future_1c')),
  action text NOT NULL CHECK (btrim(action) <> ''),
  entity_type text NOT NULL CHECK (btrim(entity_type) <> ''),
  entity_id text NOT NULL CHECK (btrim(entity_id) <> ''),
  old_value_json jsonb,
  new_value_json jsonb,
  source text NOT NULL CHECK (btrim(source) <> ''),
  reason text,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS business_kpi_audit_entity_lookup
  ON business_kpi.audit_log(entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS business_kpi_audit_correlation_lookup
  ON business_kpi.audit_log(correlation_id, occurred_at);

CREATE OR REPLACE FUNCTION business_kpi.reject_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'business_kpi.audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS business_kpi_audit_no_update ON business_kpi.audit_log;
CREATE TRIGGER business_kpi_audit_no_update
BEFORE UPDATE ON business_kpi.audit_log
FOR EACH ROW EXECUTE FUNCTION business_kpi.reject_audit_mutation();

DROP TRIGGER IF EXISTS business_kpi_audit_no_delete ON business_kpi.audit_log;
CREATE TRIGGER business_kpi_audit_no_delete
BEFORE DELETE ON business_kpi.audit_log
FOR EACH ROW EXECUTE FUNCTION business_kpi.reject_audit_mutation();
