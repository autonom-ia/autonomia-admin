CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS admin.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin.user_organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES admin.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES admin.organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_organizations_status ON admin.organizations(status);
CREATE INDEX IF NOT EXISTS idx_admin_user_organizations_user_id ON admin.user_organizations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_admin_user_organizations_organization_id ON admin.user_organizations(organization_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_user_organizations_primary_user
  ON admin.user_organizations(user_id)
  WHERE is_primary = true AND status = 'active';

INSERT INTO admin.organizations (id, key, name, status)
VALUES ('14002337-5763-4000-8000-000000000001', 'autonomia', 'Autonom.ia', 'active')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  updated_at = now();

INSERT INTO admin.user_organizations (user_id, organization_id, role, is_primary, status)
SELECT
  u.id,
  o.id,
  'admin',
  true,
  'active'
FROM admin.users u
CROSS JOIN admin.organizations o
WHERE o.key = 'autonomia'
ON CONFLICT (user_id, organization_id) DO UPDATE SET
  is_primary = true,
  status = 'active',
  updated_at = now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_admin_product_customizations_organization'
  ) THEN
    ALTER TABLE admin.product_customizations
      ADD CONSTRAINT fk_admin_product_customizations_organization
      FOREIGN KEY (organization_id) REFERENCES admin.organizations(id) ON DELETE SET NULL;
  END IF;
END $$;
