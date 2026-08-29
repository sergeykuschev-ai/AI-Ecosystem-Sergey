BEGIN;

ALTER TABLE arthur_automation_alert_state
  DROP COLUMN IF EXISTS last_alert_digest;

COMMIT;
