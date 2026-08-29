BEGIN;

ALTER TABLE arthur_automation_alert_state
  ADD COLUMN IF NOT EXISTS last_alert_digest text;

COMMIT;
