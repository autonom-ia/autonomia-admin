import { describe, expect, it } from "vitest";
import {
  assertLocalDatabaseIdentity,
  assertLocalMigrationEnvironment
} from "../src/local-migration-guard.js";
import { LOCAL_ADMIN_MIGRATIONS, PRODUCTION_MIGRATIONS } from "../src/migrate.js";

const safeEnv = {
  APP_ENV: "local",
  ADMIN_LOCAL_MIGRATION_CONFIRM: "autonomia_admin_local",
  ADMIN_LOCAL_DATABASE_INSTANCE_ID: "7e59b86a-4883-4b38-b3c7-68ce5a3c3f30",
  DATABASE_SSL_MODE: "disable",
  DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/autonomia_admin_local"
};

describe("local migration guard", () => {
  it("excludes the cross-project Financial migration from the local runner", () => {
    expect(PRODUCTION_MIGRATIONS).toContain("008_rename_job_autonomia_product_key.sql");
    expect(LOCAL_ADMIN_MIGRATIONS).not.toContain("008_rename_job_autonomia_product_key.sql");
    expect(LOCAL_ADMIN_MIGRATIONS).toEqual([
      "001_create_admin_schema.sql",
      "002_add_profiles_and_customizations.sql",
      "003_add_product_oauth_settings.sql",
      "004_add_product_service_display_order.sql",
      "005_create_organizations.sql",
      "007_add_product_background_auth.sql",
      "009_add_product_registration_urls.sql",
      "010_configure_neuroai_registration_callback.sql",
      "011_add_user_soft_delete.sql"
    ]);
  });

  it("accepts the isolated IPv4 local database", () => {
    expect(assertLocalMigrationEnvironment(safeEnv)).toEqual({
      hostname: "127.0.0.1",
      port: 5432,
      databaseName: "autonomia_admin_local",
      databaseInstanceId: "7e59b86a-4883-4b38-b3c7-68ce5a3c3f30"
    });
  });

  it.each([
    ["localhost alias", { DATABASE_URL: "postgres://u:p@localhost:5432/autonomia_admin_local" }],
    ["IPv6 loopback", { DATABASE_URL: "postgres://u:p@[::1]:5432/autonomia_admin_local" }],
    ["remote host", { DATABASE_URL: "postgres://u:p@db.example.com:5432/autonomia_admin_local" }],
    ["SSM tunnel port", { DATABASE_URL: "postgres://u:p@127.0.0.1:5433/autonomia_admin_local" }],
    ["shared database", { DATABASE_URL: "postgres://u:p@127.0.0.1:5432/autonomia_identity" }],
    ["missing confirmation", { ADMIN_LOCAL_MIGRATION_CONFIRM: "" }],
    ["missing instance identity", { ADMIN_LOCAL_DATABASE_INSTANCE_ID: "" }],
    ["invalid instance identity", { ADMIN_LOCAL_DATABASE_INSTANCE_ID: "not-a-uuid" }],
    ["wrong environment", { APP_ENV: "production" }],
    ["libpq service override", { PGSERVICE: "production" }],
    ["libpq options override", { PGOPTIONS: "-c app.environment=local" }],
    ["libpq password file override", { PGPASSFILE: "/tmp/production.pgpass" }],
    ["connection query redirect", {
      DATABASE_URL: "postgres://u:p@127.0.0.1:5432/autonomia_admin_local?host=db.example.internal&port=5432"
    }],
    ["connection query options", {
      DATABASE_URL: "postgres://u:p@127.0.0.1:5432/autonomia_admin_local?options=-c%20app.environment%3Dlocal"
    }],
    ["connection fragment", {
      DATABASE_URL: "postgres://u:p@127.0.0.1:5432/autonomia_admin_local#remote"
    }]
  ])("rejects %s", (_name, override) => {
    expect(() => assertLocalMigrationEnvironment({ ...safeEnv, ...override })).toThrow();
  });

  it("accepts only the exact persistent database-level local identity", () => {
    const target = assertLocalMigrationEnvironment(safeEnv);
    expect(() =>
      assertLocalDatabaseIdentity({
        database_name: "autonomia_admin_local",
        database_settings: [
          "app.environment=local",
          "app.local_instance_id=7e59b86a-4883-4b38-b3c7-68ce5a3c3f30"
        ],
        server_address: "127.0.0.1",
        server_port: 5432
      }, target)
    ).not.toThrow();
  });

  it.each([
    ["wrong database", { database_name: "autonomia_identity" }],
    ["missing persistent settings", { database_settings: [] }],
    ["session-spoofed marker", { database_settings: ["app.environment=local"] }],
    ["wrong instance identity", { database_settings: [
      "app.environment=local",
      "app.local_instance_id=2b09158f-8495-4ba4-9190-bae45f2d4fac"
    ] }],
    ["remote server address", { server_address: "10.0.0.5" }],
    ["wrong server port", { server_port: 9999 }],
    ["missing address", { server_address: null }]
  ])("rejects connected identity with %s", (_name, override) => {
    const target = assertLocalMigrationEnvironment(safeEnv);
    expect(() =>
      assertLocalDatabaseIdentity({
        database_name: "autonomia_admin_local",
        database_settings: [
          "app.environment=local",
          "app.local_instance_id=7e59b86a-4883-4b38-b3c7-68ce5a3c3f30"
        ],
        server_address: "127.0.0.1",
        server_port: 5432,
        ...override
      }, target)
    ).toThrow();
  });
});
