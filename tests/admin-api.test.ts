import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertConnectedLocalDatabase,
  assertLocalMigrationEnvironment
} from "../src/local-migration-guard.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Admin API tests must run against a real disposable PostgreSQL database.");
}

const issuer = "https://identity.admin-auth.test";
const audience = "admin-auth-test-client";
const keyId = "admin-auth-test-key";
const testEmailSuffix = "@admin-auth.test";

let app: FastifyInstance;
let database: Pool;
let jwksServer: Server;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let closeApplicationPool: () => Promise<void>;

beforeAll(async () => {
  const target = assertLocalMigrationEnvironment(process.env);
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const publicJwk = await exportJWK(keys.publicKey);
  Object.assign(publicJwk, { alg: "RS256", kid: keyId, use: "sig" });

  jwksServer = createServer((request, response) => {
    if (request.url !== "/.well-known/jwks.json") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
  const address = jwksServer.address() as AddressInfo;

  process.env.JWT_ISSUER = issuer;
  process.env.JWT_AUDIENCE = audience;
  process.env.JWKS_URL = `http://127.0.0.1:${address.port}/.well-known/jwks.json`;

  const [{ buildServer }, { closePool }] = await Promise.all([
    import("../src/server.js"),
    import("../src/db.js")
  ]);
  closeApplicationPool = closePool;
  app = await buildServer();
  database = new Pool({ connectionString: databaseUrl, ssl: false });
  await assertConnectedLocalDatabase(database, target);
  await database.query("SELECT 1 FROM admin.users LIMIT 1");
  await removeTestUsers();
});

afterAll(async () => {
  await removeTestUsers();
  await app?.close();
  await closeApplicationPool?.();
  await database?.end();
  await new Promise<void>((resolve, reject) => {
    jwksServer?.close((error) => error ? reject(error) : resolve());
  });
});

describe("admin api authentication", () => {
  it("accepts the signed Neuro access and identity token flow", async () => {
    const subject = "11111111-1111-4111-8111-111111111111";
    const headers = await neuroHeaders({
      subject,
      email: `neuro${testEmailSuffix}`,
      name: "Neuro Admin"
    });

    const response = await app.inject({ method: "GET", url: "/admin/me", headers });

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({
      email: `neuro${testEmailSuffix}`,
      name: "Neuro Admin",
      status: "active"
    });
  });

  it("accepts a signed access token when it contains the profile claims", async () => {
    const token = await signAccessToken({
      subject: "22222222-2222-4222-8222-222222222222",
      email: `access-only${testEmailSuffix}`,
      name: "Access Only"
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/me",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ email: `access-only${testEmailSuffix}`, name: "Access Only" });
  });

  it("rejects an unsigned access token", async () => {
    const token = unsignedToken({
      sub: "33333333-3333-4333-8333-333333333333",
      email: `unsigned${testEmailSuffix}`,
      token_use: "access",
      client_id: audience,
      iss: issuer
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/me",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects a signed access token with the wrong issuer", async () => {
    const token = await signAccessToken({
      subject: "44444444-4444-4444-8444-444444444444",
      email: `issuer${testEmailSuffix}`,
      issuer: "https://wrong-issuer.admin-auth.test"
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/me",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects a signed access token with the wrong client audience", async () => {
    const token = await signAccessToken({
      subject: "55555555-5555-4555-8555-555555555555",
      email: `audience${testEmailSuffix}`,
      audience: "another-client"
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/me",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects an ID token used as the bearer access token", async () => {
    const token = await signIdentityToken({
      subject: "5a5a5a5a-5555-4555-8555-555555555555",
      email: `token-use${testEmailSuffix}`,
      name: "Wrong Token Use"
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/me",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects identity and access tokens with different subjects", async () => {
    const accessToken = await signAccessToken({ subject: "66666666-6666-4666-8666-666666666666" });
    const identityToken = await signIdentityToken({
      subject: "77777777-7777-4777-8777-777777777777",
      email: `mismatch${testEmailSuffix}`,
      name: "Mismatch"
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/me",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-identity-token": identityToken
      }
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects an identity token with an invalid signature", async () => {
    const subject = "88888888-8888-4888-8888-888888888888";
    const accessToken = await signAccessToken({ subject });
    const untrustedKeys = await generateKeyPair("RS256");
    const identityToken = await new SignJWT({
      email: `bad-signature${testEmailSuffix}`,
      name: "Bad Signature",
      token_use: "id"
    })
      .setProtectedHeader({ alg: "RS256", kid: keyId })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(untrustedKeys.privateKey);

    const response = await app.inject({
      method: "GET",
      url: "/admin/me",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-identity-token": identityToken
      }
    });

    expect(response.statusCode).toBe(401);
  });

  it("does not reactivate an inactive user during login", async () => {
    const subject = "99999999-9999-4999-8999-999999999999";
    const email = `inactive${testEmailSuffix}`;
    const initialHeaders = await neuroHeaders({ subject, email, name: "Active Before" });
    expect((await app.inject({ method: "GET", url: "/admin/me", headers: initialHeaders })).statusCode).toBe(200);
    await database.query("UPDATE admin.users SET status = 'inactive' WHERE email = $1", [email]);

    const retryHeaders = await neuroHeaders({ subject, email, name: "Must Not Sync" });
    const response = await app.inject({ method: "GET", url: "/admin/me", headers: retryHeaders });
    const persisted = await database.query("SELECT name, status, deleted_at FROM admin.users WHERE email = $1", [email]);

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: { code: "FORBIDDEN", message: "Administrative user is not active." } });
    expect(persisted.rows[0]).toMatchObject({ name: "Active Before", status: "inactive", deleted_at: null });
  });

  it("does not restore a soft-deleted user during login", async () => {
    const subject = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const email = `deleted${testEmailSuffix}`;
    const headers = await neuroHeaders({ subject, email, name: "Deleted User" });
    expect((await app.inject({ method: "GET", url: "/admin/me", headers })).statusCode).toBe(200);
    await database.query("UPDATE admin.users SET status = 'inactive', deleted_at = now() WHERE email = $1", [email]);

    const response = await app.inject({ method: "GET", url: "/admin/me", headers });
    const persisted = await database.query("SELECT status, deleted_at FROM admin.users WHERE email = $1", [email]);

    expect(response.statusCode).toBe(403);
    expect(persisted.rows[0]?.status).toBe("inactive");
    expect(persisted.rows[0]?.deleted_at).toBeInstanceOf(Date);
  });
});

async function neuroHeaders(input: { subject: string; email: string; name: string }) {
  const [accessToken, identityToken] = await Promise.all([
    signAccessToken({ subject: input.subject }),
    signIdentityToken(input)
  ]);
  return {
    authorization: `Bearer ${accessToken}`,
    "x-identity-token": identityToken
  };
}

async function signAccessToken(input: {
  subject: string;
  email?: string;
  name?: string;
  issuer?: string;
  audience?: string;
}) {
  return new SignJWT({
    ...(input.email ? { email: input.email } : {}),
    ...(input.name ? { name: input.name } : {}),
    token_use: "access",
    client_id: input.audience ?? audience
  })
    .setProtectedHeader({ alg: "RS256", kid: keyId })
    .setIssuer(input.issuer ?? issuer)
    .setSubject(input.subject)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

async function signIdentityToken(input: { subject: string; email: string; name: string }) {
  return new SignJWT({ email: input.email, name: input.name, email_verified: true, token_use: "id" })
    .setProtectedHeader({ alg: "RS256", kid: keyId })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(input.subject)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

function unsignedToken(payload: Record<string, unknown>) {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    ""
  ].join(".");
}

async function removeTestUsers() {
  if (!database) return;
  await database.query("DELETE FROM admin.users WHERE email LIKE $1", [`%${testEmailSuffix}`]);
}
