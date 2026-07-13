import { getPool } from "../src/db.js";
import {
  assertConnectedLocalDatabase,
  assertLocalMigrationEnvironment
} from "../src/local-migration-guard.js";
import { LOCAL_ADMIN_MIGRATIONS, runMigrations } from "../src/migrate.js";

async function main() {
  const target = assertLocalMigrationEnvironment(process.env);
  const pool = getPool();
  let migrationStarted = false;
  try {
    const identity = await assertConnectedLocalDatabase(pool, target);
    console.info(
      `Local migration preflight passed for ${target.databaseName} at ${identity.server_address}:${identity.server_port}`
    );
    migrationStarted = true;
    await runMigrations(LOCAL_ADMIN_MIGRATIONS);
  } finally {
    if (!migrationStarted) await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
