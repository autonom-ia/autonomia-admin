import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Migration tests must run against a real disposable PostgreSQL database.");
}

assertDisposableDatabase(databaseUrl);

const database = new Pool({ connectionString: databaseUrl, ssl: false });
const migrationPath = join(process.cwd(), "database", "migrations", "008_rename_job_autonomia_product_key.sql");
let migrationSql: string;

beforeAll(async () => {
  migrationSql = await readFile(migrationPath, "utf8");
  await database.query("DROP SCHEMA IF EXISTS financial CASCADE");
  await database.query("CREATE SCHEMA financial");
  await database.query(`
    CREATE TABLE financial.catalog_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      operator_id UUID NOT NULL,
      type TEXT NOT NULL,
      key TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (operator_id, type, key)
    )
  `);
});

beforeEach(async () => {
  await database.query("TRUNCATE financial.catalog_items");
  await database.query("DELETE FROM admin.products WHERE key IN ('job-autonomia', 'google-saas')");
});

afterAll(async () => {
  await database.query("DELETE FROM admin.products WHERE key IN ('job-autonomia', 'google-saas')");
  await database.query("DROP SCHEMA IF EXISTS financial CASCADE");
  await database.end();
});

describe("migration 008 financial catalog rename", () => {
  it("renames Admin and Financial products and remains idempotent", async () => {
    const operatorOne = "10000000-0000-4000-8000-000000000001";
    const operatorTwo = "10000000-0000-4000-8000-000000000002";
    await database.query("INSERT INTO admin.products (key, name) VALUES ('job-autonomia', 'Job Autonomia')");
    await database.query(
      `INSERT INTO financial.catalog_items (operator_id, type, key)
       VALUES
         ($1, 'product', 'job-autonomia'),
         ($2, 'product', 'job-autonomia'),
         ($1, 'service', 'job-autonomia')`,
      [operatorOne, operatorTwo]
    );

    await runMigration();
    await runMigration();

    const adminKeys = await database.query(
      "SELECT key FROM admin.products WHERE key IN ('job-autonomia', 'google-saas') ORDER BY key"
    );
    const financialKeys = await database.query(
      `SELECT operator_id, type, key
       FROM financial.catalog_items
       ORDER BY operator_id, type`
    );

    expect(adminKeys.rows).toEqual([{ key: "google-saas" }]);
    expect(financialKeys.rows).toEqual([
      { operator_id: operatorOne, type: "product", key: "google-saas" },
      { operator_id: operatorOne, type: "service", key: "job-autonomia" },
      { operator_id: operatorTwo, type: "product", key: "google-saas" }
    ]);
  });

  it("rejects a product-key collision for the same operator and rolls back", async () => {
    const operatorId = "20000000-0000-4000-8000-000000000001";
    await database.query("INSERT INTO admin.products (key, name) VALUES ('job-autonomia', 'Job Autonomia')");
    await database.query(
      `INSERT INTO financial.catalog_items (operator_id, type, key)
       VALUES
         ($1, 'product', 'job-autonomia'),
         ($1, 'product', 'google-saas')`,
      [operatorId]
    );

    await expect(runMigration()).rejects.toThrow(
      "Cannot rename financial product job-autonomia to google-saas because google-saas already exists for the same operator."
    );

    const adminKeys = await database.query(
      "SELECT key FROM admin.products WHERE key IN ('job-autonomia', 'google-saas') ORDER BY key"
    );
    const financialKeys = await database.query(
      "SELECT key FROM financial.catalog_items WHERE operator_id = $1 ORDER BY key",
      [operatorId]
    );
    expect(adminKeys.rows).toEqual([{ key: "job-autonomia" }]);
    expect(financialKeys.rows).toEqual([{ key: "google-saas" }, { key: "job-autonomia" }]);
  });

  it("allows the target key when it belongs to a different operator", async () => {
    const sourceOperator = "30000000-0000-4000-8000-000000000001";
    const targetOperator = "30000000-0000-4000-8000-000000000002";
    await database.query(
      `INSERT INTO financial.catalog_items (operator_id, type, key)
       VALUES
         ($1, 'product', 'job-autonomia'),
         ($2, 'product', 'google-saas')`,
      [sourceOperator, targetOperator]
    );

    await runMigration();

    const rows = await database.query(
      `SELECT operator_id, key
       FROM financial.catalog_items
       ORDER BY operator_id`
    );
    expect(rows.rows).toEqual([
      { operator_id: sourceOperator, key: "google-saas" },
      { operator_id: targetOperator, key: "google-saas" }
    ]);
  });
});

async function runMigration() {
  await database.query(migrationSql);
}

function assertDisposableDatabase(connectionString: string) {
  const parsed = new URL(connectionString);
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) || !databaseName.endsWith("_test")) {
    throw new Error("Migration tests refuse to modify a non-local or non-test database.");
  }
}
