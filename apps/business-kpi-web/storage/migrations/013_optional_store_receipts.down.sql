UPDATE business_kpi.shifts SET receipts = 0 WHERE receipts IS NULL;
ALTER TABLE business_kpi.shifts ALTER COLUMN receipts SET NOT NULL;
