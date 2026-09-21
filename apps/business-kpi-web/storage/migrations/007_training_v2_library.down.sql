-- Remove only modules introduced by training v2; do not destructively revert rewritten legacy copy.
DELETE FROM business_kpi.seller_task_library
WHERE code IN ('KNOW-19', 'KNOW-20', 'KNOW-21', 'KNOW-22', 'KNOW-23', 'KNOW-24', 'KNOW-25');
