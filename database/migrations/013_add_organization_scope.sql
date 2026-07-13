DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM admin.user_organizations
    WHERE role NOT IN ('admin', 'member')
  ) THEN
    RAISE EXCEPTION 'Existing organization membership role is outside the reviewed admin/member contract.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_admin_user_organizations_role'
      AND conrelid = 'admin.user_organizations'::regclass
  ) THEN
    ALTER TABLE admin.user_organizations
      ADD CONSTRAINT ck_admin_user_organizations_role
      CHECK (role IN ('admin', 'member')) NOT VALID;
  END IF;
END $$;

ALTER TABLE admin.user_organizations
  VALIDATE CONSTRAINT ck_admin_user_organizations_role;

DO $$
DECLARE
  actual_definition TEXT;
  is_validated BOOLEAN;
BEGIN
  SELECT pg_get_constraintdef(constraint_row.oid), constraint_row.convalidated
  INTO actual_definition, is_validated
  FROM pg_constraint constraint_row
  WHERE constraint_row.conname = 'ck_admin_user_organizations_role'
    AND constraint_row.conrelid = 'admin.user_organizations'::regclass;

  IF actual_definition IS DISTINCT FROM
       'CHECK ((role = ANY (ARRAY[''admin''::text, ''member''::text])))'
     OR is_validated IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Organization membership role constraint does not match the reviewed admin/member contract.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_admin_user_organizations_scope
  ON admin.user_organizations(organization_id, status, role, user_id);
