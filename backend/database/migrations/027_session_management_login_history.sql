ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS user_agent text, ADD COLUMN IF NOT EXISTS ip text;
CREATE TABLE IF NOT EXISTS login_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 email text,
 success boolean NOT NULL,
 reason text,
 ip text,
 user_agent text,
 school_id uuid REFERENCES schools(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_events_user_created_idx ON login_events(user_id,created_at DESC);
