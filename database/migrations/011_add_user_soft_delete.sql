ALTER TABLE admin.users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_admin_users_deleted_at
  ON admin.users(deleted_at);
