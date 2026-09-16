DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'business_kpi_app'
  ) THEN
    CREATE ROLE business_kpi_app NOLOGIN;
  END IF;
END
$$;
