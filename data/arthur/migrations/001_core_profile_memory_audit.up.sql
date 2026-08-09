BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS arthur_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  timezone text NOT NULL,
  locale text NOT NULL DEFAULT 'ru-RU',
  preferred_channel text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arthur_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES arthur_profiles(id) ON DELETE CASCADE,
  domain text NOT NULL CHECK (domain IN ('personal','health','travel','content','business','purchasing','academy','finance','system')),
  type text NOT NULL CHECK (type IN ('fact','preference','policy','project_state','reference')),
  key text NOT NULL CHECK (btrim(key) <> ''),
  value_json jsonb NOT NULL,
  source_type text NOT NULL,
  source_ref text,
  confidence numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  sensitivity text NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal','sensitive','restricted')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS arthur_memory_one_active_key
  ON arthur_memory(owner_id, domain, key)
  WHERE status = 'active' AND valid_to IS NULL;

CREATE INDEX IF NOT EXISTS arthur_memory_lookup
  ON arthur_memory(owner_id, domain, key, created_at DESC);

CREATE TABLE IF NOT EXISTS arthur_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user','system','skill','automation')),
  domain text NOT NULL CHECK (domain IN ('personal','health','travel','content','business','purchasing','academy','finance','system')),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  before_json jsonb,
  after_json jsonb,
  correlation_id uuid NOT NULL,
  result text NOT NULL CHECK (result IN ('success','failure')),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS arthur_audit_entity_lookup
  ON arthur_audit_events(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS arthur_audit_correlation_lookup
  ON arthur_audit_events(correlation_id, created_at);

CREATE OR REPLACE FUNCTION arthur_reject_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'arthur_audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS arthur_audit_no_update ON arthur_audit_events;
CREATE TRIGGER arthur_audit_no_update
BEFORE UPDATE ON arthur_audit_events
FOR EACH ROW EXECUTE FUNCTION arthur_reject_audit_mutation();

DROP TRIGGER IF EXISTS arthur_audit_no_delete ON arthur_audit_events;
CREATE TRIGGER arthur_audit_no_delete
BEFORE DELETE ON arthur_audit_events
FOR EACH ROW EXECUTE FUNCTION arthur_reject_audit_mutation();

COMMIT;
