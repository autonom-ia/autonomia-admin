import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPool } from "./db.js";

const migrations = [
  "001_create_admin_schema.sql",
  "002_add_profiles_and_customizations.sql",
  "003_add_product_oauth_settings.sql",
  "004_add_product_service_display_order.sql",
  "005_create_organizations.sql",
  "007_add_product_background_auth.sql"
];

export async function runMigrations() {
  const pool = getPool();
  for (const migration of migrations) {
    const sql = await readFile(join(process.cwd(), "database", "migrations", migration), "utf8");
    await pool.query(sql);
    console.info(`Applied ${migration}`);
  }
  await pool.end();
}

if (process.argv[1]?.endsWith("migrate.js") || process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
