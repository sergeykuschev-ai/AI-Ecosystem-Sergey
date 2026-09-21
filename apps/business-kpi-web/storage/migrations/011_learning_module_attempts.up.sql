ALTER TABLE business_kpi.seller_learning_attempts
  ADD COLUMN IF NOT EXISTS attempt_type text NOT NULL DEFAULT 'CERTIFICATION',
  ADD COLUMN IF NOT EXISTS module_code text;

ALTER TABLE business_kpi.seller_learning_attempts
  DROP CONSTRAINT IF EXISTS seller_learning_attempts_attempt_type_check;

ALTER TABLE business_kpi.seller_learning_attempts
  ADD CONSTRAINT seller_learning_attempts_attempt_type_check
  CHECK (attempt_type IN ('CERTIFICATION', 'MODULE'));

ALTER TABLE business_kpi.seller_learning_attempts
  DROP CONSTRAINT IF EXISTS seller_learning_attempts_module_scope_check;

ALTER TABLE business_kpi.seller_learning_attempts
  ADD CONSTRAINT seller_learning_attempts_module_scope_check
  CHECK (
    (attempt_type = 'CERTIFICATION' AND module_code IS NULL)
    OR
    (attempt_type = 'MODULE' AND module_code IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS business_kpi_learning_attempts_module_created
  ON business_kpi.seller_learning_attempts(employee_id, module_code, created_at DESC)
  WHERE attempt_type = 'MODULE';
