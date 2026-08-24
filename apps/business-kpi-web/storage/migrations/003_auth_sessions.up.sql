CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Password presence for active users is enforced by the application layer.
-- A CHECK constraint is intentionally NOT added here so that existing active
-- users created before auth rollout do not block the migration. Once all
-- active users have password_hash set, a follow-up migration can add the
-- constraint safely.
ALTER TABLE business_kpi.users
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

CREATE TABLE IF NOT EXISTS business_kpi.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES business_kpi.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  ip_address inet,
  user_agent text,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS business_kpi_sessions_token_lookup
  ON business_kpi.user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS business_kpi_sessions_user_lookup
  ON business_kpi.user_sessions(user_id, expires_at DESC);
