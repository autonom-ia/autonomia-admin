import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

const membershipSchema = z.object({
  organizationId: z.string().uuid(),
  role: z.enum(["admin", "member"]),
  isPrimary: z.boolean(),
  status: z.enum(["active", "inactive"])
}).strict();

export const financialAccessSnapshotSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal("admin.financial_access.snapshot"),
  schemaVersion: z.literal(1),
  occurredAt: z.string().datetime({ offset: true }),
  source: z.literal("admin"),
  aggregate: z.object({
    type: z.literal("admin_user"),
    id: z.string().uuid(),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  }).strict(),
  data: z.object({
    identityUserId: z.string().uuid().nullable(),
    status: z.enum(["active", "inactive", "invited"]),
    deleted: z.boolean(),
    grants: z.object({ financialAdmin: z.boolean() }).strict(),
    memberships: z.array(membershipSchema)
  }).strict()
}).strict().superRefine((event, context) => {
  const organizations = new Set<string>();
  let activePrimaryCount = 0;
  for (const [index, membership] of event.data.memberships.entries()) {
    if (organizations.has(membership.organizationId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Membership organizations must be unique.",
        path: ["data", "memberships", index, "organizationId"]
      });
    }
    organizations.add(membership.organizationId);
    if (membership.isPrimary && membership.status === "active") activePrimaryCount += 1;
  }
  if (activePrimaryCount > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Only one active primary membership is allowed.",
      path: ["data", "memberships"]
    });
  }
  if (event.data.deleted && event.data.status !== "inactive") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A deleted subject must be inactive.",
      path: ["data", "status"]
    });
  }
  if ((event.data.deleted || event.data.status !== "active") && event.data.grants.financialAdmin) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "An inactive, invited or deleted subject cannot carry financialAdmin.",
      path: ["data", "grants", "financialAdmin"]
    });
  }
});

export type FinancialAccessSnapshotEvent = z.infer<typeof financialAccessSnapshotSchema>;

export const financialOrganizationSnapshotSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal("admin.organization.upserted"),
  schemaVersion: z.literal(1),
  occurredAt: z.string().datetime({ offset: true }),
  source: z.literal("admin"),
  aggregate: z.object({
    type: z.literal("organization"),
    id: z.string().uuid(),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  }).strict(),
  data: z.object({
    organization: z.object({
      id: z.string().uuid(),
      key: z.string().min(1),
      name: z.string().min(1),
      status: z.enum(["active", "inactive"])
    }).strict()
  }).strict()
}).strict().superRefine((event, context) => {
  if (event.data.organization.id !== event.aggregate.id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Organization payload id must match the aggregate id.",
      path: ["data", "organization", "id"]
    });
  }
});

export type FinancialOrganizationSnapshotEvent = z.infer<typeof financialOrganizationSnapshotSchema>;
export type FinancialSyncSnapshotEvent = FinancialAccessSnapshotEvent | FinancialOrganizationSnapshotEvent;

type SubjectRow = {
  identity_user_id: string | null;
  status: "active" | "inactive" | "invited";
  deleted_at: Date | null;
  financial_admin: boolean;
  memberships: Array<{
    organizationId: string;
    role: "admin" | "member";
    isPrimary: boolean;
    status: "active" | "inactive";
  }>;
};

export async function enqueueFinancialAccessSnapshot(
  client: PoolClient,
  adminUserId: string
): Promise<FinancialAccessSnapshotEvent> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('admin.financial_access:' || $1::text))",
    [adminUserId]
  );
  const revisionResult = await client.query<{ revision: string }>(
    `INSERT INTO admin.financial_access_revisions (admin_user_id, revision)
     VALUES ($1, 1)
     ON CONFLICT (admin_user_id) DO UPDATE SET
       revision = admin.financial_access_revisions.revision + 1,
       updated_at = now()
     RETURNING revision`,
    [adminUserId]
  );
  const revision = Number(revisionResult.rows[0]?.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Financial access revision is outside the safe integer range.");
  }

  const subjectResult = await client.query<SubjectRow>(
    `SELECT
       admin_user.identity_user_id,
       CASE WHEN admin_user.deleted_at IS NOT NULL THEN 'inactive' ELSE admin_user.status END AS status,
       admin_user.deleted_at,
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
     WHERE admin_user.id = $1
     FOR UPDATE`,
    [adminUserId]
  );
  const subject = subjectResult.rows[0];
  if (!subject) throw new Error("Administrative user was not found for financial access snapshot.");

  const event = financialAccessSnapshotSchema.parse({
    eventId: randomUUID(),
    eventType: "admin.financial_access.snapshot",
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    source: "admin",
    aggregate: {
      type: "admin_user",
      id: adminUserId,
      revision
    },
    data: {
      identityUserId: subject.identity_user_id,
      status: subject.status,
      deleted: subject.deleted_at !== null,
      grants: { financialAdmin: subject.financial_admin },
      memberships: subject.memberships
    }
  });

  await client.query(
    `INSERT INTO admin.financial_access_outbox (
       event_id, admin_user_id, revision, event_type, schema_version, payload
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      event.eventId,
      adminUserId,
      revision,
      event.eventType,
      event.schemaVersion,
      JSON.stringify(event)
    ]
  );
  return event;
}

export async function enqueueFinancialOrganizationSnapshot(
  client: PoolClient,
  organizationId: string
): Promise<FinancialOrganizationSnapshotEvent> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('admin.financial_organization:' || $1::text))",
    [organizationId]
  );
  const revisionResult = await client.query<{ revision: string }>(
    `INSERT INTO admin.financial_organization_revisions (organization_id, revision)
     VALUES ($1, 1)
     ON CONFLICT (organization_id) DO UPDATE SET
       revision = admin.financial_organization_revisions.revision + 1,
       updated_at = now()
     RETURNING revision`,
    [organizationId]
  );
  const revision = Number(revisionResult.rows[0]?.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Financial organization revision is outside the safe integer range.");
  }

  const organizationResult = await client.query<{
    id: string;
    key: string;
    name: string;
    status: "active" | "inactive";
  }>(
    `SELECT id, key, name, status
     FROM admin.organizations
     WHERE id = $1
     FOR UPDATE`,
    [organizationId]
  );
  const organization = organizationResult.rows[0];
  if (!organization) throw new Error("Organization was not found for financial snapshot.");

  const event = financialOrganizationSnapshotSchema.parse({
    eventId: randomUUID(),
    eventType: "admin.organization.upserted",
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    source: "admin",
    aggregate: {
      type: "organization",
      id: organizationId,
      revision
    },
    data: { organization }
  });
  await client.query(
    `INSERT INTO admin.financial_organization_outbox (
       event_id, organization_id, revision, event_type, schema_version, payload
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      event.eventId,
      organizationId,
      revision,
      event.eventType,
      event.schemaVersion,
      JSON.stringify(event)
    ]
  );
  return event;
}

export async function reconcileFinancialSyncSnapshots(
  db: Pool,
  reconciliationKey: string,
  batchSize = 100
) {
  const key = z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/).parse(reconciliationKey);
  const limit = z.number().int().min(1).max(500).parse(batchSize);
  const users = await db.query<{ id: string }>(
    `SELECT admin_user.id
     FROM admin.users admin_user
     WHERE NOT EXISTS (
       SELECT 1
       FROM admin.financial_sync_reconciliations reconciliation
       WHERE reconciliation.reconciliation_key = $1
         AND reconciliation.aggregate_type = 'admin_user'
         AND reconciliation.aggregate_id = admin_user.id
     )
     ORDER BY admin_user.id
     LIMIT $2`,
    [key, limit]
  );
  const organizations = await db.query<{ id: string }>(
    `SELECT organization.id
     FROM admin.organizations organization
     WHERE NOT EXISTS (
       SELECT 1
       FROM admin.financial_sync_reconciliations reconciliation
       WHERE reconciliation.reconciliation_key = $1
         AND reconciliation.aggregate_type = 'organization'
         AND reconciliation.aggregate_id = organization.id
     )
     ORDER BY organization.id
     LIMIT $2`,
    [key, limit]
  );

  let usersProcessed = 0;
  for (const user of users.rows) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const event = await enqueueFinancialAccessSnapshot(client, user.id);
      await client.query(
        `INSERT INTO admin.financial_sync_reconciliations (
           reconciliation_key, aggregate_type, aggregate_id, event_id
         ) VALUES ($1, 'admin_user', $2, $3)`,
        [key, user.id, event.eventId]
      );
      await client.query("COMMIT");
      usersProcessed += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      if (!isUniqueViolation(error)) throw error;
    } finally {
      client.release();
    }
  }

  let organizationsProcessed = 0;
  for (const organization of organizations.rows) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const event = await enqueueFinancialOrganizationSnapshot(client, organization.id);
      await client.query(
        `INSERT INTO admin.financial_sync_reconciliations (
           reconciliation_key, aggregate_type, aggregate_id, event_id
         ) VALUES ($1, 'organization', $2, $3)`,
        [key, organization.id, event.eventId]
      );
      await client.query("COMMIT");
      organizationsProcessed += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      if (!isUniqueViolation(error)) throw error;
    } finally {
      client.release();
    }
  }

  const remaining = await db.query<{ aggregate_type: "admin_user" | "organization"; count: string }>(
    `SELECT aggregate_type, count(*)::text AS count
     FROM (
       SELECT 'admin_user'::text AS aggregate_type, admin_user.id AS aggregate_id
       FROM admin.users admin_user
       UNION ALL
       SELECT 'organization'::text AS aggregate_type, organization.id AS aggregate_id
       FROM admin.organizations organization
     ) aggregate
     WHERE NOT EXISTS (
       SELECT 1
       FROM admin.financial_sync_reconciliations reconciliation
       WHERE reconciliation.reconciliation_key = $1
         AND reconciliation.aggregate_type = aggregate.aggregate_type
         AND reconciliation.aggregate_id = aggregate.aggregate_id
     )
     GROUP BY aggregate_type`,
    [key]
  );
  return {
    reconciliationKey: key,
    usersProcessed,
    organizationsProcessed,
    usersRemaining: Number(remaining.rows.find((row) => row.aggregate_type === "admin_user")?.count ?? 0),
    organizationsRemaining: Number(remaining.rows.find((row) => row.aggregate_type === "organization")?.count ?? 0)
  };
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
