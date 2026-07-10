import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  it("accepts the signed Neuro flow only for a previously provisioned administrator", async () => {
    const subject = "11111111-1111-4111-8111-111111111111";
    const email = `neuro${testEmailSuffix}`;
    const userId = await provisionUser({ email, name: "Provisioned Neuro Admin" });
    const headers = await neuroHeaders({
      subject,
      email,
      name: "Neuro Admin"
    });

    const response = await app.inject({ method: "GET", url: "/admin/me", headers });
    const persisted = await database.query(
      "SELECT identity_user_id, profile_id FROM admin.users WHERE id = $1",
      [userId]
    );
    const memberships = await database.query(
      "SELECT count(*)::int AS count FROM admin.user_organizations WHERE user_id = $1",
      [userId]
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({
      email,
      name: "Neuro Admin",
      status: "active"
    });
    expect(persisted.rows[0]).toMatchObject({ identity_user_id: subject });
    expect(persisted.rows[0]?.profile_id).not.toBeNull();
    expect(memberships.rows[0]?.count).toBe(0);
  });

  it("rejects a valid Neuro identity that was not previously provisioned", async () => {
    const email = `not-provisioned${testEmailSuffix}`;
    const headers = await neuroHeaders({
      subject: "12121212-1212-4212-8212-121212121212",
      email,
      name: "Not Provisioned"
    });

    const response = await app.inject({ method: "GET", url: "/admin/me", headers });
    const persisted = await database.query("SELECT id FROM admin.users WHERE email = $1", [email]);

    expect(response.statusCode).toBe(403);
    expect(persisted.rowCount).toBe(0);
  });

  it("rejects an unlinked access token even when it contains profile-like claims", async () => {
    const email = `access-only-unlinked${testEmailSuffix}`;
    const token = await signAccessToken({
      subject: "22222222-2222-4222-8222-222222222222",
      email,
      name: "Access Only"
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/me",
      headers: { authorization: `Bearer ${token}` }
    });
    const persisted = await database.query("SELECT id FROM admin.users WHERE email = $1", [email]);

    expect(response.statusCode).toBe(403);
    expect(persisted.rowCount).toBe(0);
  });

  it("accepts an access-token-only request for a subject that is already linked", async () => {
    const subject = "23232323-2323-4232-8232-232323232323";
    const email = `access-only-linked${testEmailSuffix}`;
    await provisionUser({ identityUserId: subject, email, name: "Already Linked" });
    const token = await signAccessToken({
      subject,
      email: `ignored${testEmailSuffix}`,
      name: "Must Not Replace"
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/me",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ email, name: "Already Linked" });
  });

  it("does not create or pre-link an arbitrary identity through a missing admin user PATCH", async () => {
    const actorSubject = "24242424-2424-4242-8242-242424242424";
    await provisionUser({
      identityUserId: actorSubject,
      email: `patch-actor${testEmailSuffix}`,
      name: "Patch Actor"
    });
    const targetSubject = "25252525-2525-4252-8252-252525252525";
    const token = await signAccessToken({ subject: actorSubject });

    const response = await app.inject({
      method: "PATCH",
      url: `/admin/users/${targetSubject}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {}
    });
    const persisted = await database.query(
      `SELECT id
       FROM admin.users
       WHERE id = $1 OR identity_user_id = $1`,
      [targetSubject]
    );

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: "NOT_FOUND", message: "User not found." } });
    expect(persisted.rowCount).toBe(0);
  });

  it("does not link an identity when the provisioned email changes concurrently", async () => {
    const subject = "26262626-2626-4262-8262-262626262626";
    const oldEmail = `link-race-old${testEmailSuffix}`;
    const newEmail = `link-race-new${testEmailSuffix}`;
    const userId = await provisionUser({ email: oldEmail, name: "Link Race Candidate" });
    const headers = await neuroHeaders({ subject, email: oldEmail, name: "Old Email Principal" });
    const locker = await database.connect();
    let transactionOpen = false;
    let pendingRequest: Promise<Awaited<ReturnType<typeof app.inject>>> | undefined;
    try {
      await locker.query("BEGIN");
      transactionOpen = true;
      await locker.query("UPDATE admin.users SET email = $2 WHERE id = $1", [userId, newEmail]);

      pendingRequest = app.inject({ method: "GET", url: "/admin/me", headers });
      await waitForLinkQueryBlocked();
      await locker.query("COMMIT");
      transactionOpen = false;

      const response = await pendingRequest;
      const persisted = await database.query(
        "SELECT email, identity_user_id, name FROM admin.users WHERE id = $1",
        [userId]
      );
      expect(response.statusCode).toBe(403);
      expect(persisted.rows[0]).toMatchObject({
        email: newEmail,
        identity_user_id: null,
        name: "Link Race Candidate"
      });
    } finally {
      if (transactionOpen) await locker.query("ROLLBACK");
      locker.release();
      await pendingRequest?.catch(() => undefined);
    }
  });

  it("allows only one subject to win a concurrent first link", async () => {
    const email = `concurrent-link${testEmailSuffix}`;
    await provisionUser({ email, name: "Concurrent Link Candidate" });
    const subjects = [
      "27272727-2727-4272-8272-272727272727",
      "28282828-2828-4282-8282-282828282828"
    ];
    const [headersOne, headersTwo] = await Promise.all([
      neuroHeaders({ subject: subjects[0]!, email, name: "Principal One" }),
      neuroHeaders({ subject: subjects[1]!, email, name: "Principal Two" })
    ]);

    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/admin/me", headers: headersOne }),
      app.inject({ method: "GET", url: "/admin/me", headers: headersTwo })
    ]);
    const persisted = await database.query(
      "SELECT identity_user_id FROM admin.users WHERE email = $1",
      [email]
    );

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 403]);
    expect(subjects).toContain(persisted.rows[0]?.identity_user_id);
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

  it("rejects an identity token whose email is not verified and does not link it", async () => {
    const subject = "89898989-8989-4898-8989-898989898989";
    const email = `unverified${testEmailSuffix}`;
    await provisionUser({ email, name: "Awaiting Verified Identity" });
    const accessToken = await signAccessToken({ subject });
    const identityToken = await signIdentityToken({
      subject,
      email,
      name: "Unverified Identity",
      emailVerified: false
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/me",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-identity-token": identityToken
      }
    });
    const persisted = await database.query("SELECT identity_user_id FROM admin.users WHERE email = $1", [email]);

    expect(response.statusCode).toBe(401);
    expect(persisted.rows[0]?.identity_user_id).toBeNull();
  });

  it("does not reactivate an inactive user during login", async () => {
    const subject = "99999999-9999-4999-8999-999999999999";
    const email = `inactive${testEmailSuffix}`;
    await provisionUser({ email, name: "Provisioned Active" });
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
    await provisionUser({ email, name: "Provisioned Deleted User" });
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

async function signIdentityToken(input: { subject: string; email: string; name: string; emailVerified?: boolean }) {
  return new SignJWT({
    email: input.email,
    name: input.name,
    email_verified: input.emailVerified ?? true,
    token_use: "id"
  })
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

async function waitForLinkQueryBlocked(timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await database.query(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_stat_activity
         WHERE datname = current_database()
           AND pid <> pg_backend_pid()
           AND wait_event_type = 'Lock'
           AND query LIKE '%WITH candidates AS MATERIALIZED%'
       ) AS blocked`
    );
    if (result.rows[0]?.blocked === true) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the first-link query to block on the concurrent email update.");
}

async function provisionUser(input: {
  identityUserId?: string;
  email: string;
  name: string;
  status?: "active" | "inactive" | "invited";
}) {
  const result = await database.query(
    `INSERT INTO admin.users (identity_user_id, email, name, profile_id, status)
     VALUES (
       $1,
       $2,
       $3,
       (SELECT id FROM admin.profiles WHERE key = 'autonomia_master'),
       $4
     )
     RETURNING id`,
    [input.identityUserId ?? null, input.email, input.name, input.status ?? "active"]
  );
  return String(result.rows[0].id);
}
