CREATE TABLE IF NOT EXISTS business_kpi.seller_learning_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES business_kpi.stores(id),
  employee_id uuid NOT NULL REFERENCES business_kpi.employees(id),
  score integer NOT NULL CHECK (score >= 0),
  total integer NOT NULL CHECK (total > 0),
  percent numeric(5,2) NOT NULL CHECK (percent >= 0 AND percent <= 100),
  passed boolean NOT NULL,
  answers_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (score <= total)
);

CREATE INDEX IF NOT EXISTS business_kpi_learning_attempts_employee_created
  ON business_kpi.seller_learning_attempts(employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS business_kpi_learning_attempts_store_created
  ON business_kpi.seller_learning_attempts(store_id, created_at DESC);

GRANT ALL PRIVILEGES ON TABLE business_kpi.seller_learning_attempts TO business_kpi_app;
