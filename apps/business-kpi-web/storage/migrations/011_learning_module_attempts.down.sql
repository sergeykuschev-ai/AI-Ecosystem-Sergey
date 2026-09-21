DROP INDEX IF EXISTS business_kpi.business_kpi_learning_attempts_module_created;

ALTER TABLE business_kpi.seller_learning_attempts
  DROP CONSTRAINT IF EXISTS seller_learning_attempts_module_scope_check;

ALTER TABLE business_kpi.seller_learning_attempts
  DROP CONSTRAINT IF EXISTS seller_learning_attempts_attempt_type_check;

ALTER TABLE business_kpi.seller_learning_attempts
  DROP COLUMN IF EXISTS module_code,
  DROP COLUMN IF EXISTS attempt_type;
