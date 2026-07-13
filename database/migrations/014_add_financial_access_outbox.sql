CREATE TABLE IF NOT EXISTS admin.financial_access_revisions (
  admin_user_id UUID PRIMARY KEY REFERENCES admin.users(id) ON DELETE RESTRICT,
  revision BIGINT NOT NULL CHECK (revision > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin.financial_access_outbox (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES admin.users(id) ON DELETE RESTRICT,
  revision BIGINT NOT NULL CHECK (revision > 0),
  event_type TEXT NOT NULL CHECK (event_type = 'admin.financial_access.snapshot'),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'published')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  last_error TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (admin_user_id, revision),
  CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status <> 'processing' AND lease_token IS NULL AND lease_until IS NULL)
  ),
  CHECK ((status = 'published' AND published_at IS NOT NULL) OR status <> 'published'),
  CONSTRAINT ck_admin_financial_access_outbox_envelope CHECK (
    payload->>'eventId' IS NOT DISTINCT FROM event_id::text
    AND payload->>'eventType' IS NOT DISTINCT FROM event_type
    AND (payload->>'schemaVersion')::integer IS NOT DISTINCT FROM schema_version
    AND payload->'aggregate'->>'id' IS NOT DISTINCT FROM admin_user_id::text
    AND (payload->'aggregate'->>'revision')::bigint IS NOT DISTINCT FROM revision
  )
);

CREATE INDEX IF NOT EXISTS idx_admin_financial_access_outbox_dispatch
  ON admin.financial_access_outbox(status, next_attempt_at, created_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_admin_financial_access_outbox_envelope'
      AND conrelid = 'admin.financial_access_outbox'::regclass
  ) THEN
    ALTER TABLE admin.financial_access_outbox
      ADD CONSTRAINT ck_admin_financial_access_outbox_envelope CHECK (
        payload->>'eventId' IS NOT DISTINCT FROM event_id::text
        AND payload->>'eventType' IS NOT DISTINCT FROM event_type
        AND (payload->>'schemaVersion')::integer IS NOT DISTINCT FROM schema_version
        AND payload->'aggregate'->>'id' IS NOT DISTINCT FROM admin_user_id::text
        AND (payload->'aggregate'->>'revision')::bigint IS NOT DISTINCT FROM revision
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS admin.financial_organization_revisions (
  organization_id UUID PRIMARY KEY REFERENCES admin.organizations(id) ON DELETE RESTRICT,
  revision BIGINT NOT NULL CHECK (revision > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin.financial_organization_outbox (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES admin.organizations(id) ON DELETE RESTRICT,
  revision BIGINT NOT NULL CHECK (revision > 0),
  event_type TEXT NOT NULL CHECK (event_type = 'admin.organization.upserted'),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'published')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  last_error TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, revision),
  CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (status <> 'processing' AND lease_token IS NULL AND lease_until IS NULL)
  ),
  CHECK ((status = 'published' AND published_at IS NOT NULL) OR status <> 'published'),
  CONSTRAINT ck_admin_financial_organization_outbox_envelope CHECK (
    payload->>'eventId' IS NOT DISTINCT FROM event_id::text
    AND payload->>'eventType' IS NOT DISTINCT FROM event_type
    AND (payload->>'schemaVersion')::integer IS NOT DISTINCT FROM schema_version
    AND payload->'aggregate'->>'id' IS NOT DISTINCT FROM organization_id::text
    AND (payload->'aggregate'->>'revision')::bigint IS NOT DISTINCT FROM revision
  )
);

CREATE INDEX IF NOT EXISTS idx_admin_financial_organization_outbox_dispatch
  ON admin.financial_organization_outbox(status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS admin.financial_sync_reconciliations (
  reconciliation_key TEXT NOT NULL CHECK (length(reconciliation_key) BETWEEN 1 AND 120),
  aggregate_type TEXT NOT NULL CHECK (aggregate_type IN ('admin_user', 'organization')),
  aggregate_id UUID NOT NULL,
  event_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reconciliation_key, aggregate_type, aggregate_id),
  UNIQUE (event_id)
);

INSERT INTO admin.financial_access_revisions (admin_user_id, revision)
SELECT admin_user.id, 1
FROM admin.users admin_user
ON CONFLICT (admin_user_id) DO NOTHING;

WITH backfill AS (
  SELECT
    gen_random_uuid() AS event_id,
    admin_user.id AS admin_user_id,
    revision.revision,
    now() AS occurred_at,
    CASE WHEN admin_user.deleted_at IS NOT NULL THEN 'inactive' ELSE admin_user.status END AS effective_status,
    admin_user.identity_user_id,
    admin_user.deleted_at IS NOT NULL AS deleted,
    (
      admin_user.status = 'active'
      AND admin_user.deleted_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM admin.user_roles user_role
        INNER JOIN admin.roles role ON role.id = user_role.role_id
        WHERE user_role.user_id = admin_user.id
          AND role.status = 'active'
          AND 'financial.admin' = ANY(role.permissions)
      )
    ) AS financial_admin,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'organizationId', membership.organization_id,
            'role', membership.role,
            'isPrimary', membership.is_primary,
            'status', membership.status
          )
          ORDER BY membership.organization_id
        )
        FROM admin.user_organizations membership
        WHERE membership.user_id = admin_user.id
      ),
      '[]'::jsonb
    ) AS memberships
  FROM admin.users admin_user
  INNER JOIN admin.financial_access_revisions revision
    ON revision.admin_user_id = admin_user.id
)
INSERT INTO admin.financial_access_outbox (
  event_id,
  admin_user_id,
  revision,
  event_type,
  schema_version,
  payload
)
SELECT
  backfill.event_id,
  backfill.admin_user_id,
  backfill.revision,
  'admin.financial_access.snapshot',
  1,
  jsonb_build_object(
    'eventId', backfill.event_id,
    'eventType', 'admin.financial_access.snapshot',
    'schemaVersion', 1,
    'occurredAt', backfill.occurred_at,
    'source', 'admin',
    'aggregate', jsonb_build_object(
      'type', 'admin_user',
      'id', backfill.admin_user_id,
      'revision', backfill.revision
    ),
    'data', jsonb_build_object(
      'identityUserId', backfill.identity_user_id,
      'status', backfill.effective_status,
      'deleted', backfill.deleted,
      'grants', jsonb_build_object('financialAdmin', backfill.financial_admin),
      'memberships', backfill.memberships
    )
  )
FROM backfill
ON CONFLICT (admin_user_id, revision) DO NOTHING;

INSERT INTO admin.financial_organization_revisions (organization_id, revision)
SELECT organization.id, 1
FROM admin.organizations organization
ON CONFLICT (organization_id) DO NOTHING;

WITH organization_backfill AS (
  SELECT
    gen_random_uuid() AS event_id,
    organization.id AS organization_id,
    revision.revision,
    now() AS occurred_at,
    organization.key,
    organization.name,
    organization.status
  FROM admin.organizations organization
  INNER JOIN admin.financial_organization_revisions revision
    ON revision.organization_id = organization.id
)
INSERT INTO admin.financial_organization_outbox (
  event_id,
  organization_id,
  revision,
  event_type,
  schema_version,
  payload
)
SELECT
  backfill.event_id,
  backfill.organization_id,
  backfill.revision,
  'admin.organization.upserted',
  1,
  jsonb_build_object(
    'eventId', backfill.event_id,
    'eventType', 'admin.organization.upserted',
    'schemaVersion', 1,
    'occurredAt', backfill.occurred_at,
    'source', 'admin',
    'aggregate', jsonb_build_object(
      'type', 'organization',
      'id', backfill.organization_id,
      'revision', backfill.revision
    ),
    'data', jsonb_build_object(
      'organization', jsonb_build_object(
        'id', backfill.organization_id,
        'key', backfill.key,
        'name', backfill.name,
        'status', backfill.status
      )
    )
  )
FROM organization_backfill backfill
ON CONFLICT (organization_id, revision) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM admin.financial_access_outbox outbox
    WHERE outbox.payload->>'eventId' IS DISTINCT FROM outbox.event_id::text
       OR outbox.payload->>'eventType' IS DISTINCT FROM outbox.event_type
       OR (outbox.payload->>'schemaVersion')::integer IS DISTINCT FROM outbox.schema_version
       OR outbox.payload->'aggregate'->>'id' IS DISTINCT FROM outbox.admin_user_id::text
       OR (outbox.payload->'aggregate'->>'revision')::bigint IS DISTINCT FROM outbox.revision
  ) THEN
    RAISE EXCEPTION 'Financial access outbox payload metadata is inconsistent with its envelope.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM admin.financial_organization_outbox outbox
    WHERE outbox.payload->>'eventId' IS DISTINCT FROM outbox.event_id::text
       OR outbox.payload->>'eventType' IS DISTINCT FROM outbox.event_type
       OR (outbox.payload->>'schemaVersion')::integer IS DISTINCT FROM outbox.schema_version
       OR outbox.payload->'aggregate'->>'id' IS DISTINCT FROM outbox.organization_id::text
       OR (outbox.payload->'aggregate'->>'revision')::bigint IS DISTINCT FROM outbox.revision
  ) THEN
    RAISE EXCEPTION 'Financial organization outbox payload metadata is inconsistent with its envelope.';
  END IF;
END $$;
