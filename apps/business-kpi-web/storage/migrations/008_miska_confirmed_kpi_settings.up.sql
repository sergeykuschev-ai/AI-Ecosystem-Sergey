WITH canonical_settings AS (
  SELECT '{"version":1,"effectiveFrom":"2026-08-01","effectiveTo":null,"source":"KPI_Миска_08.2026_ИТОГ_эквайринг_включает_QR_BACKUP.xlsx","targets":{"shiftRevenue":24000,"sellerShifts":15,"averageCheck":1200,"itemsPerReceipt":2.5,"upsellReceiptShare":0.3,"treatsRevenue":1200,"treatsReceiptShare":0.2,"qrShare":null},"weights":{"shiftPlan":30,"averageCheck":20,"itemsPerReceipt":15,"upsell":20,"treats":15},"levels":[{"name":"Отлично","minimumScore":95,"bonusBase":7000},{"name":"Хорошо+","minimumScore":90,"bonusBase":5000},{"name":"Хорошо","minimumScore":85,"bonusBase":4000},{"name":"Минимум","minimumScore":75,"bonusBase":2500},{"name":"Без премии","minimumScore":0,"bonusBase":0}],"qrCoefficientTiers":[{"upperExclusive":0.1,"coefficient":0.95},{"upperExclusive":0.15,"coefficient":1},{"upperExclusive":0.2,"coefficient":1.025},{"upperExclusive":0.25,"coefficient":1.05},{"upperExclusive":null,"coefficient":1.075}],"fees":{"acquiring":0.022,"qr":0.007},"payment":{"qrIncludedInAcquiring":true},"unresolved":["Excel Settings does not define a standalone target QR share; QR is represented by coefficient tiers."]}'::jsonb AS settings_json
)
INSERT INTO business_kpi.kpi_settings
  (id, store_id, version, effective_from, effective_to, settings_json, source)
SELECT
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  1,
  DATE '2026-08-01',
  NULL,
  canonical_settings.settings_json,
  canonical_settings.settings_json->>'source'
FROM canonical_settings
ON CONFLICT (store_id, version) WHERE store_id IS NOT NULL DO NOTHING;
