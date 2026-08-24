CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE business_kpi.users
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD CONSTRAINT business_kpi_users_active_need_password
    CHECK (active = false OR password_hash IS NOT NULL AND btrim(password_hash) <> '');

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
