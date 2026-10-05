ALTER TABLE business_kpi.onec_daily_sales
  ALTER COLUMN employee_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS retail_sales_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS retail_returns_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_returns_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS card_returns_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qr_returns_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cashiers_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_documents_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS organization_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE business_kpi.onec_daily_sales
SET retail_sales_amount = cash_amount + acquiring_amount + returns_amount,
    retail_returns_amount = returns_amount
WHERE retail_sales_amount IS NULL;

ALTER TABLE business_kpi.onec_daily_sales
  ALTER COLUMN retail_sales_amount SET NOT NULL,
  ADD CONSTRAINT onec_daily_sales_retail_sales_nonnegative
    CHECK (retail_sales_amount >= 0),
  ADD CONSTRAINT onec_daily_sales_retail_returns_nonnegative
    CHECK (retail_returns_amount >= 0),
  ADD CONSTRAINT onec_daily_sales_cash_returns_nonnegative
    CHECK (cash_returns_amount >= 0),
  ADD CONSTRAINT onec_daily_sales_card_returns_nonnegative
    CHECK (card_returns_amount >= 0),
  ADD CONSTRAINT onec_daily_sales_qr_returns_nonnegative
    CHECK (qr_returns_amount >= 0),
  ADD CONSTRAINT onec_daily_sales_net_retail_consistent
    CHECK (abs((retail_sales_amount - retail_returns_amount) -
               (cash_amount + acquiring_amount)) <= 0.01),
  ADD CONSTRAINT onec_daily_sales_returns_breakdown_consistent
    CHECK ((cash_returns_amount + card_returns_amount + qr_returns_amount) = 0 OR
           abs(retail_returns_amount -
               (cash_returns_amount + card_returns_amount + qr_returns_amount)) <= 0.01);
