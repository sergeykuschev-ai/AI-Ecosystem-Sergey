ALTER TABLE business_kpi.stores
  ADD COLUMN IF NOT EXISTS qr_share_target numeric(6,5),
  ADD COLUMN IF NOT EXISTS qr_target_effective_from date;

ALTER TABLE business_kpi.stores
  ADD CONSTRAINT stores_qr_share_target_check
  CHECK (qr_share_target IS NULL OR (qr_share_target >= 0 AND qr_share_target <= 1));

UPDATE business_kpi.stores
SET qr_share_target = CASE code
      WHEN 'amper' THEN 0.20
      WHEN 'ventil' THEN 0.10
      ELSE qr_share_target
    END,
    qr_target_effective_from = CASE
      WHEN code IN ('amper','ventil') THEN DATE '2026-10-01'
      ELSE qr_target_effective_from
    END,
    updated_at = now()
WHERE code IN ('amper','ventil');
