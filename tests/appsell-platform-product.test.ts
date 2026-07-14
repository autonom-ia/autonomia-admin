import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildProductUpsertedEvent } from "../src/auth-sync.js";
import { AdminRepository } from "../src/repository.js";
import { buildProductFinancialCatalogUpsertedEvent } from "../src/financial-sync.js";
import {
  assertConnectedLocalDatabase,
  assertLocalMigrationEnvironment
} from "../src/local-migration-guard.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Autonom.ia Sell product tests require disposable PostgreSQL.");
}

const localTarget = assertLocalMigrationEnvironment(process.env);
const database = new Pool({ connectionString: databaseUrl, ssl: false });
const repository = new AdminRepository(database);
const migrationPath = join(
  process.cwd(),
  "database",
  "migrations",
  "015_register_appsell_platform_product.sql"
);
let migrationSql: string;

beforeAll(async () => {
  await assertConnectedLocalDatabase(database, localTarget);
  migrationSql = await readFile(migrationPath, "utf8");
});

beforeEach(async () => {
  await database.query("DELETE FROM admin.products WHERE key IN ('appsell', 'unrelated-product')");
});

afterAll(async () => {
  await database.query("DELETE FROM admin.products WHERE key = 'unrelated-product'");
  await database.query(migrationSql);
  await database.end();
});

describe("Autonom.ia Sell platform product", () => {
  it("registers the inactive product idempotently without touching unrelated products", async () => {
    await database.query(
      "INSERT INTO admin.products (key, name, status) VALUES ('unrelated-product', 'Unrelated', 'active')"
    );

    await database.query(migrationSql);
    const first = (await repository.listProducts()).find((product) => product.key === "appsell");
    await database.query(migrationSql);
    const second = (await repository.listProducts()).find((product) => product.key === "appsell");
    const unrelated = await database.query(
      "SELECT key, name, status FROM admin.products WHERE key = 'unrelated-product'"
    );

    expect(first).toBeDefined();
    expect(second?.id).toBe(first?.id);
    expect(second).toMatchObject({
      key: "appsell",
      name: "Autonom.ia Sell",
      description: "Plataforma multi-tenant para venda e entrega de produtos digitais.",
      primaryColor: "#1E3A8A",
      accentColor: "#E64F18",
      oauthClientId: "appsell-web",
      allowedRedirectUris: ["https://sell.autonomia.site/auth/callback"],
      allowedLogoutUris: ["https://sell.autonomia.site/auth/login"],
      allowedOrigins: ["https://sell.autonomia.site"],
      allowGoogleLogin: false,
      allowGithubLogin: false,
      allowEmailPasswordLogin: true,
      allowPasskeyLogin: false,
      allowBackgroundAuth: false,
      status: "inactive"
    });
    expect(unrelated.rows).toEqual([{ key: "unrelated-product", name: "Unrelated", status: "active" }]);
  });

  it("fails closed instead of overwriting an existing divergent Autonom.ia Sell product", async () => {
    await database.query(
      "INSERT INTO admin.products (key, name, status) VALUES ('appsell', 'Divergent', 'active')"
    );

    await expect(database.query(migrationSql)).rejects.toThrow(
      "Existing Autonom.ia Sell product does not match the reviewed inactive platform contract."
    );

    const row = await database.query(
      "SELECT key, name, status FROM admin.products WHERE key = 'appsell'"
    );
    expect(row.rows).toEqual([{ key: "appsell", name: "Divergent", status: "active" }]);
  });

  it("rejects an unexpected callback without repairing or deleting the row", async () => {
    await database.query(migrationSql);
    await database.query(
      "UPDATE admin.products SET register_callback_url = 'https://unexpected.example/register' WHERE key = 'appsell'"
    );

    await expect(database.query(migrationSql)).rejects.toThrow(
      "Existing Autonom.ia Sell product does not match the reviewed inactive platform contract."
    );

    const row = await database.query(
      "SELECT key, register_callback_url FROM admin.products WHERE key = 'appsell'"
    );
    expect(row.rows).toEqual([{
      key: "appsell",
      register_callback_url: "https://unexpected.example/register"
    }]);
  });

  it("builds exact inactive Identity and Financial projection envelopes", async () => {
    await database.query(migrationSql);
    const product = (await repository.listProducts()).find((candidate) => candidate.key === "appsell");
    expect(product).toBeDefined();
    if (!product) throw new Error("Autonom.ia Sell product was not registered.");

    const metadata = {
      eventId: "17171717-1717-4717-8717-171717171717",
      occurredAt: "2026-07-14T00:00:00.000Z"
    };
    const identity = buildProductUpsertedEvent(product, metadata);
    const financial = buildProductFinancialCatalogUpsertedEvent(product, metadata);
    const corporateEnvelope = JSON.stringify({ identity, financial }).toLowerCase();

    expect(corporateEnvelope).not.toMatch(/seller|course|lesson|offer|buyer|entitlement/);

    expect(identity).toEqual({
      eventId: metadata.eventId,
      eventType: "admin.product.upserted",
      occurredAt: metadata.occurredAt,
      source: "admin",
      data: {
        productId: product.id,
        productKey: "appsell",
        name: "Autonom.ia Sell",
        description: "Plataforma multi-tenant para venda e entrega de produtos digitais.",
        logoUrl: null,
        primaryColor: "#1E3A8A",
        accentColor: "#E64F18",
        registerCallbackUrl: null,
        termsUrl: null,
        status: "inactive",
        oauth: {
          clientId: "appsell-web",
          allowedRedirectUris: ["https://sell.autonomia.site/auth/callback"],
          allowedLogoutUris: ["https://sell.autonomia.site/auth/login"],
          allowedOrigins: ["https://sell.autonomia.site"],
          allowGoogleLogin: false,
          allowGithubLogin: false,
          allowEmailPasswordLogin: true,
          allowPasskeyLogin: false,
          allowBackgroundAuth: false,
          accessTokenTtlSeconds: 3600,
          refreshTokenTtlSeconds: 2592000
        }
      }
    });
    expect(financial).toEqual({
      eventId: metadata.eventId,
      eventType: "admin.product.financial_catalog_upserted",
      occurredAt: metadata.occurredAt,
      source: "admin",
      data: {
        operatorKey: "autonom-ia",
        operatorName: "Autonom.ia",
        item: {
          sourceId: product.id,
          type: "product",
          key: "appsell",
          name: "Autonom.ia Sell",
          description: "Plataforma multi-tenant para venda e entrega de produtos digitais.",
          logoUrl: null,
          primaryColor: "#1E3A8A",
          accentColor: "#E64F18",
          registerCallbackUrl: null,
          termsUrl: null,
          status: "inactive"
        }
      }
    });
  });
});
