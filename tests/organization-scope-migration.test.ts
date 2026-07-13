import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertConnectedLocalDatabase,
  assertLocalMigrationEnvironment
} from "../src/local-migration-guard.js";
import { applyMigration } from "../src/migrate.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Organization scope migration tests require disposable PostgreSQL.");
}

const migrationPath = join(process.cwd(), "database", "migrations", "013_add_organization_scope.sql");
let database: Pool;
let migrationSql: string;

beforeAll(async () => {
  const target = assertLocalMigrationEnvironment(process.env);
  database = new Pool({ connectionString: databaseUrl, ssl: false });
  await assertConnectedLocalDatabase(database, target);
  migrationSql = await readFile(migrationPath, "utf8");
});

afterAll(async () => {
  await database?.end();
});

describe("organization scope migration", () => {
  it("does not replay migration 005 or grant a late user access to Autonom.ia", async () => {
    const user = await database.query(
      `INSERT INTO admin.users (email, name, profile_id, status)
       VALUES (
         'late-user@organization-scope.test',
         'Late User',
         (SELECT id FROM admin.profiles WHERE key = 'autonomia_master'),
         'active'
       )
       RETURNING id`
    );
    try {
      await applyMigration(database, "005_create_organizations.sql");
      const memberships = await database.query(
        "SELECT organization_id, role, status FROM admin.user_organizations WHERE user_id = $1",
        [user.rows[0]?.id]
      );
      expect(memberships.rowCount).toBe(0);
    } finally {
      await database.query("DELETE FROM admin.users WHERE email = 'late-user@organization-scope.test'");
    }
  });

  it("is idempotent and installs the exact role boundary and scope index", async () => {
    await database.query(migrationSql);
    await database.query(migrationSql);
    const result = await database.query(
      `SELECT
         pg_get_constraintdef(constraint_row.oid) AS constraint_definition,
         to_regclass('admin.idx_admin_user_organizations_scope')::text AS scope_index
       FROM pg_constraint constraint_row
       WHERE constraint_row.conname = 'ck_admin_user_organizations_role'
         AND constraint_row.conrelid = 'admin.user_organizations'::regclass`
    );

    expect(result.rows).toEqual([{
      constraint_definition: "CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))",
      scope_index: "admin.idx_admin_user_organizations_scope"
    }]);
  });

  it("fails closed without rewriting a divergent legacy role", async () => {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "ALTER TABLE admin.user_organizations DROP CONSTRAINT ck_admin_user_organizations_role"
      );
      await client.query(
        `INSERT INTO admin.users (email, name, profile_id, status)
         VALUES (
           'divergent-role@organization-scope.test',
           'Divergent Role',
           (SELECT id FROM admin.profiles WHERE key = 'autonomia_master'),
           'active'
         )`
      );
      await client.query(
        `INSERT INTO admin.user_organizations (user_id, organization_id, role, is_primary, status)
         SELECT admin_user.id, organization.id, 'owner', true, 'active'
         FROM admin.users admin_user
         CROSS JOIN admin.organizations organization
         WHERE admin_user.email = 'divergent-role@organization-scope.test'
           AND organization.key = 'autonomia'`
      );

      await expect(client.query(migrationSql)).rejects.toThrow(
        "Existing organization membership role is outside the reviewed admin/member contract."
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }

    const persisted = await database.query(
      "SELECT id FROM admin.users WHERE email = 'divergent-role@organization-scope.test'"
    );
    expect(persisted.rowCount).toBe(0);
  });

  it("rejects a homonymous constraint with a broader role contract", async () => {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "ALTER TABLE admin.user_organizations DROP CONSTRAINT ck_admin_user_organizations_role"
      );
      await client.query(
        `ALTER TABLE admin.user_organizations
         ADD CONSTRAINT ck_admin_user_organizations_role
         CHECK (role IN ('admin', 'member', 'owner')) NOT VALID`
      );

      await expect(client.query(migrationSql)).rejects.toThrow(
        "Organization membership role constraint does not match the reviewed admin/member contract."
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }

    const definition = await database.query(
      `SELECT pg_get_constraintdef(oid) AS value
       FROM pg_constraint
       WHERE conname = 'ck_admin_user_organizations_role'
         AND conrelid = 'admin.user_organizations'::regclass`
    );
    expect(definition.rows[0]?.value).toBe(
      "CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))"
    );
  });
});
