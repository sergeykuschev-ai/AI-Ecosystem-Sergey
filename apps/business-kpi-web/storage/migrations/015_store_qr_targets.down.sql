ALTER TABLE business_kpi.stores
  DROP CONSTRAINT IF EXISTS stores_qr_share_target_check;

ALTER TABLE business_kpi.stores
  DROP COLUMN IF EXISTS qr_target_effective_from,
  DROP COLUMN IF EXISTS qr_share_target;
