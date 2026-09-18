INSERT INTO business_kpi.employees
  (id, store_id, employee_code, display_name, active)
VALUES
  (
    '20000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    'seller-kapitanova',
    'Капитанова',
    true
  ),
  (
    '20000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000001',
    'seller-cherednichenko',
    'Чередниченко',
    true
  )
ON CONFLICT (store_id, employee_code) DO UPDATE
SET display_name = EXCLUDED.display_name,
    active = true,
    terminated_on = NULL,
    updated_at = now();
