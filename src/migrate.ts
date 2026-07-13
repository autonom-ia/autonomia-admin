import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPool } from "./db.js";

export const PRODUCTION_MIGRATIONS = [
  "001_create_admin_schema.sql",
  "002_add_profiles_and_customizations.sql",
  "003_add_product_oauth_settings.sql",
  "004_add_product_service_display_order.sql",
  "005_create_organizations.sql",
  "007_add_product_background_auth.sql",
  "008_rename_job_autonomia_product_key.sql",
  "009_add_product_registration_urls.sql",
  "010_configure_neuroai_registration_callback.sql",
  "011_add_user_soft_delete.sql"
] as const;

export const LOCAL_ADMIN_MIGRATIONS = [
  "001_create_admin_schema.sql",
  "002_add_profiles_and_customizations.sql",
  "003_add_product_oauth_settings.sql",
  "004_add_product_service_display_order.sql",
  "005_create_organizations.sql",
  "007_add_product_background_auth.sql",
  "009_add_product_registration_urls.sql",
  "010_configure_neuroai_registration_callback.sql",
  "011_add_user_soft_delete.sql"
] as const;

export async function runMigrations(
  migrations: readonly string[] = PRODUCTION_MIGRATIONS
) {
  const pool = getPool();
  try {
    for (const migration of migrations) {
      const sql = await readFile(join(process.cwd(), "database", "migrations", migration), "utf8");
      await pool.query(sql);
      console.info(`Applied ${migration}`);
    }
  } finally {
    await pool.end();
  }
}
