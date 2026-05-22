CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS admin.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO admin.profiles (key, name, description, status)
VALUES ('autonomia_master', 'Autonomia Master', 'Perfil administrativo inicial da Autonom.ia.', 'active')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  updated_at = now();

ALTER TABLE admin.users
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES admin.profiles(id);

UPDATE admin.users
SET profile_id = (SELECT id FROM admin.profiles WHERE key = 'autonomia_master')
WHERE profile_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_users_profile_id ON admin.users(profile_id);

CREATE TABLE IF NOT EXISTS admin.product_customizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES admin.products(id) ON DELETE CASCADE,
  organization_id UUID,
  user_id UUID,
  domain TEXT NOT NULL,
  display_name TEXT,
  logo_url TEXT,
  favicon_url TEXT,
  primary_color TEXT,
  accent_color TEXT,
  background_color TEXT,
  text_color TEXT,
  theme_tokens JSONB NOT NULL DEFAULT '{}',
  custom_css JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_admin_product_customizations_product_id ON admin.product_customizations(product_id);
CREATE INDEX IF NOT EXISTS idx_admin_product_customizations_domain ON admin.product_customizations(domain);
