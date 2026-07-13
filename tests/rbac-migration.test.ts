import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertConnectedLocalDatabase,
  assertLocalMigrationEnvironment
} from "../src/local-migration-guard.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. RBAC migration tests require disposable PostgreSQL.");
}

const localTarget = assertLocalMigrationEnvironment(process.env);
const database = new Pool({ connectionString: databaseUrl, ssl: false });
const migrationPath = join(process.cwd(), "database", "migrations", "012_add_platform_superadmin_rbac.sql");
let migrationSql: string;

beforeAll(async () => {
  await assertConnectedLocalDatabase(database, localTarget);
  migrationSql = await readFile(migrationPath, "utf8");
});

afterAll(async () => {
  await database.query(
    `DELETE FROM admin.platform_role_bootstrap
     WHERE identity_sub = '15101010-1010-4010-8010-101010101010'`
  );
  await database.query(
    "DELETE FROM admin.users WHERE email IN ('rbac-migration@admin-auth.test', 'rbac-trigger@admin-auth.test')"
  );
  await database.end();
});

describe("migration 012 platform RBAC", () => {
  it("is idempotent and never assigns the role by email", async () => {
    const user = await database.query(
      `INSERT INTO admin.users (email, name, profile_id, status)
       VALUES (
         'rbac-migration@admin-auth.test',
         'RBAC Migration',
         (SELECT id FROM admin.profiles WHERE key = 'autonomia_master'),
         'active'
       )
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );

    await database.query(migrationSql);
    await database.query(migrationSql);

    const role = await database.query(
      "SELECT key, status, permissions FROM admin.roles WHERE key = 'platform_superadmin'"
    );
    const links = await database.query(
      "SELECT id FROM admin.user_roles WHERE user_id = $1",
      [user.rows[0].id]
    );
    expect(role.rows).toEqual([{
      key: "platform_superadmin",
      status: "active",
      permissions: [
        "admin.users.read",
        "admin.users.write",
        "admin.organizations.read",
        "admin.organizations.write",
        "admin.products.read",
        "admin.products.write",
        "admin.services.read",
        "admin.services.write",
        "financial.admin"
      ]
    }]);
    expect(links.rowCount).toBe(0);
  });

  it("fails closed when the reserved role contract has drifted", async () => {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE admin.roles SET permissions = ARRAY['admin.users.read']::text[] WHERE key = 'platform_superadmin'"
      );
      await expect(client.query(migrationSql)).rejects.toThrow(
        "Existing platform_superadmin role does not match the reviewed permission contract."
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("enforces the bootstrap boundary atomically against direct and raced mutations", async () => {
    const identitySub = "15101010-1010-4010-8010-101010101010";
    const user = await database.query(
      `INSERT INTO admin.users (identity_user_id, email, name, profile_id, status)
       VALUES (
         $1,
         'rbac-trigger@admin-auth.test',
         'RBAC Trigger',
         (SELECT id FROM admin.profiles WHERE key = 'autonomia_master'),
         'active'
       )
       RETURNING id`,
      [identitySub]
    );
    const userId = String(user.rows[0].id);
    const role = await database.query("SELECT id FROM admin.roles WHERE key = 'platform_superadmin'");
    const roleId = String(role.rows[0].id);
    await database.query(
      "INSERT INTO admin.user_roles (user_id, role_id) VALUES ($1, $2)",
      [userId, roleId]
    );

    const racedClient = await database.connect();
    try {
      await racedClient.query("BEGIN");
      const precheck = await racedClient.query(
        "SELECT id FROM admin.platform_role_bootstrap WHERE user_id = $1",
        [userId]
      );
      expect(precheck.rowCount).toBe(0);

      await database.query(
        `INSERT INTO admin.platform_role_bootstrap (
           bootstrap_key, user_id, role_id, identity_sub, email_at_bootstrap
         ) VALUES ('platform_superadmin', $1, $2, $3, 'rbac-trigger@admin-auth.test')`,
        [userId, roleId, identitySub]
      );

      await expect(racedClient.query(
        "UPDATE admin.users SET email = 'raced@admin-auth.test' WHERE id = $1",
        [userId]
      )).rejects.toThrow("Bootstrapped platform superadmin is protected from generic mutation.");
    } finally {
      await racedClient.query("ROLLBACK");
      racedClient.release();
    }

    await expect(database.query(
      "UPDATE admin.users SET status = 'inactive' WHERE id = $1",
      [userId]
    )).rejects.toThrow("Bootstrapped platform superadmin is protected from generic mutation.");
    await expect(database.query(
      "UPDATE admin.users SET deleted_at = now() WHERE id = $1",
      [userId]
    )).rejects.toThrow("Bootstrapped platform superadmin is protected from generic mutation.");
    await expect(database.query(
      "DELETE FROM admin.users WHERE id = $1",
      [userId]
    )).rejects.toThrow("Bootstrapped platform superadmin is protected from generic mutation.");

    const state = await database.query(
      `SELECT admin_user.email, admin_user.status, admin_user.deleted_at,
              count(DISTINCT user_role.id)::int AS role_links,
              count(DISTINCT bootstrap.id)::int AS bootstrap_rows
       FROM admin.users admin_user
       LEFT JOIN admin.user_roles user_role ON user_role.user_id = admin_user.id
       LEFT JOIN admin.platform_role_bootstrap bootstrap ON bootstrap.user_id = admin_user.id
       WHERE admin_user.id = $1
       GROUP BY admin_user.id`,
      [userId]
    );
    expect(state.rows).toEqual([{
      email: "rbac-trigger@admin-auth.test",
      status: "active",
      deleted_at: null,
      role_links: 1,
      bootstrap_rows: 1
    }]);
  });
});
