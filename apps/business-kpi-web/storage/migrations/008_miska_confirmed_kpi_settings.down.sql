UPDATE business_kpi.kpi_settings
SET effective_to = effective_from
WHERE id = '30000000-0000-4000-8000-000000000001'
  AND store_id = '10000000-0000-4000-8000-000000000001'
  AND version = 1
  AND effective_to IS NULL;
