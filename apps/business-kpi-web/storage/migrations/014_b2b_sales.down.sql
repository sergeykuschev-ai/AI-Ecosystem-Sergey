ALTER TABLE business_kpi.shifts
  DROP CONSTRAINT IF EXISTS shifts_b2b_orders_check,
  DROP CONSTRAINT IF EXISTS shifts_b2b_amount_check;

ALTER TABLE business_kpi.shifts
  DROP COLUMN IF EXISTS b2b_orders,
  DROP COLUMN IF EXISTS b2b_amount;
