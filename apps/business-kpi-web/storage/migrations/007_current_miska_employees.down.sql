UPDATE business_kpi.employees
SET active = false,
    updated_at = now()
WHERE store_id = '10000000-0000-4000-8000-000000000001'
  AND employee_code IN ('seller-kapitanova', 'seller-cherednichenko');
