BEGIN;

CREATE TABLE IF NOT EXISTS arthur_automation_alert_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES arthur_profiles(id) ON DELETE CASCADE,
  alert_type text NOT NULL CHECK (alert_type IN ('plan_risk','seller_kpi_drop','qr_share','items_per_check','average_check','data_quality')),
  entity_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('ok','warning','critical')),
  last_value numeric,
  last_value_text text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  resolved_at timestamptz,
  sent_count integer NOT NULL DEFAULT 0,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, alert_type, entity_id)
);

CREATE INDEX IF NOT EXISTS arthur_automation_alert_state_lookup
  ON arthur_automation_alert_state(owner_id, alert_type, entity_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS arthur_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES arthur_profiles(id) ON DELETE CASCADE,
  run_type text NOT NULL CHECK (run_type IN ('daily','weekly','alert_evaluation')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  correlation_id uuid NOT NULL,
  result text NOT NULL CHECK (result IN ('success','failure','no_action')),
  error_code text,
  error_message text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS arthur_automation_runs_lookup
  ON arthur_automation_runs(owner_id, run_type, created_at DESC);

COMMIT;
