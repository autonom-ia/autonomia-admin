import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
const platformSuperadminSubject = "10101010-1010-4010-8010-101010101010";
const platformSuperadminEmail = "comercial@autonomia.site";
const autonomiaOrganizationId = "14002337-5763-4000-8000-000000000001";
const hub2youOrganizationId = "14002337-5763-4000-8000-000000000002";

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
  process.env.ADMIN_PLATFORM_SUPERADMIN_IDENTITY_SUB = platformSuperadminSubject;
  process.env.ADMIN_PLATFORM_SUPERADMIN_EMAIL = platformSuperadminEmail;

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

beforeEach(async () => {
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
  it("bootstraps the configured commercial subject once and authorizes by persisted role", async () => {
    const headers = await neuroHeaders({
      subject: platformSuperadminSubject,
      email: platformSuperadminEmail,
      name: "Commercial Superadmin"
    });

    const first = await app.inject({ method: "GET", url: "/admin/me", headers });
    const retryToken = await signAccessToken({ subject: platformSuperadminSubject });
    const retry = await app.inject({
      method: "GET",
      url: "/admin/me",
      headers: { authorization: `Bearer ${retryToken}` }
    });
    const bootstrap = await database.query(
      `SELECT bootstrap.identity_sub, bootstrap.email_at_bootstrap, role.key
       FROM admin.platform_role_bootstrap bootstrap
       INNER JOIN admin.roles role ON role.id = bootstrap.role_id`
    );
    const roleLinks = await database.query(
      `SELECT count(*)::int AS count
       FROM admin.user_roles user_role
       INNER JOIN admin.users admin_user ON admin_user.id = user_role.user_id
       WHERE admin_user.identity_user_id = $1`,
      [platformSuperadminSubject]
    );

    expect(first.statusCode).toBe(200);
    expect(first.json().permissions).toEqual([
      "admin.organizations.read",
      "admin.organizations.write",
      "admin.products.read",
      "admin.products.write",
      "admin.services.read",
      "admin.services.write",
      "admin.users.read",
      "admin.users.write",
      "financial.admin"
    ]);
    expect(retry.statusCode).toBe(200);
    expect(bootstrap.rows).toEqual([{
      identity_sub: platformSuperadminSubject,
      email_at_bootstrap: platformSuperadminEmail,
      key: "platform_superadmin"
    }]);
    expect(roleLinks.rows[0]?.count).toBe(1);

    const changedEmailClaimToken = await signAccessToken({
      subject: platformSuperadminSubject,
      email: `claim-only${testEmailSuffix}`
    });
    const afterEmailChange = await app.inject({
      method: "GET",
      url: "/admin/products",
      headers: { authorization: `Bearer ${changedEmailClaimToken}` }
    });
    expect(afterEmailChange.statusCode).toBe(200);
  });

  it("blocks invitation, alteration, deactivation and deletion of the bootstrapped user", async () => {
    const hadAuthSchema = (await database.query("SELECT to_regnamespace('auth') AS value")).rows[0]?.value !== null;
    const hadAuthUsers = (await database.query("SELECT to_regclass('auth.users') AS value")).rows[0]?.value !== null;
    if (!hadAuthUsers) {
      await database.query(`
        CREATE SCHEMA IF NOT EXISTS auth;
        CREATE TABLE auth.users (
          id uuid PRIMARY KEY,
          cognito_sub text,
          email_normalized text NOT NULL,
          status text NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
      `);
    }
    try {
      const headers = await neuroHeaders({
        subject: platformSuperadminSubject,
        email: platformSuperadminEmail,
        name: "Protected Superadmin"
      });
      const bootstrap = await app.inject({ method: "GET", url: "/admin/me", headers });
      const userId = String(bootstrap.json().user.id);
      const token = await signAccessToken({ subject: platformSuperadminSubject });
      const accessHeaders = {
        authorization: `Bearer ${token}`,
        "x-organization-id": autonomiaOrganizationId
      };
      const authUserId = "14101010-1010-4010-8010-101010101010";
      await database.query(
        `INSERT INTO auth.users (id, cognito_sub, email_normalized, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (id) DO UPDATE SET status = 'active', updated_at = now()`,
        [authUserId, platformSuperadminSubject, platformSuperadminEmail]
      );

      const invitation = await app.inject({
        method: "POST",
        url: "/admin/users/invitations",
        headers: accessHeaders,
        payload: { email: platformSuperadminEmail, name: "Conflicting Invitation" }
      });
      const alteration = await app.inject({
        method: "PATCH",
        url: `/admin/users/${userId}`,
        headers: accessHeaders,
        payload: { status: "inactive" }
      });
      const deactivate = await app.inject({
        method: "POST",
        url: `/admin/users/${userId}/deactivate`,
        headers: accessHeaders
      });
      const remove = await app.inject({
        method: "DELETE",
        url: `/admin/users/${userId}`,
        headers: accessHeaders
      });
      const persisted = await database.query(
        `SELECT admin_user.email, admin_user.status, admin_user.deleted_at,
                count(bootstrap.id)::int AS bootstrap_count
         FROM admin.users admin_user
         LEFT JOIN admin.platform_role_bootstrap bootstrap ON bootstrap.user_id = admin_user.id
         WHERE admin_user.id = $1
         GROUP BY admin_user.id`,
        [userId]
      );
      const authUser = await database.query("SELECT status FROM auth.users WHERE id = $1", [authUserId]);

      expect([invitation, alteration, deactivate, remove].map((response) => response.statusCode))
        .toEqual([409, 409, 409, 409]);
      expect(persisted.rows[0]).toMatchObject({
        email: platformSuperadminEmail,
        status: "active",
        deleted_at: null,
        bootstrap_count: 1
      });
      expect(authUser.rows).toEqual([{ status: "active" }]);
    } finally {
      await database.query("DELETE FROM auth.users WHERE cognito_sub = $1", [platformSuperadminSubject]);
      if (!hadAuthUsers) await database.query("DROP TABLE auth.users");
      if (!hadAuthSchema) await database.query("DROP SCHEMA auth");
    }
  });

  it("does not let another subject claim the reserved commercial identity", async () => {
    const wrongSubject = "11101010-1010-4010-8010-101010101010";
    const headers = await neuroHeaders({
      subject: wrongSubject,
      email: platformSuperadminEmail,
      name: "Wrong Commercial Subject"
    });

    const response = await app.inject({ method: "GET", url: "/admin/me", headers });
    const users = await database.query(
      "SELECT id FROM admin.users WHERE identity_user_id = $1 OR lower(email) = lower($2)",
      [wrongSubject, platformSuperadminEmail]
    );
    const audit = await database.query("SELECT id FROM admin.platform_role_bootstrap");

    expect(response.statusCode).toBe(403);
    expect(users.rowCount).toBe(0);
    expect(audit.rowCount).toBe(0);
  });

  it("does not let a tenant invitation reserve the commercial identity before bootstrap", async () => {
    const actorSubject = "10a01010-1010-4010-8010-101010101010";
    const actorId = await provisionUser({
      identityUserId: actorSubject,
      email: `commercial-invite-actor${testEmailSuffix}`,
      name: "Commercial Invite Actor"
    });
    await addMembership({
      userId: actorId,
      organizationId: autonomiaOrganizationId,
      role: "admin",
      isPrimary: true
    });
    const token = await signAccessToken({ subject: actorSubject });
    const response = await app.inject({
      method: "POST",
      url: "/admin/users/invitations",
      headers: {
        authorization: `Bearer ${token}`,
        "x-organization-id": autonomiaOrganizationId
      },
      payload: { email: platformSuperadminEmail, name: "Reserved Commercial" }
    });
    const persisted = await database.query(
      "SELECT id FROM admin.users WHERE lower(email) = lower($1)",
      [platformSuperadminEmail]
    );
    const bootstrap = await database.query("SELECT id FROM admin.platform_role_bootstrap");

    expect(response.statusCode).toBe(409);
    expect(persisted.rowCount).toBe(0);
    expect(bootstrap.rowCount).toBe(0);
  });

  it("does not bootstrap the configured subject without a verified identity token", async () => {
    const token = await signAccessToken({ subject: platformSuperadminSubject });

    const response = await app.inject({
      method: "GET",
      url: "/admin/me",
      headers: { authorization: `Bearer ${token}` }
    });
    const users = await database.query(
      "SELECT id FROM admin.users WHERE identity_user_id = $1 OR lower(email) = lower($2)",
      [platformSuperadminSubject, platformSuperadminEmail]
    );
    const audit = await database.query("SELECT id FROM admin.platform_role_bootstrap");

    expect(response.statusCode).toBe(403);
    expect(users.rowCount).toBe(0);
    expect(audit.rowCount).toBe(0);
  });

  it("does not bootstrap the configured subject with another verified email", async () => {
    const headers = await neuroHeaders({
      subject: platformSuperadminSubject,
      email: `not-commercial${testEmailSuffix}`,
      name: "Wrong Email"
    });

    const response = await app.inject({ method: "GET", url: "/admin/me", headers });
    const users = await database.query("SELECT id FROM admin.users WHERE identity_user_id = $1", [platformSuperadminSubject]);
    const audit = await database.query("SELECT id FROM admin.platform_role_bootstrap");

    expect(response.statusCode).toBe(403);
    expect(users.rowCount).toBe(0);
    expect(audit.rowCount).toBe(0);
  });

  it("returns no global permissions to a normal admin and denies writes without side effects", async () => {
    const subject = "12101010-1010-4010-8010-101010101010";
    const email = `no-rbac${testEmailSuffix}`;
    const userId = await provisionUser({ identityUserId: subject, email, name: "No RBAC" });
    await database.query(
      `INSERT INTO admin.user_organizations (user_id, organization_id, role, is_primary, status)
       SELECT $1, id, 'admin', true, 'active'
       FROM admin.organizations
       WHERE key = 'autonomia'`,
      [userId]
    );
    const token = await signAccessToken({ subject });
    const before = await database.query(
      "SELECT name, identity_user_id, updated_at FROM admin.users WHERE id = $1",
      [userId]
    );

    const me = await app.inject({
      method: "GET",
      url: "/admin/me",
      headers: { authorization: `Bearer ${token}` }
    });
    const denied = await app.inject({
      method: "POST",
      url: "/admin/products",
      headers: { authorization: `Bearer ${token}` },
      payload: { key: "x" }
    });
    const after = await database.query(
      "SELECT name, identity_user_id, updated_at FROM admin.users WHERE id = $1",
      [userId]
    );
    const products = await database.query("SELECT id FROM admin.products WHERE key = 'x'");

    expect(me.statusCode).toBe(200);
    expect(me.json().permissions).toEqual([]);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Insufficient administrative permission." }
    });
    expect(after.rows).toEqual(before.rows);
    expect(products.rowCount).toBe(0);
  });

  it("denies every global route family before payload parsing or external side effects", async () => {
    const subject = "13101010-1010-4010-8010-101010101010";
    await provisionUser({
      identityUserId: subject,
      email: `route-matrix${testEmailSuffix}`,
      name: "Route Matrix"
    });
    const token = await signAccessToken({ subject });
    const headers = { authorization: `Bearer ${token}` };
    const cases = [
      { method: "GET", url: "/admin/users" },
      { method: "POST", url: "/admin/users/invitations", payload: {} },
      { method: "GET", url: "/admin/organizations" },
      { method: "POST", url: "/admin/organizations", payload: {} },
      { method: "GET", url: "/admin/products" },
      { method: "POST", url: "/admin/products", payload: {} },
      { method: "GET", url: "/admin/services" },
      { method: "POST", url: "/admin/services", payload: {} },
      { method: "POST", url: "/admin/uploads/presigned-url", payload: {} }
    ] as const;

    for (const item of cases) {
      const response = await app.inject({ ...item, headers });
      expect(response.statusCode, `${item.method} ${item.url}`).toBe(403);
    }
  });

  it("scopes the user directory to the active organization and rejects forged selectors", async () => {
    const adminSubject = "31313131-3131-4313-8313-313131313131";
    const memberSubject = "32323232-3232-4323-8323-323232323232";
    const foreignSubject = "34343434-3434-4343-8343-343434343434";
    const adminId = await provisionUser({
      identityUserId: adminSubject,
      email: `org-a-admin${testEmailSuffix}`,
      name: "Org A Admin"
    });
    const memberId = await provisionUser({
      identityUserId: memberSubject,
      email: `org-a-member${testEmailSuffix}`,
      name: "Org A Member"
    });
    const foreignId = await provisionUser({
      identityUserId: foreignSubject,
      email: `org-b-user${testEmailSuffix}`,
      name: "Org B User"
    });
    await addMembership({ userId: adminId, organizationId: autonomiaOrganizationId, role: "admin", isPrimary: true });
    await addMembership({ userId: memberId, organizationId: autonomiaOrganizationId, role: "member", isPrimary: true });
    await addMembership({ userId: foreignId, organizationId: hub2youOrganizationId, role: "admin", isPrimary: true });

    const adminToken = await signAccessToken({ subject: adminSubject });
    const memberToken = await signAccessToken({ subject: memberSubject });
    const implicit = await app.inject({
      method: "GET",
      url: "/admin/users",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    const explicit = await app.inject({
      method: "GET",
      url: "/admin/users",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "x-organization-id": autonomiaOrganizationId
      }
    });
    const me = await app.inject({
      method: "GET",
      url: "/admin/me",
      headers: { authorization: `Bearer ${adminToken}` }
    });

    expect(implicit.statusCode).toBe(200);
    expect(explicit.statusCode).toBe(200);
    const explicitUserIds = explicit.json().map((user: { id: string }) => user.id);
    expect(explicitUserIds).toEqual(expect.arrayContaining([adminId, memberId]));
    expect(explicitUserIds).not.toContain(foreignId);
    expect(Object.keys(me.json()).sort()).toEqual(["organizations", "permissions", "user"]);

    for (const selector of [
      hub2youOrganizationId,
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
      "not-a-uuid"
    ]) {
      const response = await app.inject({
        method: "GET",
        url: "/admin/users",
        headers: {
          authorization: `Bearer ${adminToken}`,
          "x-organization-id": selector
        }
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: { code: "FORBIDDEN", message: "Organization access is not allowed." }
      });
    }

    const memberElevation = await app.inject({
      method: "PATCH",
      url: `/admin/users/${memberId}`,
      headers: {
        authorization: `Bearer ${memberToken}`,
        "x-organization-id": autonomiaOrganizationId
      },
      payload: { role: "platform_superadmin" }
    });
    const tenantProduct = await app.inject({
      method: "GET",
      url: "/admin/products",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "x-organization-id": autonomiaOrganizationId
      }
    });
    expect(memberElevation.statusCode).toBe(403);
    expect(tenantProduct.statusCode).toBe(403);
  });

  it("returns non-enumerable 404 responses for users from another organization", async () => {
    const actorSubject = "35353535-3535-4353-8353-353535353535";
    const targetSubject = "36363636-3636-4363-8363-363636363636";
    const actorId = await provisionUser({
      identityUserId: actorSubject,
      email: `foreign-actor${testEmailSuffix}`,
      name: "Foreign Actor"
    });
    const targetId = await provisionUser({
      identityUserId: targetSubject,
      email: `foreign-target${testEmailSuffix}`,
      name: "Foreign Target"
    });
    await addMembership({ userId: actorId, organizationId: autonomiaOrganizationId, role: "admin", isPrimary: true });
    await addMembership({ userId: targetId, organizationId: hub2youOrganizationId, role: "member", isPrimary: true });
    const token = await signAccessToken({ subject: actorSubject });
    const headers = {
      authorization: `Bearer ${token}`,
      "x-organization-id": autonomiaOrganizationId
    };
    const responses = await Promise.all([
      app.inject({ method: "GET", url: `/admin/users/${targetId}`, headers }),
      app.inject({ method: "PATCH", url: `/admin/users/${targetId}`, headers, payload: { role: "admin" } }),
      app.inject({ method: "POST", url: `/admin/users/${targetId}/activate`, headers }),
      app.inject({ method: "POST", url: `/admin/users/${targetId}/deactivate`, headers }),
      app.inject({ method: "DELETE", url: `/admin/users/${targetId}`, headers })
    ]);
    const persisted = await database.query(
      `SELECT admin_user.status AS user_status, membership.role, membership.status AS membership_status
       FROM admin.users admin_user
       INNER JOIN admin.user_organizations membership ON membership.user_id = admin_user.id
       WHERE admin_user.id = $1 AND membership.organization_id = $2`,
      [targetId, hub2youOrganizationId]
    );

    expect(responses.map((response) => response.statusCode)).toEqual([404, 404, 404, 404, 404]);
    expect(responses.map((response) => response.json())).toEqual(Array(5).fill({
      error: { code: "NOT_FOUND", message: "User not found." }
    }));
    expect(persisted.rows).toEqual([{ user_status: "active", role: "member", membership_status: "active" }]);
  });

  it("invites and removes only the selected membership without mutating a shared identity", async () => {
    const actorSubject = "37373737-3737-4373-8373-373737373737";
    const sharedSubject = "38383838-3838-4383-8383-383838383838";
    const actorId = await provisionUser({
      identityUserId: actorSubject,
      email: `shared-actor${testEmailSuffix}`,
      name: "Shared Actor"
    });
    const sharedEmail = `shared-user${testEmailSuffix}`;
    const sharedId = await provisionUser({
      identityUserId: sharedSubject,
      email: sharedEmail,
      name: "Shared Identity"
    });
    await addMembership({ userId: actorId, organizationId: autonomiaOrganizationId, role: "admin", isPrimary: true });
    await addMembership({ userId: sharedId, organizationId: hub2youOrganizationId, role: "member", isPrimary: true });
    const token = await signAccessToken({ subject: actorSubject });
    const headers = {
      authorization: `Bearer ${token}`,
      "x-organization-id": autonomiaOrganizationId
    };

    const invitation = await app.inject({
      method: "POST",
      url: "/admin/users/invitations",
      headers,
      payload: { email: sharedEmail, name: "Must Not Replace", role: "admin" }
    });
    const activation = await app.inject({
      method: "POST",
      url: `/admin/users/${sharedId}/activate`,
      headers
    });
    const removal = await app.inject({
      method: "DELETE",
      url: `/admin/users/${sharedId}`,
      headers
    });
    const persistedUser = await database.query(
      "SELECT identity_user_id, email, name, status, deleted_at FROM admin.users WHERE id = $1",
      [sharedId]
    );
    const memberships = await database.query(
      `SELECT organization_id, role, status
       FROM admin.user_organizations
       WHERE user_id = $1
       ORDER BY organization_id`,
      [sharedId]
    );

    expect(invitation.statusCode).toBe(201);
    expect(invitation.json()).toMatchObject({
      id: sharedId,
      name: "Shared Identity",
      organizationRole: "admin",
      membershipStatus: "inactive"
    });
    expect(activation.statusCode).toBe(200);
    expect(removal.statusCode).toBe(200);
    expect(persistedUser.rows[0]).toMatchObject({
      identity_user_id: sharedSubject,
      email: sharedEmail,
      name: "Shared Identity",
      status: "active",
      deleted_at: null
    });
    expect(memberships.rows).toEqual([
      { organization_id: autonomiaOrganizationId, role: "admin", status: "inactive" },
      { organization_id: hub2youOrganizationId, role: "member", status: "active" }
    ]);
  });

  it("revalidates the actor after a concurrent membership revocation", async () => {
    const actorSubject = "39393939-3939-4393-8393-393939393939";
    const actorId = await provisionUser({
      identityUserId: actorSubject,
      email: `revoked-actor${testEmailSuffix}`,
      name: "Revoked Actor"
    });
    const targetId = await provisionUser({
      email: `revoked-target${testEmailSuffix}`,
      name: "Revoked Target"
    });
    await addMembership({ userId: actorId, organizationId: autonomiaOrganizationId, role: "admin", isPrimary: true });
    await addMembership({ userId: targetId, organizationId: autonomiaOrganizationId, role: "member" });
    const token = await signAccessToken({ subject: actorSubject });
    const locker = await database.connect();
    let transactionOpen = false;
    let pendingRequest: Promise<Awaited<ReturnType<typeof app.inject>>> | undefined;
    try {
      await locker.query("BEGIN");
      transactionOpen = true;
      await locker.query(
        "SELECT pg_advisory_xact_lock(hashtext('admin.organization.membership:' || $1::text))",
        [autonomiaOrganizationId]
      );
      pendingRequest = app.inject({
        method: "PATCH",
        url: `/admin/users/${targetId}`,
        headers: {
          authorization: `Bearer ${token}`,
          "x-organization-id": autonomiaOrganizationId
        },
        payload: { role: "admin" }
      });
      await waitForOrganizationMutationBlocked();
      await locker.query(
        `UPDATE admin.user_organizations
         SET status = 'inactive', is_primary = false, updated_at = now()
         WHERE user_id = $1 AND organization_id = $2`,
        [actorId, autonomiaOrganizationId]
      );
      await locker.query("COMMIT");
      transactionOpen = false;

      const response = await pendingRequest;
      const targetMembership = await database.query(
        "SELECT role, status FROM admin.user_organizations WHERE user_id = $1 AND organization_id = $2",
        [targetId, autonomiaOrganizationId]
      );
      expect(response.statusCode).toBe(403);
      expect(targetMembership.rows).toEqual([{ role: "member", status: "active" }]);
    } finally {
      if (transactionOpen) await locker.query("ROLLBACK");
      locker.release();
      await pendingRequest?.catch(() => undefined);
    }
  });

  it("protects self-membership and ignores an unusable backup in the last-admin check", async () => {
    const platformSubject = "3a3a3a3a-3a3a-43a3-83a3-3a3a3a3a3a3a";
    const tenantSubject = "3b3b3b3b-3b3b-43b3-83b3-3b3b3b3b3b3b";
    await provisionUser({
      identityUserId: platformSubject,
      email: `last-admin-platform${testEmailSuffix}`,
      name: "Last Admin Platform"
    });
    const tenantAdminId = await provisionUser({
      identityUserId: tenantSubject,
      email: `last-admin-tenant${testEmailSuffix}`,
      name: "Last Tenant Admin"
    });
    const unusableBackupId = await provisionUser({
      email: `last-admin-inactive${testEmailSuffix}`,
      name: "Inactive Backup",
      status: "inactive"
    });
    await grantPlatformSuperadmin(platformSubject);
    await addMembership({
      userId: tenantAdminId,
      organizationId: hub2youOrganizationId,
      role: "admin",
      isPrimary: true
    });
    await addMembership({
      userId: unusableBackupId,
      organizationId: hub2youOrganizationId,
      role: "admin"
    });
    const [platformToken, tenantToken] = await Promise.all([
      signAccessToken({ subject: platformSubject }),
      signAccessToken({ subject: tenantSubject })
    ]);
    const platformAttempt = await app.inject({
      method: "PATCH",
      url: `/admin/users/${tenantAdminId}`,
      headers: {
        authorization: `Bearer ${platformToken}`,
        "x-organization-id": hub2youOrganizationId
      },
      payload: { role: "member" }
    });
    const selfAttempt = await app.inject({
      method: "PATCH",
      url: `/admin/users/${tenantAdminId}`,
      headers: {
        authorization: `Bearer ${tenantToken}`,
        "x-organization-id": hub2youOrganizationId
      },
      payload: { status: "inactive" }
    });
    const persisted = await database.query(
      "SELECT role, status FROM admin.user_organizations WHERE user_id = $1 AND organization_id = $2",
      [tenantAdminId, hub2youOrganizationId]
    );

    expect(platformAttempt.statusCode).toBe(409);
    expect(platformAttempt.json().error.message).toContain("last active organization admin");
    expect(selfAttempt.statusCode).toBe(409);
    expect(selfAttempt.json().error.message).toContain("cannot change their own membership");
    expect(persisted.rows).toEqual([{ role: "admin", status: "active" }]);
  });

  it("requires an explicit tenant selector for platform access while preserving global routes", async () => {
    const bootstrapHeaders = await neuroHeaders({
      subject: platformSuperadminSubject,
      email: platformSuperadminEmail,
      name: "Explicit Tenant Superadmin"
    });
    expect((await app.inject({ method: "GET", url: "/admin/me", headers: bootstrapHeaders })).statusCode).toBe(200);
    const token = await signAccessToken({ subject: platformSuperadminSubject });
    const withoutSelector = await app.inject({
      method: "GET",
      url: "/admin/users",
      headers: { authorization: `Bearer ${token}` }
    });
    const withSelector = await app.inject({
      method: "GET",
      url: "/admin/users",
      headers: {
        authorization: `Bearer ${token}`,
        "x-organization-id": hub2youOrganizationId
      }
    });
    const globalProducts = await app.inject({
      method: "GET",
      url: "/admin/products",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(withoutSelector.statusCode).toBe(403);
    expect(withSelector.statusCode).toBe(200);
    expect(globalProducts.statusCode).toBe(200);
  });

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
    await grantPlatformSuperadmin(actorSubject);
    const targetSubject = "25252525-2525-4252-8252-252525252525";
    const token = await signAccessToken({ subject: actorSubject });

    const response = await app.inject({
      method: "PATCH",
      url: `/admin/users/${targetSubject}`,
      headers: {
        authorization: `Bearer ${token}`,
        "x-organization-id": autonomiaOrganizationId
      },
      payload: { status: "inactive" }
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
  await database.query("DELETE FROM admin.platform_role_bootstrap");
  await database.query(
    "DELETE FROM admin.users WHERE email LIKE $1 OR identity_user_id = $2 OR lower(email) = lower($3)",
    [`%${testEmailSuffix}`, platformSuperadminSubject, platformSuperadminEmail]
  );
}

async function grantPlatformSuperadmin(identityUserId: string) {
  await database.query(
    `INSERT INTO admin.user_roles (user_id, role_id)
     SELECT admin_user.id, role.id
     FROM admin.users admin_user
     CROSS JOIN admin.roles role
     WHERE admin_user.identity_user_id = $1
       AND role.key = 'platform_superadmin'
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [identityUserId]
  );
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

async function waitForOrganizationMutationBlocked(timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await database.query(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_stat_activity
         WHERE datname = current_database()
           AND pid <> pg_backend_pid()
           AND wait_event_type = 'Lock'
           AND query LIKE '%admin.organization.membership:%'
       ) AS blocked`
    );
    if (result.rows[0]?.blocked === true) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the organization membership mutation to block.");
}

async function addMembership(input: {
  userId: string;
  organizationId: string;
  role: "admin" | "member";
  isPrimary?: boolean;
  status?: "active" | "inactive";
}) {
  await database.query(
    `INSERT INTO admin.user_organizations (user_id, organization_id, role, is_primary, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.userId, input.organizationId, input.role, input.isPrimary ?? false, input.status ?? "active"]
  );
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
