BEGIN;
DROP TABLE IF EXISTS arthur_personal_deliveries;
DROP INDEX IF EXISTS arthur_tasks_personal_reminders;
ALTER TABLE arthur_tasks DROP COLUMN IF EXISTS remind_at;
COMMIT;
