-- Ensure the application role can manage auth sessions.
-- This fixes permission denied errors when the migration runner and application
-- connect with different PostgreSQL roles.
GRANT ALL PRIVILEGES ON TABLE business_kpi.user_sessions TO business_kpi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA business_kpi GRANT ALL ON TABLES TO business_kpi_app;
