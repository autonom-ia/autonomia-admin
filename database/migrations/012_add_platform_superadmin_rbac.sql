INSERT INTO admin.roles (key, name, description, permissions, status)
VALUES (
  'platform_superadmin',
  'Platform Superadmin',
  'Acesso global explícito à plataforma Autonom.ia.',
  ARRAY[
    'admin.users.read',
    'admin.users.write',
    'admin.organizations.read',
    'admin.organizations.write',
    'admin.products.read',
    'admin.products.write',
    'admin.services.read',
    'admin.services.write',
    'financial.admin'
  ]::text[],
  'active'
)
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM admin.roles
    WHERE key = 'platform_superadmin'
      AND (
        status <> 'active'
        OR permissions <> ARRAY[
          'admin.users.read',
          'admin.users.write',
          'admin.organizations.read',
          'admin.organizations.write',
          'admin.products.read',
          'admin.products.write',
          'admin.services.read',
          'admin.services.write',
          'financial.admin'
        ]::text[]
      )
  ) THEN
    RAISE EXCEPTION 'Existing platform_superadmin role does not match the reviewed permission contract.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS admin.platform_role_bootstrap (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bootstrap_key TEXT NOT NULL UNIQUE CHECK (bootstrap_key = 'platform_superadmin'),
  user_id UUID NOT NULL UNIQUE REFERENCES admin.users(id) ON DELETE RESTRICT,
  role_id UUID NOT NULL REFERENCES admin.roles(id) ON DELETE RESTRICT,
  identity_sub UUID NOT NULL UNIQUE,
  email_at_bootstrap TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_user_roles_user_id
  ON admin.user_roles(user_id);

CREATE INDEX IF NOT EXISTS idx_admin_user_roles_role_id
  ON admin.user_roles(role_id);

CREATE OR REPLACE FUNCTION admin.protect_bootstrapped_platform_superadmin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, admin
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM admin.platform_role_bootstrap bootstrap
    WHERE bootstrap.bootstrap_key = 'platform_superadmin'
      AND bootstrap.user_id = OLD.id
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Bootstrapped platform superadmin is protected from generic mutation.';
    ELSIF NEW.status <> 'active'
       OR NEW.deleted_at IS NOT NULL
       OR lower(NEW.email) <> lower(OLD.email) THEN
      RAISE EXCEPTION 'Bootstrapped platform superadmin is protected from generic mutation.';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

DROP TRIGGER IF EXISTS protect_bootstrapped_platform_superadmin ON admin.users;
CREATE TRIGGER protect_bootstrapped_platform_superadmin
BEFORE UPDATE OR DELETE ON admin.users
FOR EACH ROW
EXECUTE FUNCTION admin.protect_bootstrapped_platform_superadmin();
