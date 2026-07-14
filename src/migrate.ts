import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPool } from "./db.js";

type MigrationDatabase = {
  query<T = unknown>(sql: string): Promise<{ rows: T[] }>;
};

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
  "011_add_user_soft_delete.sql",
  "012_add_platform_superadmin_rbac.sql",
  "013_add_organization_scope.sql",
  "014_add_financial_access_outbox.sql"
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
  "011_add_user_soft_delete.sql",
  "012_add_platform_superadmin_rbac.sql",
  "013_add_organization_scope.sql",
  "014_add_financial_access_outbox.sql",
  "015_register_appsell_platform_product.sql"
] as const;

export async function runMigrations(
  migrations: readonly string[] = PRODUCTION_MIGRATIONS
) {
  const pool = getPool();
  try {
    for (const migration of migrations) {
      await applyMigration(pool, migration);
    }
  } finally {
    await pool.end();
  }
}

export async function applyMigration(database: MigrationDatabase, migration: string) {
  if (migration === "005_create_organizations.sql") {
    const state = await database.query<{
      organizations: string | null;
      user_organizations: string | null;
    }>(
      `SELECT
         to_regclass('admin.organizations')::text AS organizations,
         to_regclass('admin.user_organizations')::text AS user_organizations`
    );
    const organizationsExists = state.rows[0]?.organizations === "admin.organizations";
    const membershipsExist = state.rows[0]?.user_organizations === "admin.user_organizations";
    if (organizationsExists !== membershipsExist) {
      throw new Error("Organization migration 005 is partially applied; refusing automatic repair.");
    }
    if (organizationsExists && membershipsExist) {
      console.info(`Skipped ${migration}; organization tables already exist.`);
      return;
    }
  }

  const sql = await readFile(join(process.cwd(), "database", "migrations", migration), "utf8");
  await database.query(sql);
  console.info(`Applied ${migration}`);
}
