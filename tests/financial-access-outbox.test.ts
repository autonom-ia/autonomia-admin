import { randomUUID } from "node:crypto";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FinancialAccessOutboxDispatcher
} from "../src/financial-access-dispatcher.js";
import {
  enqueueFinancialAccessSnapshot,
  financialAccessSnapshotSchema,
  reconcileFinancialSyncSnapshots
} from "../src/financial-access-outbox.js";
import { boundedInteger } from "../src/config.js";
import {
  assertConnectedLocalDatabase,
  assertLocalMigrationEnvironment
} from "../src/local-migration-guard.js";
import { AdminRepository } from "../src/repository.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Financial access outbox tests require disposable PostgreSQL.");
}

let database: Pool;
const createdUserIds = new Set<string>();
const createdOrganizationIds = new Set<string>();

beforeAll(async () => {
  const target = assertLocalMigrationEnvironment(process.env);
  database = new Pool({ connectionString: databaseUrl, ssl: false, max: 10 });
  await assertConnectedLocalDatabase(database, target);
});

afterAll(async () => {
  for (const userId of createdUserIds) await cleanupUser(userId);
  for (const organizationId of createdOrganizationIds) await cleanupOrganization(organizationId);
  await database?.end();
});

describe("financial access transactional outbox", () => {
  it("rolls the snapshot and revision back with the source mutation", async () => {
    const userId = await createUser({ status: "active" });
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE admin.users SET status = 'inactive' WHERE id = $1", [userId]);
      await enqueueFinancialAccessSnapshot(client, userId);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    const user = await database.query("SELECT status FROM admin.users WHERE id = $1", [userId]);
    const outbox = await database.query(
      "SELECT event_id FROM admin.financial_access_outbox WHERE admin_user_id = $1",
      [userId]
    );
    const revision = await database.query(
      "SELECT revision FROM admin.financial_access_revisions WHERE admin_user_id = $1",
      [userId]
    );
    expect(user.rows[0]?.status).toBe("active");
    expect(outbox.rowCount).toBe(0);
    expect(revision.rowCount).toBe(0);
  });

  it("commits an exact, PII-free snapshot with a persisted financial.admin grant", async () => {
    const identityUserId = randomUUID();
    const userId = await createUser({ identityUserId, status: "active" });
    await database.query(
      `INSERT INTO admin.user_roles (user_id, role_id)
       SELECT $1, id FROM admin.roles WHERE key = 'platform_superadmin'`,
      [userId]
    );
    await database.query(
      `INSERT INTO admin.user_organizations (user_id, organization_id, role, is_primary, status)
       VALUES ($1, '14002337-5763-4000-8000-000000000002', 'admin', true, 'active')`,
      [userId]
    );

    const client = await database.connect();
    let event;
    try {
      await client.query("BEGIN");
      event = await enqueueFinancialAccessSnapshot(client, userId);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    expect(financialAccessSnapshotSchema.parse(event).data).toEqual({
      identityUserId,
      status: "active",
      deleted: false,
      grants: { financialAdmin: true },
      memberships: [{
        organizationId: "14002337-5763-4000-8000-000000000002",
        role: "admin",
        isPrimary: true,
        status: "active"
      }]
    });
    const stored = await database.query(
      "SELECT event_id, revision, payload FROM admin.financial_access_outbox WHERE admin_user_id = $1",
      [userId]
    );
    expect(stored.rows[0]?.event_id).toBe(event?.eventId);
    expect(stored.rows[0]?.revision).toBe("1");
    expect(stored.rows[0]?.payload).toEqual(event);
    expect(JSON.stringify(event)).not.toContain("@outbox.test");
  });

  it("rejects persistent envelope and payload divergence", async () => {
    const userId = await createUser({ status: "active" });
    const event = await enqueueCommitted(userId);
    await expect(database.query(
      `UPDATE admin.financial_access_outbox
       SET payload = jsonb_set(payload, '{eventId}', to_jsonb($2::text))
       WHERE event_id = $1`,
      [event.eventId, randomUUID()]
    )).rejects.toThrow("ck_admin_financial_access_outbox_envelope");
  });

  it("serializes concurrent writers into monotonic revisions", async () => {
    const userId = await createUser({ status: "active" });
    const first = await database.connect();
    const second = await database.connect();
    try {
      await first.query("BEGIN");
      const eventOne = await enqueueFinancialAccessSnapshot(first, userId);
      await second.query("BEGIN");
      const eventTwoPromise = enqueueFinancialAccessSnapshot(second, userId);
      await first.query("COMMIT");
      const eventTwo = await eventTwoPromise;
      await second.query("COMMIT");

      expect(eventOne.aggregate.revision).toBe(1);
      expect(eventTwo.aggregate.revision).toBe(2);
      const revisions = await database.query(
        `SELECT revision FROM admin.financial_access_outbox
         WHERE admin_user_id = $1 ORDER BY revision`,
        [userId]
      );
      expect(revisions.rows.map((row) => row.revision)).toEqual(["1", "2"]);
    } catch (error) {
      await first.query("ROLLBACK").catch(() => undefined);
      await second.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      first.release();
      second.release();
    }
  });

  it("covers invite, activation, first identity link and soft-delete revocation", async () => {
    const repository = new AdminRepository(database);
    const actorId = await createUser({ status: "active" });
    await database.query(
      `INSERT INTO admin.user_organizations (user_id, organization_id, role, is_primary, status)
       VALUES ($1, '14002337-5763-4000-8000-000000000001', 'admin', true, 'active')`,
      [actorId]
    );
    const email = `financial-flow-${randomUUID()}@outbox.test`;
    const invited = await repository.inviteOrganizationUser(
      "14002337-5763-4000-8000-000000000001",
      actorId,
      { email, name: "Financial Flow", role: "member" }
    );
    createdUserIds.add(invited.id);
    await repository.updateOrganizationUserMembership(
      "14002337-5763-4000-8000-000000000001",
      invited.id,
      actorId,
      { status: "active" }
    );
    const identityUserId = randomUUID();
    await repository.authenticateProvisionedUser({
      identityUserId,
      verifiedEmail: email,
      allowFirstLink: true
    });
    await repository.softDeleteUser(invited.id);

    const snapshots = await database.query(
      `SELECT revision, payload
       FROM admin.financial_access_outbox
       WHERE admin_user_id = $1
       ORDER BY revision`,
      [invited.id]
    );
    expect(snapshots.rows.map((row) => row.revision)).toEqual(["1", "2", "3", "4"]);
    expect(snapshots.rows[0]?.payload.data.status).toBe("invited");
    expect(snapshots.rows[0]?.payload.data.identityUserId).toBeNull();
    expect(snapshots.rows[1]?.payload.data.status).toBe("active");
    expect(snapshots.rows[2]?.payload.data.identityUserId).toBe(identityUserId);
    expect(snapshots.rows[3]?.payload.data).toMatchObject({
      status: "inactive",
      deleted: true,
      grants: { financialAdmin: false },
      memberships: [{ status: "inactive", isPrimary: false }]
    });
  });

  it("enqueues bootstrap and generic status mutations through their real repository paths", async () => {
    const repository = new AdminRepository(database);
    const subject = randomUUID();
    const email = `bootstrap-${randomUUID()}@outbox.test`;
    const bootstrapped = await repository.bootstrapPlatformSuperadmin({
      identityUserId: subject,
      verifiedEmail: email,
      verifiedName: "Bootstrap Outbox",
      expectedEmail: email
    });
    createdUserIds.add(bootstrapped.id);
    const bootstrapEvents = await database.query(
      `SELECT payload FROM admin.financial_access_outbox
       WHERE admin_user_id = $1 ORDER BY revision`,
      [bootstrapped.id]
    );
    expect(bootstrapEvents.rows).toHaveLength(1);
    expect(bootstrapEvents.rows[0]?.payload.data.grants.financialAdmin).toBe(true);

    const generic = await repository.upsertUser({
      email: `generic-${randomUUID()}@outbox.test`,
      name: "Generic Outbox",
      status: "active"
    });
    createdUserIds.add(generic.id);
    await repository.updateUserStatus(generic.id, "inactive");
    const genericEvents = await database.query(
      `SELECT revision, payload->'data'->>'status' AS status
       FROM admin.financial_access_outbox
       WHERE admin_user_id = $1 ORDER BY revision`,
      [generic.id]
    );
    expect(genericEvents.rows).toEqual([
      { revision: "1", status: "active" },
      { revision: "2", status: "inactive" }
    ]);
  });

  it("rolls a repository mutation back when enqueue fails", async () => {
    const repository = new AdminRepository(database);
    const userId = await createUser({ status: "active" });
    const functionName = `reject_financial_outbox_${userId.replaceAll("-", "")}`;
    const triggerName = `reject_financial_outbox_${userId.replaceAll("-", "")}`;
    await database.query(
      `CREATE FUNCTION admin.${functionName}() RETURNS trigger
       LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.admin_user_id = '${userId}'::uuid THEN
           RAISE EXCEPTION 'simulated outbox insert failure';
         END IF;
         RETURN NEW;
       END $$`
    );
    await database.query(
      `CREATE TRIGGER ${triggerName}
       BEFORE INSERT ON admin.financial_access_outbox
       FOR EACH ROW EXECUTE FUNCTION admin.${functionName}()`
    );
    try {
      await expect(repository.updateUserStatus(userId, "inactive"))
        .rejects.toThrow("simulated outbox insert failure");
      const user = await database.query("SELECT status FROM admin.users WHERE id = $1", [userId]);
      expect(user.rows[0]?.status).toBe("active");
      const revision = await database.query(
        "SELECT revision FROM admin.financial_access_revisions WHERE admin_user_id = $1",
        [userId]
      );
      expect(revision.rowCount).toBe(0);
    } finally {
      await database.query(`DROP TRIGGER ${triggerName} ON admin.financial_access_outbox`);
      await database.query(`DROP FUNCTION admin.${functionName}()`);
    }
  });

  it("retries with the same eventId and only publishes after SQS succeeds", async () => {
    const userId = await createUser({ status: "active" });
    const event = await enqueueCommitted(userId);
    const bodies: string[] = [];
    let fail = true;
    const sender = {
      async send(command: SendMessageCommand) {
        bodies.push(String(command.input.MessageBody));
        if (fail) throw new Error("simulated SQS outage");
        return {};
      }
    };
    let now = new Date("2026-07-13T12:00:00.000Z");
    await database.query(
      "UPDATE admin.financial_access_outbox SET next_attempt_at = $2 WHERE event_id = $1",
      [event.eventId, now]
    );
    const dispatcher = new FinancialAccessOutboxDispatcher(
      database,
      sender,
      "https://sqs.test/financial-sync",
      { now: () => now }
    );

    expect(await dispatcher.dispatch()).toEqual({ claimed: 1, published: 0, failed: 1 });
    const pending = await database.query(
      `SELECT status, attempt_count, last_error, published_at
       FROM admin.financial_access_outbox WHERE event_id = $1`,
      [event.eventId]
    );
    expect(pending.rows[0]).toMatchObject({
      status: "pending",
      attempt_count: 1,
      last_error: "simulated SQS outage",
      published_at: null
    });

    fail = false;
    now = new Date("2026-07-13T12:00:03.000Z");
    expect(await dispatcher.dispatch()).toEqual({ claimed: 1, published: 1, failed: 0 });
    const published = await database.query(
      `SELECT status, attempt_count, last_error, published_at
       FROM admin.financial_access_outbox WHERE event_id = $1`,
      [event.eventId]
    );
    expect(published.rows[0]).toMatchObject({
      status: "published",
      attempt_count: 2,
      last_error: null
    });
    expect(published.rows[0]?.published_at).not.toBeNull();
    expect(bodies.map((body) => JSON.parse(body).eventId)).toEqual([event.eventId, event.eventId]);
  });

  it("reclaims an expired lease and keeps poison payloads pending", async () => {
    const expiredUserId = await createUser({ status: "active" });
    const expiredEvent = await enqueueCommitted(expiredUserId);
    const poisonUserId = await createUser({ status: "active" });
    const poisonEvent = await enqueueCommitted(poisonUserId);
    const now = new Date("2026-07-13T13:00:00.000Z");
    await database.query(
      `UPDATE admin.financial_access_outbox
       SET status = 'processing', lease_token = gen_random_uuid(), lease_until = $2
       WHERE event_id = $1`,
      [expiredEvent.eventId, new Date(now.getTime() - 1000)]
    );
    await database.query(
      `UPDATE admin.financial_access_outbox
       SET payload = payload || '{"unexpected":true}'::jsonb,
           next_attempt_at = $2
       WHERE event_id = $1`,
      [poisonEvent.eventId, now]
    );
    const sent: string[] = [];
    const dispatcher = new FinancialAccessOutboxDispatcher(
      database,
      { async send(command) { sent.push(String(command.input.MessageBody)); return {}; } },
      "https://sqs.test/financial-sync",
      { now: () => now }
    );

    expect(await dispatcher.dispatch()).toEqual({ claimed: 2, published: 1, failed: 1 });
    expect(JSON.parse(sent[0] ?? "{}").eventId).toBe(expiredEvent.eventId);
    const poison = await database.query(
      "SELECT status, attempt_count, last_error FROM admin.financial_access_outbox WHERE event_id = $1",
      [poisonEvent.eventId]
    );
    expect(poison.rows[0]?.status).toBe("pending");
    expect(poison.rows[0]?.attempt_count).toBe(1);
    expect(poison.rows[0]?.last_error).toContain("Unrecognized key");
  });

  it("durably revisions organization activation and deactivation", async () => {
    const repository = new AdminRepository(database);
    const organizationId = randomUUID();
    createdOrganizationIds.add(organizationId);
    const key = `financial-org-${organizationId}`;
    await repository.upsertOrganization({ id: organizationId, key, name: "Financial Org", status: "active" });
    await repository.upsertOrganization({ id: organizationId, key, name: "Financial Org", status: "inactive" });
    const events = await database.query(
      `SELECT revision, payload
       FROM admin.financial_organization_outbox
       WHERE organization_id = $1
       ORDER BY revision`,
      [organizationId]
    );
    expect(events.rows.map((row) => ({
      revision: row.revision,
      status: row.payload.data.organization.status,
      aggregate: row.payload.aggregate
    }))).toEqual([
      {
        revision: "1",
        status: "active",
        aggregate: { type: "organization", id: organizationId, revision: 1 }
      },
      {
        revision: "2",
        status: "inactive",
        aggregate: { type: "organization", id: organizationId, revision: 2 }
      }
    ]);
  });

  it("reconciles a mutation made by an old writer after migration backfill", async () => {
    const userId = await createUser({ status: "active" });
    await enqueueCommitted(userId);
    await database.query("UPDATE admin.users SET status = 'inactive' WHERE id = $1", [userId]);
    const reconciliationKey = `test-${randomUUID()}`;
    try {
      const result = await reconcileFinancialSyncSnapshots(database, reconciliationKey, 500);
      expect(result.usersRemaining).toBe(0);
      expect(result.organizationsRemaining).toBe(0);
      const events = await database.query(
        `SELECT revision, payload->'data'->>'status' AS status
         FROM admin.financial_access_outbox
         WHERE admin_user_id = $1 ORDER BY revision`,
        [userId]
      );
      expect(events.rows).toEqual([
        { revision: "1", status: "active" },
        { revision: "2", status: "inactive" }
      ]);
    } finally {
      await rollbackReconciliation(reconciliationKey);
    }
  });

  it("fails fast for unsafe dispatcher batch and lease configuration", () => {
    expect(boundedInteger(undefined, 10, "BATCH", 1, 100)).toBe(10);
    expect(boundedInteger("100", 10, "BATCH", 1, 100)).toBe(100);
    for (const value of ["0", "-1", "1.5", "NaN", "101"]) {
      expect(() => boundedInteger(value, 10, "BATCH", 1, 100)).toThrow(
        "BATCH must be an integer between 1 and 100."
      );
    }
    expect(() => boundedInteger("59", 60, "LEASE", 60, 900)).toThrow(
      "LEASE must be an integer between 60 and 900."
    );
  });
});

async function createUser(input: {
  identityUserId?: string;
  status: "active" | "inactive" | "invited";
}) {
  const userId = randomUUID();
  createdUserIds.add(userId);
  await database.query(
    `INSERT INTO admin.users (id, identity_user_id, email, name, profile_id, status)
     VALUES (
       $1, $2, $3, 'Financial Outbox Test',
       (SELECT id FROM admin.profiles WHERE key = 'autonomia_master'),
       $4
     )`,
    [userId, input.identityUserId ?? null, `financial-${userId}@outbox.test`, input.status]
  );
  return userId;
}

async function enqueueCommitted(userId: string) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const event = await enqueueFinancialAccessSnapshot(client, userId);
    await client.query("COMMIT");
    return event;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupUser(userId: string) {
  await database.query("DELETE FROM admin.platform_role_bootstrap WHERE user_id = $1", [userId]);
  await database.query(
    "DELETE FROM admin.financial_sync_reconciliations WHERE aggregate_type = 'admin_user' AND aggregate_id = $1",
    [userId]
  );
  await database.query("DELETE FROM admin.financial_access_outbox WHERE admin_user_id = $1", [userId]);
  await database.query("DELETE FROM admin.financial_access_revisions WHERE admin_user_id = $1", [userId]);
  await database.query("DELETE FROM admin.user_organizations WHERE user_id = $1", [userId]);
  await database.query("DELETE FROM admin.user_roles WHERE user_id = $1", [userId]);
  await database.query("DELETE FROM admin.users WHERE id = $1", [userId]);
}

async function cleanupOrganization(organizationId: string) {
  await database.query(
    "DELETE FROM admin.financial_sync_reconciliations WHERE aggregate_type = 'organization' AND aggregate_id = $1",
    [organizationId]
  );
  await database.query("DELETE FROM admin.financial_organization_outbox WHERE organization_id = $1", [organizationId]);
  await database.query("DELETE FROM admin.financial_organization_revisions WHERE organization_id = $1", [organizationId]);
  await database.query("DELETE FROM admin.user_organizations WHERE organization_id = $1", [organizationId]);
  await database.query("DELETE FROM admin.organizations WHERE id = $1", [organizationId]);
}

async function rollbackReconciliation(reconciliationKey: string) {
  const rows = await database.query<{
    aggregate_type: "admin_user" | "organization";
    aggregate_id: string;
    event_id: string;
  }>(
    `SELECT aggregate_type, aggregate_id, event_id
     FROM admin.financial_sync_reconciliations
     WHERE reconciliation_key = $1`,
    [reconciliationKey]
  );
  for (const row of rows.rows) {
    if (row.aggregate_type === "admin_user") {
      const event = await database.query<{ revision: string }>(
        "SELECT revision FROM admin.financial_access_outbox WHERE event_id = $1",
        [row.event_id]
      );
      await database.query("DELETE FROM admin.financial_access_outbox WHERE event_id = $1", [row.event_id]);
      if (event.rows[0]?.revision === "1") {
        await database.query("DELETE FROM admin.financial_access_revisions WHERE admin_user_id = $1", [row.aggregate_id]);
      } else {
        await database.query(
          `UPDATE admin.financial_access_revisions
           SET revision = revision - 1
           WHERE admin_user_id = $1`,
          [row.aggregate_id]
        );
      }
    } else {
      const event = await database.query<{ revision: string }>(
        "SELECT revision FROM admin.financial_organization_outbox WHERE event_id = $1",
        [row.event_id]
      );
      await database.query("DELETE FROM admin.financial_organization_outbox WHERE event_id = $1", [row.event_id]);
      if (event.rows[0]?.revision === "1") {
        await database.query("DELETE FROM admin.financial_organization_revisions WHERE organization_id = $1", [row.aggregate_id]);
      } else {
        await database.query(
          `UPDATE admin.financial_organization_revisions
           SET revision = revision - 1
           WHERE organization_id = $1`,
          [row.aggregate_id]
        );
      }
    }
  }
  await database.query(
    "DELETE FROM admin.financial_sync_reconciliations WHERE reconciliation_key = $1",
    [reconciliationKey]
  );
}
