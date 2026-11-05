CREATE TABLE IF NOT EXISTS feedback (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('issue', 'feature')),
  description      TEXT NOT NULL,
  locale           TEXT NOT NULL,
  user_uid         TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  user_name        TEXT,
  workspace_id     TEXT,
  session_id       TEXT,
  app_version      TEXT NOT NULL,
  os_platform      TEXT NOT NULL,
  os_release       TEXT NOT NULL,
  os_arch          TEXT NOT NULL,
  product_edition  TEXT,
  region           TEXT NOT NULL,
  screenshots      JSONB NOT NULL DEFAULT '[]'::jsonb,
  feishu_record_id TEXT,
  synced_at        TIMESTAMPTZ,
  sync_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_user_uid_idx ON feedback (user_uid);
CREATE INDEX IF NOT EXISTS feedback_unsynced_idx ON feedback (created_at) WHERE synced_at IS NULL;
