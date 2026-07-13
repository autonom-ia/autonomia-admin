export const LOCAL_ADMIN_DATABASE = "autonomia_admin_local";
export const LOCAL_MIGRATION_CONFIRMATION = "autonomia_admin_local";

const LOCAL_HOST = "127.0.0.1";
const LOCAL_PORT = 5432;
const INSTANCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type LocalMigrationTarget = {
  hostname: string;
  port: number;
  databaseName: string;
  databaseInstanceId: string;
};

export type LocalDatabaseIdentity = {
  database_name: string;
  database_settings: string[];
  server_address: string | null;
  server_port: number | null;
};

type IdentityQuery = {
  query<T>(sql: string): Promise<{ rows: T[] }>;
};

export function assertLocalMigrationEnvironment(
  env: NodeJS.ProcessEnv
): LocalMigrationTarget {
  if (env.APP_ENV !== "local") {
    throw new Error("APP_ENV must be exactly 'local' for local migrations");
  }
  if (env.ADMIN_LOCAL_MIGRATION_CONFIRM !== LOCAL_MIGRATION_CONFIRMATION) {
    throw new Error("ADMIN_LOCAL_MIGRATION_CONFIRM does not match the local database");
  }
  const databaseInstanceId = env.ADMIN_LOCAL_DATABASE_INSTANCE_ID ?? "";
  if (!INSTANCE_ID.test(databaseInstanceId)) {
    throw new Error("ADMIN_LOCAL_DATABASE_INSTANCE_ID must be a canonical UUID");
  }
  if (env.DATABASE_SSL_MODE !== "disable") {
    throw new Error("DATABASE_SSL_MODE must be 'disable' for the local database");
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("PG") && value) {
      throw new Error(`${key} is not allowed for local migrations`);
    }
  }

  let url: URL;
  try {
    url = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use postgres or postgresql");
  }
  if (url.search || url.hash) {
    throw new Error("DATABASE_URL query parameters and fragments are not allowed");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = Number(url.port || "5432");
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (hostname !== LOCAL_HOST) {
    throw new Error(`Local migrations require literal host ${LOCAL_HOST}`);
  }
  if (port !== LOCAL_PORT) {
    throw new Error(`Local migrations require port ${LOCAL_PORT}; tunnels are refused`);
  }
  if (databaseName !== LOCAL_ADMIN_DATABASE) {
    throw new Error(`Local migrations require database ${LOCAL_ADMIN_DATABASE}`);
  }

  return { hostname, port, databaseName, databaseInstanceId };
}

export function assertLocalDatabaseIdentity(
  identity: LocalDatabaseIdentity,
  target: LocalMigrationTarget
) {
  if (identity.database_name !== LOCAL_ADMIN_DATABASE) {
    throw new Error("Connected database name is not the isolated local database");
  }
  const expectedSettings = [
    "app.environment=local",
    `app.local_instance_id=${target.databaseInstanceId}`
  ];
  if (JSON.stringify(identity.database_settings) !== JSON.stringify(expectedSettings)) {
    throw new Error("Connected database is missing its exact persistent local identity");
  }
  if (identity.server_address !== LOCAL_HOST || identity.server_port !== LOCAL_PORT) {
    throw new Error("Connected PostgreSQL server is not the approved loopback instance");
  }
}

export async function assertConnectedLocalDatabase(
  database: IdentityQuery,
  target: LocalMigrationTarget
): Promise<LocalDatabaseIdentity> {
  const result = await database.query<LocalDatabaseIdentity>(`
    SELECT
      current_database() AS database_name,
      COALESCE(ARRAY(
        SELECT setting_entry
        FROM pg_db_role_setting setting
        CROSS JOIN LATERAL unnest(setting.setconfig) AS setting_entry
        WHERE setting.setdatabase = (
          SELECT oid FROM pg_database WHERE datname = current_database()
        )
          AND setting.setrole = 0
          AND (
            setting_entry LIKE 'app.environment=%'
            OR setting_entry LIKE 'app.local_instance_id=%'
          )
        ORDER BY setting_entry
      ), ARRAY[]::text[]) AS database_settings,
      host(inet_server_addr()) AS server_address,
      inet_server_port() AS server_port
  `);
  const identity = result.rows[0];
  if (!identity) throw new Error("Could not read local database identity");
  assertLocalDatabaseIdentity(identity, target);
  return identity;
}
