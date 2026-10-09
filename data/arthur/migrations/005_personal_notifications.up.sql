BEGIN;
ALTER TABLE arthur_tasks ADD COLUMN IF NOT EXISTS remind_at timestamptz;
CREATE INDEX IF NOT EXISTS arthur_tasks_personal_reminders
  ON arthur_tasks(owner_id, remind_at)
  WHERE domain='personal' AND remind_at IS NOT NULL AND status NOT IN ('done','cancelled');

CREATE TABLE IF NOT EXISTS arthur_personal_deliveries (
  owner_id uuid NOT NULL REFERENCES arthur_profiles(id) ON DELETE CASCADE,
  delivery_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('sending','sent','retry')),
  claim_id uuid NOT NULL,
  lease_until timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  sent_at timestamptz,
  telegram_message_id bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id, delivery_key)
);
COMMIT;
