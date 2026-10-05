ALTER TABLE business_kpi.onec_daily_sales
  DROP CONSTRAINT IF EXISTS onec_daily_sales_returns_breakdown_consistent,
  DROP CONSTRAINT IF EXISTS onec_daily_sales_net_retail_consistent,
  DROP CONSTRAINT IF EXISTS onec_daily_sales_qr_returns_nonnegative,
  DROP CONSTRAINT IF EXISTS onec_daily_sales_card_returns_nonnegative,
  DROP CONSTRAINT IF EXISTS onec_daily_sales_cash_returns_nonnegative,
  DROP CONSTRAINT IF EXISTS onec_daily_sales_retail_returns_nonnegative,
  DROP CONSTRAINT IF EXISTS onec_daily_sales_retail_sales_nonnegative,
  DROP COLUMN IF EXISTS organization_refs_json,
  DROP COLUMN IF EXISTS source_documents_json,
  DROP COLUMN IF EXISTS cashiers_json,
  DROP COLUMN IF EXISTS qr_returns_amount,
  DROP COLUMN IF EXISTS card_returns_amount,
  DROP COLUMN IF EXISTS cash_returns_amount,
  DROP COLUMN IF EXISTS retail_returns_amount,
  DROP COLUMN IF EXISTS retail_sales_amount;

-- Rollback requires any store-level Miska shadow records to be handled first.
ALTER TABLE business_kpi.onec_daily_sales
  ALTER COLUMN employee_id SET NOT NULL;
