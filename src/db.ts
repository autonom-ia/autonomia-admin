import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

let pool: pg.Pool | undefined;

export function getPool() {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required. The Admin API must use the shared Auth RDS with schema admin.");
  }

  pool ??= new Pool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    ssl: resolveSslConfig()
  });

  return pool;
}

function resolveSslConfig(): pg.PoolConfig["ssl"] {
  if (!config.databaseSslMode || config.databaseSslMode === "disable") return undefined;
  return {
    rejectUnauthorized: config.databaseSslRejectUnauthorized
  };
}
