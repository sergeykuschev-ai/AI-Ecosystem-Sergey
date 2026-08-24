DROP INDEX IF EXISTS business_kpi.business_kpi_sessions_user_lookup;
DROP INDEX IF EXISTS business_kpi.business_kpi_sessions_token_lookup;
DROP TABLE IF EXISTS business_kpi.user_sessions;

ALTER TABLE business_kpi.users
  DROP CONSTRAINT IF EXISTS business_kpi_users_active_need_password,
  DROP COLUMN IF EXISTS locked_until,
  DROP COLUMN IF EXISTS failed_login_attempts,
  DROP COLUMN IF EXISTS last_login_at,
  DROP COLUMN IF EXISTS password_hash;
