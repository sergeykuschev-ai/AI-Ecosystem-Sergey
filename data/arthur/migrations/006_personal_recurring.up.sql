BEGIN;
CREATE TABLE IF NOT EXISTS arthur_personal_recurring (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES arthur_profiles(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(btrim(title)<>''),
 weekdays integer[] NOT NULL CHECK(cardinality(weekdays)>0 AND weekdays <@ ARRAY[1,2,3,4,5,6,7]),
 local_time text NOT NULL CHECK(local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 timezone text NOT NULL,
 start_date date NOT NULL,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE arthur_tasks ADD COLUMN IF NOT EXISTS recurring_id uuid REFERENCES arthur_personal_recurring(id);
ALTER TABLE arthur_tasks ADD COLUMN IF NOT EXISTS occurrence_date date;
CREATE UNIQUE INDEX IF NOT EXISTS arthur_tasks_recurring_occurrence ON arthur_tasks(recurring_id,occurrence_date) WHERE recurring_id IS NOT NULL;
COMMIT;
