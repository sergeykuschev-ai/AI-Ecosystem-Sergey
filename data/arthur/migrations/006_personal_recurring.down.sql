BEGIN;
ALTER TABLE arthur_tasks DROP COLUMN occurrence_date;
ALTER TABLE arthur_tasks DROP COLUMN recurring_id;
DROP TABLE arthur_personal_recurring;
COMMIT;
