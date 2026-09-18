DELETE FROM business_kpi.employees
WHERE employee_code IN ('amper-store-input', 'ventil-store-input')
  AND store_id IN (
    SELECT id FROM business_kpi.stores WHERE code IN ('amper', 'ventil')
  );

-- Store rows are intentionally retained on rollback because operational data
-- may already reference them. Removing those rows would be destructive.
