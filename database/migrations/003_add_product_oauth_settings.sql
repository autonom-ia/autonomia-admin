ALTER TABLE admin.products
  ADD COLUMN IF NOT EXISTS oauth_client_id TEXT,
  ADD COLUMN IF NOT EXISTS allowed_redirect_uris TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allowed_logout_uris TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allowed_origins TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allow_google_login BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_github_login BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_email_password_login BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_passkey_login BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS access_token_ttl_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (access_token_ttl_seconds > 0),
  ADD COLUMN IF NOT EXISTS refresh_token_ttl_seconds INTEGER NOT NULL DEFAULT 2592000 CHECK (refresh_token_ttl_seconds > 0),
  ADD COLUMN IF NOT EXISTS auth_sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (auth_sync_status IN ('pending', 'synced', 'failed')),
  ADD COLUMN IF NOT EXISTS auth_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS auth_synced_at TIMESTAMPTZ;

UPDATE admin.products
SET oauth_client_id = key
WHERE oauth_client_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_products_oauth_client_id ON admin.products(oauth_client_id);
