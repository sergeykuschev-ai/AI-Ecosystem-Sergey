INSERT INTO business_kpi.stores (id, code, name, timezone, active)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'miska', 'Миска', 'Asia/Vladivostok', true),
  ('10000000-0000-4000-8000-000000000002', 'amper', 'Ампер', 'Asia/Vladivostok', true),
  ('10000000-0000-4000-8000-000000000003', 'ventil', 'Вентиль', 'Asia/Vladivostok', true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  timezone = EXCLUDED.timezone,
  active = true,
  updated_at = now();

INSERT INTO business_kpi.employees
  (id, store_id, employee_code, display_name, active)
VALUES
  ('20000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000002', 'amper-store-input', 'Ампер · магазин', true),
  ('20000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000003', 'ventil-store-input', 'Вентиль · магазин', true)
ON CONFLICT (store_id, employee_code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  active = true,
  updated_at = now();
