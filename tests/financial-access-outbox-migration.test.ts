import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financialAccessSnapshotSchema } from "../src/financial-access-outbox.js";
import {
  assertConnectedLocalDatabase,
  assertLocalMigrationEnvironment
} from "../src/local-migration-guard.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Financial access migration tests require disposable PostgreSQL.");
}

let database: Pool;
let migrationSql: string;

beforeAll(async () => {
  const target = assertLocalMigrationEnvironment(process.env);
  database = new Pool({ connectionString: databaseUrl, ssl: false });
  await assertConnectedLocalDatabase(database, target);
  migrationSql = await readFile(
    join(process.cwd(), "database", "migrations", "014_add_financial_access_outbox.sql"),
    "utf8"
  );
});

afterAll(async () => {
  await database?.end();
});

describe("financial access outbox migration", () => {
  it("backfills once, emits no PII and remains idempotent", async () => {
    const userId = randomUUID();
    const identityUserId = randomUUID();
    const email = `financial-backfill-${userId}@outbox.test`;
    await database.query(
      `INSERT INTO admin.users (id, identity_user_id, email, name, profile_id, status)
       VALUES (
         $1, $2, $3, 'Sensitive Backfill Name',
         (SELECT id FROM admin.profiles WHERE key = 'autonomia_master'),
         'active'
       )`,
      [userId, identityUserId, email]
    );
    await database.query(
      `INSERT INTO admin.user_organizations (user_id, organization_id, role, is_primary, status)
       VALUES ($1, '14002337-5763-4000-8000-000000000001', 'member', true, 'active')`,
      [userId]
    );

    try {
      await database.query(migrationSql);
      await database.query(migrationSql);
      const result = await database.query(
        `SELECT revision, payload
         FROM admin.financial_access_outbox
         WHERE admin_user_id = $1`,
        [userId]
      );

      expect(result.rowCount).toBe(1);
      expect(result.rows[0]?.revision).toBe("1");
      const event = financialAccessSnapshotSchema.parse(result.rows[0]?.payload);
      expect(event.data).toEqual({
        identityUserId,
        status: "active",
        deleted: false,
        grants: { financialAdmin: false },
        memberships: [{
          organizationId: "14002337-5763-4000-8000-000000000001",
          role: "member",
          isPrimary: true,
          status: "active"
        }]
      });
      expect(JSON.stringify(event)).not.toContain(email);
      expect(JSON.stringify(event)).not.toContain("Sensitive Backfill Name");
    } finally {
      await cleanupUser(userId);
    }
  });

  it("installs the lease, revision and dispatcher indexes without touching other schemas", async () => {
    const result = await database.query(
      `SELECT
         to_regclass('admin.financial_access_revisions')::text AS revisions,
         to_regclass('admin.financial_access_outbox')::text AS outbox,
         to_regclass('admin.idx_admin_financial_access_outbox_dispatch')::text AS dispatch_index,
         to_regclass('admin.financial_organization_revisions')::text AS organization_revisions,
         to_regclass('admin.financial_organization_outbox')::text AS organization_outbox,
         to_regclass('admin.financial_sync_reconciliations')::text AS reconciliations,
         to_regclass('financial.financial_access_outbox')::text AS foreign_outbox`
    );
    expect(result.rows).toEqual([{
      revisions: "admin.financial_access_revisions",
      outbox: "admin.financial_access_outbox",
      dispatch_index: "admin.idx_admin_financial_access_outbox_dispatch",
      organization_revisions: "admin.financial_organization_revisions",
      organization_outbox: "admin.financial_organization_outbox",
      reconciliations: "admin.financial_sync_reconciliations",
      foreign_outbox: null
    }]);
  });
});

async function cleanupUser(userId: string) {
  await database.query("DELETE FROM admin.financial_access_outbox WHERE admin_user_id = $1", [userId]);
  await database.query("DELETE FROM admin.financial_access_revisions WHERE admin_user_id = $1", [userId]);
  await database.query("DELETE FROM admin.user_organizations WHERE user_id = $1", [userId]);
  await database.query("DELETE FROM admin.user_roles WHERE user_id = $1", [userId]);
  await database.query("DELETE FROM admin.users WHERE id = $1", [userId]);
}
