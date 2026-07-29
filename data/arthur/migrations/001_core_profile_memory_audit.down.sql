BEGIN;

DROP TRIGGER IF EXISTS arthur_audit_no_delete ON arthur_audit_events;
DROP TRIGGER IF EXISTS arthur_audit_no_update ON arthur_audit_events;
DROP FUNCTION IF EXISTS arthur_reject_audit_mutation();
DROP TABLE IF EXISTS arthur_audit_events;
DROP TABLE IF EXISTS arthur_memory;
DROP TABLE IF EXISTS arthur_profiles;

COMMIT;
