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
const financialSchemaFixturePath = join(process.cwd(), "tests", "fixtures", "financial-catalog-schema.sql");
let migrationSql: string;

beforeAll(async () => {
  migrationSql = await readFile(migrationPath, "utf8");
  await database.query("DROP SCHEMA IF EXISTS financial CASCADE");
  await database.query(await readFile(financialSchemaFixturePath, "utf8"));
});

beforeEach(async () => {
  await database.query("TRUNCATE financial.catalog_items, financial.operators CASCADE");
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
    const operatorThree = "10000000-0000-4000-8000-000000000003";
    await seedOperators([
      [operatorOne, "operator-one"],
      [operatorTwo, "operator-two"],
      [operatorThree, "operator-three"]
    ]);
    await database.query("INSERT INTO admin.products (key, name) VALUES ('job-autonomia', 'Job Autonomia')");
    await database.query(
      `INSERT INTO financial.catalog_items (operator_id, type, key, name)
       VALUES
         ($1, 'product', 'job-autonomia', 'Job Autonomia One'),
         ($2, 'product', 'job-autonomia', 'Job Autonomia Two'),
         ($3, 'service', 'job-autonomia', 'Job Autonomia Service')`,
      [operatorOne, operatorTwo, operatorThree]
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
      { operator_id: operatorTwo, type: "product", key: "google-saas" },
      { operator_id: operatorThree, type: "service", key: "job-autonomia" }
    ]);
  });

  it("rejects a product-key collision for the same operator and rolls back", async () => {
    const operatorId = "20000000-0000-4000-8000-000000000001";
    await seedOperators([[operatorId, "collision-product"]]);
    await database.query("INSERT INTO admin.products (key, name) VALUES ('job-autonomia', 'Job Autonomia')");
    await database.query(
      `INSERT INTO financial.catalog_items (operator_id, type, key, name)
       VALUES
         ($1, 'product', 'job-autonomia', 'Job Autonomia'),
         ($1, 'product', 'google-saas', 'Google SaaS')`,
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

  it("rejects a target key of another type for the same operator and rolls back", async () => {
    const operatorId = "25000000-0000-4000-8000-000000000001";
    await seedOperators([[operatorId, "collision-service"]]);
    await database.query("INSERT INTO admin.products (key, name) VALUES ('job-autonomia', 'Job Autonomia')");
    await database.query(
      `INSERT INTO financial.catalog_items (operator_id, type, key, name)
       VALUES
         ($1, 'product', 'job-autonomia', 'Job Autonomia'),
         ($1, 'service', 'google-saas', 'Google SaaS Service')`,
      [operatorId]
    );

    await expect(runMigration()).rejects.toThrow(
      "Cannot rename financial product job-autonomia to google-saas because google-saas already exists for the same operator."
    );

    const adminKeys = await database.query(
      "SELECT key FROM admin.products WHERE key IN ('job-autonomia', 'google-saas') ORDER BY key"
    );
    const financialKeys = await database.query(
      "SELECT type, key FROM financial.catalog_items WHERE operator_id = $1 ORDER BY key",
      [operatorId]
    );
    expect(adminKeys.rows).toEqual([{ key: "job-autonomia" }]);
    expect(financialKeys.rows).toEqual([
      { type: "service", key: "google-saas" },
      { type: "product", key: "job-autonomia" }
    ]);
  });

  it("allows the target key when it belongs to a different operator", async () => {
    const sourceOperator = "30000000-0000-4000-8000-000000000001";
    const targetOperator = "30000000-0000-4000-8000-000000000002";
    await seedOperators([
      [sourceOperator, "source-operator"],
      [targetOperator, "target-operator"]
    ]);
    await database.query(
      `INSERT INTO financial.catalog_items (operator_id, type, key, name)
       VALUES
         ($1, 'product', 'job-autonomia', 'Job Autonomia'),
         ($2, 'product', 'google-saas', 'Google SaaS')`,
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

async function seedOperators(operators: Array<[id: string, key: string]>) {
  for (const [id, key] of operators) {
    await database.query(
      "INSERT INTO financial.operators (id, key, name) VALUES ($1, $2, $3)",
      [id, key, key]
    );
  }
}

function assertDisposableDatabase(connectionString: string) {
  const parsed = new URL(connectionString);
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) || !databaseName.endsWith("_test")) {
    throw new Error("Migration tests refuse to modify a non-local or non-test database.");
  }
}
