BEGIN;

CREATE TABLE IF NOT EXISTS arthur_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES arthur_profiles(id) ON DELETE CASCADE,
  domain text NOT NULL CHECK (domain IN ('personal','health','travel','content','business','purchasing','academy','finance','system')),
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','planned','in_progress','waiting','needs_confirmation','done','cancelled')),
  due_at timestamptz,
  next_step text,
  waiting_for text,
  next_check_at timestamptz,
  related_party text,
  source_type text NOT NULL,
  source_ref text,
  related_entities_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (status <> 'waiting' OR (waiting_for IS NOT NULL AND btrim(waiting_for) <> '' AND next_check_at IS NOT NULL)),
  CHECK (status <> 'done' OR completed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS arthur_tasks_owner_status ON arthur_tasks(owner_id, status, due_at);
CREATE INDEX IF NOT EXISTS arthur_tasks_waiting_check ON arthur_tasks(next_check_at) WHERE status = 'waiting';

CREATE TABLE IF NOT EXISTS arthur_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES arthur_profiles(id) ON DELETE CASCADE,
  domain text NOT NULL CHECK (domain IN ('personal','health','travel','content','business','purchasing','academy','finance','system')),
  decision text NOT NULL CHECK (btrim(decision) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  alternatives_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  author_id text NOT NULL,
  review_conditions text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','reversed')),
  supersedes_decision_id uuid REFERENCES arthur_decisions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (supersedes_decision_id IS NULL OR supersedes_decision_id <> id)
);

CREATE INDEX IF NOT EXISTS arthur_decisions_owner_domain ON arthur_decisions(owner_id, domain, created_at DESC);

CREATE TABLE IF NOT EXISTS arthur_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES arthur_profiles(id) ON DELETE CASCADE,
  domain text NOT NULL CHECK (domain IN ('personal','health','travel','content','business','purchasing','academy','finance','system')),
  skill_id text NOT NULL,
  action_type text NOT NULL,
  action_description text NOT NULL CHECK (btrim(action_description) <> ''),
  payload_json jsonb NOT NULL,
  payload_fingerprint char(64) NOT NULL CHECK (payload_fingerprint ~ '^[a-f0-9]{64}$'),
  risk text NOT NULL CHECK (risk IN ('low','medium','high')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','executed','failed')),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  decided_by text,
  executed_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (status = 'pending' OR decided_at IS NOT NULL OR status IN ('expired','failed')),
  CHECK (status <> 'executed' OR executed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS arthur_confirmations_pending ON arthur_confirmations(owner_id, expires_at) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS arthur_confirmations_one_pending_action
  ON arthur_confirmations(owner_id, skill_id, action_type, payload_fingerprint)
  WHERE status = 'pending';

COMMIT;
