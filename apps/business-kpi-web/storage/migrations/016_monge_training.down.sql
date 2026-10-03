-- Remove Monge training and restore the previous sales sort order.
DELETE FROM business_kpi.seller_task_library
WHERE code = 'KNOW-26';

UPDATE business_kpi.seller_task_library
SET sort_order = sort_order - 1
WHERE task_type = 'SALES' AND sort_order >= 43;
