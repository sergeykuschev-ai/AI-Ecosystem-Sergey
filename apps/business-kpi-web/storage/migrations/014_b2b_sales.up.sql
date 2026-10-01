ALTER TABLE business_kpi.shifts
  ADD COLUMN IF NOT EXISTS b2b_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS b2b_orders integer NOT NULL DEFAULT 0;

ALTER TABLE business_kpi.shifts
  ADD CONSTRAINT shifts_b2b_amount_check CHECK (b2b_amount >= 0),
  ADD CONSTRAINT shifts_b2b_orders_check CHECK (b2b_orders >= 0);
