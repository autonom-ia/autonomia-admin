import type { Pool } from "pg";
import { ADMIN_PERMISSIONS, type AdminOrganization, type AdminOrganizationRole, type AdminOrganizationUser, type AdminPermission, type AdminProduct, type AdminProductCustomization, type AdminProfile, type AdminRole, type AdminService, type AdminStatus, type AdminUser, type ProductService } from "./types.js";

export interface UpsertProductInput {
  key: string;
  name: string;
  description?: string | null | undefined;
  logoUrl?: string | null | undefined;
  primaryColor?: string | undefined;
  accentColor?: string | undefined;
  registerCallbackUrl?: string | null | undefined;
  termsUrl?: string | null | undefined;
  oauthClientId?: string | null | undefined;
  allowedRedirectUris?: string[] | undefined;
  allowedLogoutUris?: string[] | undefined;
  allowedOrigins?: string[] | undefined;
  allowGoogleLogin?: boolean | undefined;
  allowGithubLogin?: boolean | undefined;
  allowEmailPasswordLogin?: boolean | undefined;
  allowPasskeyLogin?: boolean | undefined;
  allowBackgroundAuth?: boolean | undefined;
  accessTokenTtlSeconds?: number | undefined;
  refreshTokenTtlSeconds?: number | undefined;
  status?: AdminProduct["status"] | undefined;
}

export interface UpsertServiceInput {
  key: string;
  name: string;
  description?: string | null | undefined;
  serviceType?: AdminService["serviceType"] | undefined;
  packageName?: string | null | undefined;
  entrypointUrl?: string | null | undefined;
  status?: AdminService["status"] | undefined;
}

export interface UpsertUserInput {
  adminUserId?: string | undefined;
  email: string;
  name: string;
  photoUrl?: string | null | undefined;
  status?: AdminUser["status"] | undefined;
  profileId?: string | null | undefined;
  profileKey?: string | null | undefined;
}

export interface UpsertOrganizationInput {
  id?: string | undefined;
  key: string;
  name: string;
  status?: AdminOrganization["status"] | undefined;
}

export interface InviteOrganizationUserInput {
  email: string;
  name: string;
  photoUrl?: string | null | undefined;
  profileId?: string | null | undefined;
  profileKey?: string | null | undefined;
  role?: Exclude<AdminOrganizationRole, "platform_superadmin"> | undefined;
}

export interface UpdateOrganizationMembershipInput {
  role?: Exclude<AdminOrganizationRole, "platform_superadmin"> | undefined;
  status?: AdminStatus | undefined;
}

export interface UpsertRoleInput {
  id?: string | undefined;
  name: string;
  description?: string | null | undefined;
  permissions?: string[] | undefined;
  status?: AdminRole["status"] | undefined;
}

export interface UpsertProductCustomizationInput {
  id?: string | undefined;
  productId: string;
  domain: string;
  displayName?: string | null | undefined;
  logoUrl?: string | null | undefined;
  faviconUrl?: string | null | undefined;
  primaryColor?: string | null | undefined;
  accentColor?: string | null | undefined;
  backgroundColor?: string | null | undefined;
  textColor?: string | null | undefined;
  themeTokens?: Record<string, unknown> | undefined;
  customCss?: Record<string, unknown> | undefined;
  status?: AdminProductCustomization["status"] | undefined;
}

export class AdminUserAccessError extends Error {
  constructor(message = "Administrative user is not active.") {
    super(message);
    this.name = "AdminUserAccessError";
  }
}

export class ProtectedPlatformSuperadminError extends Error {
  constructor() {
    super("The bootstrapped platform superadmin cannot be deactivated or deleted through generic user routes.");
    this.name = "ProtectedPlatformSuperadminError";
  }
}

export class OrganizationAccessError extends Error {
  constructor() {
    super("Organization access is not allowed.");
    this.name = "OrganizationAccessError";
  }
}

export class OrganizationUserNotFoundError extends Error {
  constructor() {
    super("Organization user was not found.");
    this.name = "OrganizationUserNotFoundError";
  }
}

export class OrganizationUserConflictError extends Error {
  constructor(message = "Organization user cannot be invited in its current state.") {
    super(message);
    this.name = "OrganizationUserConflictError";
  }
}

export class LastOrganizationAdminError extends Error {
  constructor() {
    super("The last active organization admin cannot be demoted or removed.");
    this.name = "LastOrganizationAdminError";
  }
}

export class AdminRepository {
  constructor(private readonly db: Pool) {}

  async listProfiles(): Promise<AdminProfile[]> {
    const result = await this.db.query(
      `SELECT id, key, name, description, status, created_at, updated_at
       FROM admin.profiles
       ORDER BY name ASC`
    );
    return result.rows.map(mapProfile);
  }

  async findProfile(input: { profileId?: string | null | undefined; profileKey?: string | null | undefined }) {
    if (!input.profileId && !input.profileKey) return this.getDefaultProfile();
    const result = await this.db.query(
      `SELECT id, key, name, description, status, created_at, updated_at
       FROM admin.profiles
       WHERE ($1::uuid IS NOT NULL AND id = $1::uuid)
          OR ($2::text IS NOT NULL AND key = $2::text)
       LIMIT 1`,
      [input.profileId ?? null, input.profileKey ?? null]
    );
    return result.rows[0] ? mapProfile(result.rows[0] as DbProfileRow) : this.getDefaultProfile();
  }

  async getDefaultProfile() {
    const result = await this.db.query(
      `SELECT id, key, name, description, status, created_at, updated_at
       FROM admin.profiles
       WHERE key = 'autonomia_master'
       LIMIT 1`
    );
    if (!result.rows[0]) throw new Error("Default profile autonomia_master was not seeded.");
    return mapProfile(result.rows[0] as DbProfileRow);
  }

  async listUsers(): Promise<AdminUser[]> {
    const result = await this.db.query(userSelectSql("WHERE u.deleted_at IS NULL ORDER BY u.email ASC"));
    return result.rows.map(mapUser);
  }

  async authenticateProvisionedUser(input: {
    identityUserId: string;
    verifiedEmail?: string | undefined;
    verifiedName?: string | undefined;
    allowFirstLink?: boolean | undefined;
  }) {
    const identityUserId = toUuidOrNull(input.identityUserId);
    if (!identityUserId) throw new AdminUserAccessError();

    const linked = await this.db.query(
      `SELECT id, status, deleted_at
       FROM admin.users
       WHERE identity_user_id = $1
       LIMIT 1`,
      [identityUserId]
    );
    if (linked.rows[0]) {
      const row = linked.rows[0] as { id: string; status: AdminUser["status"]; deleted_at: Date | null };
      if (row.status !== "active" || row.deleted_at) throw new AdminUserAccessError();
      return this.getUserById(row.id);
    }

    if (!input.allowFirstLink || !input.verifiedEmail) throw new AdminUserAccessError();
    let result;
    try {
      result = await this.db.query(
        `WITH candidates AS MATERIALIZED (
           SELECT id
           FROM admin.users
           WHERE lower(email) = lower($1)
             AND identity_user_id IS NULL
             AND status = 'active'
             AND deleted_at IS NULL
           FOR UPDATE
         ),
         eligible AS (
           SELECT id
           FROM candidates
           WHERE (SELECT count(*) FROM candidates) = 1
         )
         UPDATE admin.users AS users
         SET identity_user_id = $2,
             name = COALESCE($3, users.name),
             updated_at = now()
         FROM eligible
         WHERE users.id = eligible.id
           AND lower(users.email) = lower($1)
           AND users.identity_user_id IS NULL
           AND users.status = 'active'
           AND users.deleted_at IS NULL
         RETURNING users.id`,
        [input.verifiedEmail, identityUserId, input.verifiedName ?? null]
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new AdminUserAccessError("Identity is already linked to another administrative user.");
      throw error;
    }
    if (!result.rows[0]) throw new AdminUserAccessError();
    return this.getUserById(String(result.rows[0].id));
  }

  async listUserPermissions(userId: string): Promise<AdminPermission[]> {
    const result = await this.db.query(
      `SELECT DISTINCT unnest(role.permissions) AS permission
       FROM admin.user_roles user_role
       INNER JOIN admin.roles role ON role.id = user_role.role_id
       INNER JOIN admin.users admin_user ON admin_user.id = user_role.user_id
       WHERE user_role.user_id = $1
         AND role.status = 'active'
         AND admin_user.status = 'active'
         AND admin_user.deleted_at IS NULL
       ORDER BY permission ASC`,
      [userId]
    );
    const allowed = new Set<string>(ADMIN_PERMISSIONS);
    return result.rows
      .map((row: { permission: string }) => row.permission)
      .filter((permission: string): permission is AdminPermission => allowed.has(permission));
  }

  async bootstrapPlatformSuperadmin(input: {
    identityUserId: string;
    verifiedEmail?: string | undefined;
    verifiedName?: string | undefined;
    expectedEmail: string;
  }) {
    const identityUserId = toUuidOrNull(input.identityUserId);
    if (!identityUserId) throw new AdminUserAccessError("Platform superadmin subject is invalid.");
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('admin.platform_superadmin.bootstrap'))");
      const existing = await client.query(
        `SELECT bootstrap.user_id, bootstrap.identity_sub, admin_user.status, admin_user.deleted_at
         FROM admin.platform_role_bootstrap bootstrap
         INNER JOIN admin.users admin_user ON admin_user.id = bootstrap.user_id
         WHERE bootstrap.bootstrap_key = 'platform_superadmin'
         LIMIT 1`
      );
      if (existing.rows[0]) {
        const row = existing.rows[0] as {
          user_id: string;
          identity_sub: string;
          status: AdminUser["status"];
          deleted_at: Date | null;
        };
        if (row.identity_sub !== identityUserId) {
          throw new AdminUserAccessError("Platform superadmin bootstrap is already bound.");
        }
        if (row.status !== "active" || row.deleted_at) throw new AdminUserAccessError();
        await client.query("COMMIT");
        return this.getUserById(row.user_id);
      }

      if (!input.verifiedEmail || input.verifiedEmail.toLowerCase() !== input.expectedEmail.toLowerCase()) {
        throw new AdminUserAccessError("Verified platform superadmin email is required for first bootstrap.");
      }
      const candidates = await client.query(
        `SELECT id, identity_user_id, email, status, deleted_at
         FROM admin.users
         WHERE identity_user_id = $1
            OR lower(email) = lower($2)
         FOR UPDATE`,
        [identityUserId, input.expectedEmail]
      );
      if (candidates.rowCount && candidates.rowCount !== 1) {
        throw new AdminUserAccessError("Platform superadmin identity conflicts with an existing user.");
      }
      let userId: string;
      if (candidates.rows[0]) {
        const candidate = candidates.rows[0] as {
          id: string;
          identity_user_id: string | null;
          email: string;
          status: AdminUser["status"];
          deleted_at: Date | null;
        };
        if (
          candidate.status !== "active"
          || candidate.deleted_at
          || candidate.email.toLowerCase() !== input.expectedEmail.toLowerCase()
          || (candidate.identity_user_id && candidate.identity_user_id !== identityUserId)
        ) {
          throw new AdminUserAccessError("Platform superadmin candidate is not eligible.");
        }
        const linked = await client.query(
          `UPDATE admin.users
           SET identity_user_id = $2,
               name = COALESCE($3, name),
               updated_at = now()
           WHERE id = $1
             AND (identity_user_id IS NULL OR identity_user_id = $2)
           RETURNING id`,
          [candidate.id, identityUserId, input.verifiedName ?? null]
        );
        if (!linked.rows[0]) throw new AdminUserAccessError("Platform superadmin identity could not be linked.");
        userId = String(linked.rows[0].id);
      } else {
        const created = await client.query(
          `INSERT INTO admin.users (identity_user_id, email, name, profile_id, status)
           VALUES (
             $1,
             $2,
             $3,
             (SELECT id FROM admin.profiles WHERE key = 'autonomia_master' AND status = 'active'),
             'active'
           )
           RETURNING id`,
          [identityUserId, input.expectedEmail, input.verifiedName ?? "Autonom.ia Superadmin"]
        );
        if (!created.rows[0]) throw new Error("Platform superadmin user could not be created.");
        userId = String(created.rows[0].id);
      }

      const role = await client.query(
        `SELECT id
         FROM admin.roles
         WHERE key = 'platform_superadmin'
           AND status = 'active'
         LIMIT 1`
      );
      if (!role.rows[0]) throw new Error("platform_superadmin role was not seeded.");
      const roleId = String(role.rows[0].id);
      await client.query(
        `INSERT INTO admin.user_roles (user_id, role_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        [userId, roleId]
      );
      await client.query(
        `INSERT INTO admin.platform_role_bootstrap (
           bootstrap_key, user_id, role_id, identity_sub, email_at_bootstrap
         ) VALUES ('platform_superadmin', $1, $2, $3, $4)`,
        [userId, roleId, identityUserId, input.verifiedEmail.toLowerCase()]
      );
      await client.query("COMMIT");
      return this.getUserById(userId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertUser(input: UpsertUserInput) {
    await this.assertProtectedUserMutationAllowed(input);
    const profile = await this.findProfile({ profileId: input.profileId, profileKey: input.profileKey });
    const existing = input.adminUserId ? await this.getUserById(input.adminUserId).catch(() => null) : null;
    if (input.adminUserId && !existing) throw new Error("User not found.");

    const result = existing
      ? await this.db.query(
        `UPDATE admin.users
         SET email = $2,
             name = $3,
             photo_url = $4,
             profile_id = $5,
             status = $6,
             deleted_at = NULL,
             updated_at = now()
         WHERE id = $1
         RETURNING id`,
        [
          existing.id,
          input.email,
          input.name,
          input.photoUrl ?? existing.photoUrl ?? null,
          profile.id,
          input.status ?? existing.status
        ]
      )
      : await this.db.query(
        `INSERT INTO admin.users (email, name, photo_url, profile_id, status)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           photo_url = EXCLUDED.photo_url,
           profile_id = EXCLUDED.profile_id,
           status = EXCLUDED.status,
           deleted_at = NULL,
           updated_at = now()
         RETURNING id`,
        [
          input.email,
          input.name,
          input.photoUrl ?? null,
          profile.id,
          input.status ?? "active"
        ]
      );
    return this.getUserById(String(result.rows[0].id));
  }

  async listUserOrganizations(userId: string): Promise<AdminOrganization[]> {
    const result = await this.db.query(
      `SELECT
         o.id,
         o.key,
         o.name,
         o.status,
         uo.role,
         uo.is_primary,
         uo.status AS membership_status,
         uo.created_at,
         uo.updated_at
       FROM admin.user_organizations uo
       INNER JOIN admin.organizations o ON o.id = uo.organization_id
       WHERE uo.user_id = $1
       ORDER BY uo.is_primary DESC, o.name ASC`,
      [userId]
    );
    return result.rows.map(mapOrganization);
  }

  async resolveOrganizationAccess(input: {
    userId: string;
    organizationId?: string | undefined;
    allowPlatformAccess: boolean;
  }): Promise<AdminOrganization | null> {
    if (input.organizationId) {
      const result = await this.db.query(
        `SELECT
           organization.id,
           organization.key,
           organization.name,
           organization.status,
           CASE
             WHEN membership.user_id IS NOT NULL THEN membership.role
             WHEN $3::boolean THEN 'platform_superadmin'
             ELSE NULL
           END AS role,
           COALESCE(membership.is_primary, false) AS is_primary,
           CASE
             WHEN membership.user_id IS NOT NULL THEN membership.status
             WHEN $3::boolean THEN 'active'
             ELSE NULL
           END AS membership_status,
           COALESCE(membership.created_at, organization.created_at) AS created_at,
           COALESCE(membership.updated_at, organization.updated_at) AS updated_at
         FROM admin.organizations organization
         LEFT JOIN admin.user_organizations membership
           ON membership.organization_id = organization.id
          AND membership.user_id = $1
          AND membership.status = 'active'
         WHERE organization.id = $2
           AND organization.status = 'active'
         LIMIT 1`,
        [input.userId, input.organizationId, input.allowPlatformAccess]
      );
      const row = result.rows[0] as DbOrganizationRow | undefined;
      if (!row?.role || !row.membership_status) throw new OrganizationAccessError();
      return mapOrganization(row);
    }

    const result = await this.db.query(
      `SELECT
         organization.id,
         organization.key,
         organization.name,
         organization.status,
         membership.role,
         membership.is_primary,
         membership.status AS membership_status,
         membership.created_at,
         membership.updated_at
       FROM admin.user_organizations membership
       INNER JOIN admin.organizations organization
         ON organization.id = membership.organization_id
        AND organization.status = 'active'
       WHERE membership.user_id = $1
         AND membership.status = 'active'
       ORDER BY membership.is_primary DESC, membership.created_at ASC
       LIMIT 2`,
      [input.userId]
    );
    if (!result.rows[0]) return null;
    const primary = result.rows.find((row: DbOrganizationRow) => row.is_primary);
    if (primary) return mapOrganization(primary as DbOrganizationRow);
    if (result.rowCount === 1) return mapOrganization(result.rows[0] as DbOrganizationRow);
    throw new OrganizationAccessError();
  }

  async listOrganizationUsers(organizationId: string): Promise<AdminOrganizationUser[]> {
    const result = await this.db.query(
      organizationUserSelectSql(
        `WHERE membership.organization_id = $1
           AND admin_user.deleted_at IS NULL
         ORDER BY admin_user.email ASC`
      ),
      [organizationId]
    );
    return result.rows.map((row) => mapOrganizationUser(row as DbOrganizationUserRow));
  }

  async getOrganizationUser(organizationId: string, userId: string): Promise<AdminOrganizationUser> {
    const result = await this.db.query(
      organizationUserSelectSql(
        `WHERE membership.organization_id = $1
           AND membership.user_id = $2
           AND admin_user.deleted_at IS NULL
         LIMIT 1`
      ),
      [organizationId, userId]
    );
    if (!result.rows[0]) throw new OrganizationUserNotFoundError();
    return mapOrganizationUser(result.rows[0] as DbOrganizationUserRow);
  }

  async inviteOrganizationUser(
    organizationId: string,
    actorUserId: string,
    input: InviteOrganizationUserInput
  ): Promise<AdminOrganizationUser> {
    const profile = await this.findProfile({ profileId: input.profileId, profileKey: input.profileKey });
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('admin.organization.invite:' || lower($1)))",
        [input.email]
      );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('admin.organization.membership:' || $1::text))",
        [organizationId]
      );
      await this.assertActiveOrganizationAdmin(client, organizationId, actorUserId);
      const protectedUser = await client.query(
        `SELECT 1
         FROM admin.platform_role_bootstrap bootstrap
         INNER JOIN admin.users admin_user ON admin_user.id = bootstrap.user_id
         WHERE bootstrap.bootstrap_key = 'platform_superadmin'
           AND lower(admin_user.email) = lower($1)
         LIMIT 1`,
        [input.email]
      );
      if (protectedUser.rows[0]) throw new ProtectedPlatformSuperadminError();

      const existing = await client.query(
        `SELECT id, status, deleted_at
         FROM admin.users
         WHERE lower(email) = lower($1)
         FOR UPDATE`,
        [input.email]
      );
      if (existing.rowCount && existing.rowCount !== 1) {
        throw new OrganizationUserConflictError("Email matches more than one administrative identity.");
      }
      let userId: string;
      if (existing.rows[0]) {
        const user = existing.rows[0] as { id: string; status: AdminUser["status"]; deleted_at: Date | null };
        if (user.status === "inactive" || user.deleted_at) throw new OrganizationUserConflictError();
        userId = user.id;
      } else {
        const created = await client.query(
          `INSERT INTO admin.users (email, name, photo_url, profile_id, status)
           VALUES ($1, $2, $3, $4, 'invited')
           RETURNING id`,
          [input.email, input.name, input.photoUrl ?? null, profile.id]
        );
        userId = String(created.rows[0].id);
      }

      await client.query(
        `INSERT INTO admin.user_organizations (
           user_id, organization_id, role, is_primary, status
         ) VALUES (
           $1,
           $2,
           $3,
           false,
           'inactive'
         )
         ON CONFLICT (user_id, organization_id) DO NOTHING`,
        [userId, organizationId, input.role ?? "member"]
      );
      await client.query("COMMIT");
      return this.getOrganizationUser(organizationId, userId);
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) throw new OrganizationUserConflictError();
      throw error;
    } finally {
      client.release();
    }
  }

  async updateOrganizationUserMembership(
    organizationId: string,
    userId: string,
    actorUserId: string,
    input: UpdateOrganizationMembershipInput
  ): Promise<AdminOrganizationUser> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('admin.organization.membership:' || $1::text))",
        [organizationId]
      );
      await this.assertActiveOrganizationAdmin(client, organizationId, actorUserId);
      if (actorUserId === userId) {
        throw new OrganizationUserConflictError("Organization admins cannot change their own membership through generic user routes.");
      }
      const currentResult = await client.query(
        `SELECT role, status
         FROM admin.user_organizations
         WHERE organization_id = $1
           AND user_id = $2
         FOR UPDATE`,
        [organizationId, userId]
      );
      const current = currentResult.rows[0] as {
        role: Exclude<AdminOrganizationRole, "platform_superadmin">;
        status: AdminStatus;
      } | undefined;
      if (!current) throw new OrganizationUserNotFoundError();
      const nextRole = input.role ?? current.role;
      const nextStatus = input.status ?? current.status;
      if (current.role === "admin" && current.status === "active" && (nextRole !== "admin" || nextStatus !== "active")) {
        const otherAdmins = await client.query(
          `SELECT 1
           FROM admin.user_organizations other_membership
           INNER JOIN admin.users other_admin
             ON other_admin.id = other_membership.user_id
            AND other_admin.status = 'active'
            AND other_admin.deleted_at IS NULL
           WHERE other_membership.organization_id = $1
             AND other_membership.user_id <> $2
             AND other_membership.role = 'admin'
             AND other_membership.status = 'active'
           LIMIT 1
           FOR UPDATE`,
          [organizationId, userId]
        );
        if (!otherAdmins.rows[0]) throw new LastOrganizationAdminError();
      }
      await client.query(
        `UPDATE admin.user_organizations
         SET role = $3,
             status = $4,
             is_primary = CASE
               WHEN $4 = 'inactive' THEN false
               WHEN EXISTS (
                 SELECT 1
                 FROM admin.user_organizations other_primary
                 WHERE other_primary.user_id = $2
                   AND other_primary.organization_id <> $1
                   AND other_primary.is_primary = true
                   AND other_primary.status = 'active'
               ) THEN admin.user_organizations.is_primary
               ELSE true
             END,
             updated_at = now()
         WHERE organization_id = $1
           AND user_id = $2`,
        [organizationId, userId, nextRole, nextStatus]
      );
      if (current.status === "inactive" && nextStatus === "active") {
        await client.query(
          `UPDATE admin.users
           SET status = 'active', updated_at = now()
           WHERE id = $1
             AND status = 'invited'
             AND deleted_at IS NULL`,
          [userId]
        );
      }
      await client.query("COMMIT");
      return this.getOrganizationUser(organizationId, userId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertActiveOrganizationAdmin(
    queryable: Pick<Pool, "query">,
    organizationId: string,
    actorUserId: string
  ) {
    const result = await queryable.query(
      `SELECT 1
       WHERE EXISTS (
         SELECT 1
         FROM admin.organizations organization
         WHERE organization.id = $1
           AND organization.status = 'active'
       )
         AND EXISTS (
           SELECT 1
           FROM admin.users admin_user
           WHERE admin_user.id = $2
             AND admin_user.status = 'active'
             AND admin_user.deleted_at IS NULL
             AND (
               EXISTS (
                 SELECT 1
                 FROM admin.user_organizations membership
                 WHERE membership.organization_id = $1
                   AND membership.user_id = admin_user.id
                   AND membership.role = 'admin'
                   AND membership.status = 'active'
               )
               OR EXISTS (
                 SELECT 1
                 FROM admin.user_roles user_role
                 INNER JOIN admin.roles role ON role.id = user_role.role_id
                 WHERE user_role.user_id = admin_user.id
                   AND role.status = 'active'
                   AND 'admin.users.write' = ANY(role.permissions)
               )
             )
         )
       LIMIT 1`,
      [organizationId, actorUserId]
    );
    if (!result.rows[0]) throw new OrganizationAccessError();
  }

  async listOrganizations(): Promise<AdminOrganization[]> {
    const result = await this.db.query(
      `SELECT id, key, name, status, created_at, updated_at
       FROM admin.organizations
       ORDER BY name ASC`
    );
    return result.rows.map(mapOrganization);
  }

  async upsertOrganization(input: UpsertOrganizationInput) {
    const result = await this.db.query(
      `INSERT INTO admin.organizations (id, key, name, status)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET
         name = EXCLUDED.name,
         status = EXCLUDED.status,
         updated_at = now()
       RETURNING id, key, name, status, created_at, updated_at`,
      [input.id ?? null, input.key, input.name, input.status ?? "active"]
    );
    return mapOrganization(result.rows[0] as DbOrganizationRow);
  }

  async getUserById(userId: string) {
    const result = await this.db.query(userSelectSql("WHERE u.id = $1 LIMIT 1"), [userId]);
    if (!result.rows[0]) throw new Error("User not found.");
    return mapUser(result.rows[0] as DbUserRow);
  }

  async getUser(userIdOrEmail: string) {
    const result = await this.db.query(
      userSelectSql(
        `WHERE ($1::uuid IS NOT NULL AND u.id = $1::uuid)
            OR lower(u.email) = lower($2::text)
         LIMIT 1`
      ),
      [toUuidOrNull(userIdOrEmail), userIdOrEmail]
    );
    if (!result.rows[0]) throw new Error("User not found.");
    return mapUser(result.rows[0] as DbUserRow);
  }

  async updateUserStatus(userId: string, status: AdminUser["status"]) {
    if (status !== "active") await this.assertNotBootstrappedPlatformSuperadmin(userId);
    const result = await this.db.query(
      `UPDATE admin.users
       SET status = $2, updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [userId, status]
    );
    if (!result.rows[0]) throw new Error("User not found.");
    return this.getUserById(String(result.rows[0].id));
  }

  async softDeleteUser(userId: string) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await this.assertNotBootstrappedPlatformSuperadmin(userId, client);
      const userResult = await client.query(
        `UPDATE admin.users
         SET status = 'inactive', deleted_at = now(), updated_at = now()
         WHERE id = $1
         RETURNING id, email, identity_user_id`,
        [userId]
      );
      const user = userResult.rows[0] as { id: string; email: string; identity_user_id: string | null } | undefined;
      if (!user) throw new Error("User not found.");

      await client.query(
        `UPDATE admin.user_organizations
         SET status = 'inactive', is_primary = false, updated_at = now()
         WHERE user_id = $1`,
        [user.id]
      );

      const schemaResult = await client.query(
        `SELECT
           to_regclass('auth.users') AS auth_users,
           to_regclass('auth.organization_users') AS auth_organization_users`
      );
      if (schemaResult.rows[0]?.auth_users) {
        const authUserResult = await client.query(
          `UPDATE auth.users
           SET status = 'inactive', updated_at = now()
           WHERE ($1::text IS NOT NULL AND cognito_sub = $1::text)
              OR email_normalized = lower($2::text)
           RETURNING id`,
          [user.identity_user_id, user.email]
        );
        const authUserIds = authUserResult.rows.map((row: { id: string }) => row.id);
        if (authUserIds.length && schemaResult.rows[0]?.auth_organization_users) {
          await client.query(
            `UPDATE auth.organization_users
             SET status = 'inactive', updated_at = now()
             WHERE user_id = ANY($1::uuid[])`,
            [authUserIds]
          );
        }
      }

      await client.query("COMMIT");
      return this.getUserById(user.id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertNotBootstrappedPlatformSuperadmin(
    userId: string,
    queryable: Pick<Pool, "query"> = this.db
  ) {
    const result = await queryable.query(
      `SELECT 1
       FROM admin.platform_role_bootstrap
       WHERE bootstrap_key = 'platform_superadmin'
         AND user_id = $1
       LIMIT 1`,
      [userId]
    );
    if (result.rows[0]) throw new ProtectedPlatformSuperadminError();
  }

  private async assertProtectedUserMutationAllowed(input: UpsertUserInput) {
    const result = await this.db.query(
      `SELECT admin_user.id, admin_user.email, admin_user.status
       FROM admin.platform_role_bootstrap bootstrap
       INNER JOIN admin.users admin_user ON admin_user.id = bootstrap.user_id
       WHERE bootstrap.bootstrap_key = 'platform_superadmin'
         AND (
           ($1::uuid IS NOT NULL AND admin_user.id = $1::uuid)
           OR lower(admin_user.email) = lower($2)
         )
       LIMIT 1`,
      [input.adminUserId ?? null, input.email]
    );
    if (!result.rows[0]) return;
    const protectedUser = result.rows[0] as { id: string; email: string; status: AdminUser["status"] };
    if (
      input.adminUserId !== protectedUser.id
      || input.email.toLowerCase() !== protectedUser.email.toLowerCase()
      || (input.status ?? protectedUser.status) !== "active"
    ) {
      throw new ProtectedPlatformSuperadminError();
    }
  }

  async listProducts(): Promise<AdminProduct[]> {
    const result = await this.db.query(
      `SELECT *
       FROM admin.products
       ORDER BY name ASC`
    );
    return result.rows.map(mapProduct);
  }

  async upsertProduct(input: UpsertProductInput) {
    const result = await this.db.query(
      `INSERT INTO admin.products (
         key, name, description, logo_url, primary_color, accent_color, register_callback_url, terms_url, oauth_client_id,
         allowed_redirect_uris, allowed_logout_uris, allowed_origins,
         allow_google_login, allow_github_login, allow_email_password_login, allow_passkey_login, allow_background_auth,
         access_token_ttl_seconds, refresh_token_ttl_seconds, status, auth_sync_status, auth_sync_error, auth_synced_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 'pending', NULL, NULL)
       ON CONFLICT (key) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         logo_url = EXCLUDED.logo_url,
         primary_color = EXCLUDED.primary_color,
         accent_color = EXCLUDED.accent_color,
         register_callback_url = EXCLUDED.register_callback_url,
         terms_url = EXCLUDED.terms_url,
         oauth_client_id = EXCLUDED.oauth_client_id,
         allowed_redirect_uris = EXCLUDED.allowed_redirect_uris,
         allowed_logout_uris = EXCLUDED.allowed_logout_uris,
         allowed_origins = EXCLUDED.allowed_origins,
         allow_google_login = EXCLUDED.allow_google_login,
         allow_github_login = EXCLUDED.allow_github_login,
         allow_email_password_login = EXCLUDED.allow_email_password_login,
         allow_passkey_login = EXCLUDED.allow_passkey_login,
         allow_background_auth = EXCLUDED.allow_background_auth,
         access_token_ttl_seconds = EXCLUDED.access_token_ttl_seconds,
         refresh_token_ttl_seconds = EXCLUDED.refresh_token_ttl_seconds,
         status = EXCLUDED.status,
         auth_sync_status = 'pending',
         auth_sync_error = NULL,
         auth_synced_at = NULL,
         updated_at = now()
       RETURNING *`,
      [
        input.key,
        input.name,
        input.description ?? null,
        input.logoUrl ?? null,
        input.primaryColor ?? "#1E3A8A",
        input.accentColor ?? "#38BDF8",
        input.registerCallbackUrl ?? null,
        input.termsUrl ?? null,
        input.oauthClientId ?? input.key,
        input.allowedRedirectUris ?? [],
        input.allowedLogoutUris ?? [],
        input.allowedOrigins ?? [],
        input.allowGoogleLogin ?? true,
        input.allowGithubLogin ?? true,
        input.allowEmailPasswordLogin ?? true,
        input.allowPasskeyLogin ?? true,
        input.allowBackgroundAuth ?? false,
        input.accessTokenTtlSeconds ?? 3600,
        input.refreshTokenTtlSeconds ?? 2592000,
        input.status ?? "active"
      ]
    );
    return mapProduct(result.rows[0] as DbProductRow);
  }

  async getProductById(productId: string) {
    const result = await this.db.query("SELECT * FROM admin.products WHERE id = $1 LIMIT 1", [productId]);
    if (!result.rows[0]) throw new Error("Product not found.");
    return mapProduct(result.rows[0] as DbProductRow);
  }

  async markProductAuthSyncFailed(productId: string, error: string) {
    const result = await this.db.query(
      `UPDATE admin.products
       SET auth_sync_status = 'failed',
           auth_sync_error = $2,
           auth_synced_at = NULL,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [productId, error]
    );
    if (!result.rows[0]) throw new Error("Product not found.");
    return mapProduct(result.rows[0] as DbProductRow);
  }

  async listProductCustomizations(productId: string): Promise<AdminProductCustomization[]> {
    const result = await this.db.query(
      `SELECT *
       FROM admin.product_customizations
       WHERE product_id = $1
       ORDER BY domain ASC`,
      [productId]
    );
    return result.rows.map(mapCustomization);
  }

  async getProductCustomization(customizationId: string) {
    const result = await this.db.query("SELECT * FROM admin.product_customizations WHERE id = $1 LIMIT 1", [customizationId]);
    if (!result.rows[0]) throw new Error("Product customization not found.");
    return mapCustomization(result.rows[0] as DbCustomizationRow);
  }

  async upsertProductCustomization(input: UpsertProductCustomizationInput) {
    const existing = input.id ? await this.getProductCustomization(input.id).catch(() => null) : null;
    const result = await this.db.query(
      `INSERT INTO admin.product_customizations (
         product_id, domain, display_name, logo_url, favicon_url,
         primary_color, accent_color, background_color, text_color,
         theme_tokens, custom_css, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (product_id, domain) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         logo_url = EXCLUDED.logo_url,
         favicon_url = EXCLUDED.favicon_url,
         primary_color = EXCLUDED.primary_color,
         accent_color = EXCLUDED.accent_color,
         background_color = EXCLUDED.background_color,
         text_color = EXCLUDED.text_color,
         theme_tokens = EXCLUDED.theme_tokens,
         custom_css = EXCLUDED.custom_css,
         status = EXCLUDED.status,
         updated_at = now()
       RETURNING *`,
      [
        input.productId,
        input.domain,
        input.displayName ?? existing?.displayName ?? null,
        input.logoUrl ?? existing?.logoUrl ?? null,
        input.faviconUrl ?? existing?.faviconUrl ?? null,
        input.primaryColor ?? existing?.primaryColor ?? null,
        input.accentColor ?? existing?.accentColor ?? null,
        input.backgroundColor ?? existing?.backgroundColor ?? null,
        input.textColor ?? existing?.textColor ?? null,
        input.themeTokens ?? existing?.themeTokens ?? {},
        input.customCss ?? existing?.customCss ?? {},
        input.status ?? existing?.status ?? "active"
      ]
    );
    return mapCustomization(result.rows[0] as DbCustomizationRow);
  }

  async listServices(): Promise<AdminService[]> {
    const result = await this.db.query(
      `SELECT id, key, name, description, service_type, package_name, entrypoint_url, status, created_at, updated_at
       FROM admin.services
       ORDER BY name ASC`
    );
    return result.rows.map(mapService);
  }

  async upsertService(input: UpsertServiceInput) {
    const result = await this.db.query(
      `INSERT INTO admin.services (key, name, description, service_type, package_name, entrypoint_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (key) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         service_type = EXCLUDED.service_type,
         package_name = EXCLUDED.package_name,
         entrypoint_url = EXCLUDED.entrypoint_url,
         status = EXCLUDED.status,
         updated_at = now()
       RETURNING id, key, name, description, service_type, package_name, entrypoint_url, status, created_at, updated_at`,
      [
        input.key,
        input.name,
        input.description ?? null,
        input.serviceType ?? "sdk",
        input.packageName ?? null,
        input.entrypointUrl ?? null,
        input.status ?? "active"
      ]
    );
    return mapService(result.rows[0] as DbServiceRow);
  }

  async listProductServices(productId: string): Promise<ProductService[]> {
    const result = await this.db.query(
      `SELECT id, product_id, service_id, status, display_order, created_at, updated_at
       FROM admin.product_services
       WHERE product_id = $1
       ORDER BY display_order ASC, created_at ASC`,
      [productId]
    );
    return result.rows.map(mapProductService);
  }

  async replaceProductServices(productId: string, services: Array<string | { serviceId: string; displayOrder?: number | undefined }>): Promise<ProductService[]> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM admin.product_services WHERE product_id = $1", [productId]);
      for (const [index, item] of services.entries()) {
        const serviceId = typeof item === "string" ? item : item.serviceId;
        const displayOrder = typeof item === "string" ? index : item.displayOrder ?? index;
        await client.query(
          `INSERT INTO admin.product_services (product_id, service_id, status, display_order)
           VALUES ($1, $2, 'enabled', $3)
           ON CONFLICT (product_id, service_id) DO UPDATE SET status = 'enabled', display_order = EXCLUDED.display_order, updated_at = now()`,
          [productId, serviceId, displayOrder]
        );
      }
      const result = await client.query(
        `SELECT id, product_id, service_id, status, display_order, created_at, updated_at
         FROM admin.product_services
         WHERE product_id = $1
         ORDER BY display_order ASC, created_at ASC`,
        [productId]
      );
      await client.query("COMMIT");
      return result.rows.map(mapProductService);
    } catch (cause) {
      await client.query("ROLLBACK");
      throw cause;
    } finally {
      client.release();
    }
  }

  async listRoles(): Promise<AdminRole[]> {
    return [];
  }

  async upsertRole(input: UpsertRoleInput): Promise<AdminRole> {
    return {
      id: input.id ?? "disabled",
      name: input.name,
      description: input.description ?? null,
      permissions: input.permissions ?? [],
      status: input.status ?? "active"
    };
  }
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function userSelectSql(suffix: string) {
  return `SELECT
      u.id,
      u.email,
      u.name,
      u.photo_url,
      u.status,
      u.created_at,
      u.updated_at,
      p.id AS profile_id,
      p.key AS profile_key,
      p.name AS profile_name
    FROM admin.users u
    LEFT JOIN admin.profiles p ON p.id = u.profile_id
    ${suffix}`;
}

function organizationUserSelectSql(suffix: string) {
  return `SELECT
      admin_user.id,
      admin_user.email,
      admin_user.name,
      admin_user.photo_url,
      admin_user.status,
      admin_user.created_at,
      admin_user.updated_at,
      profile.id AS profile_id,
      profile.key AS profile_key,
      profile.name AS profile_name,
      membership.role AS organization_role,
      membership.status AS membership_status,
      membership.is_primary,
      membership.updated_at AS membership_updated_at
    FROM admin.user_organizations membership
    INNER JOIN admin.users admin_user ON admin_user.id = membership.user_id
    LEFT JOIN admin.profiles profile ON profile.id = admin_user.profile_id
    ${suffix}`;
}

function mapUser(row: DbUserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    photoUrl: row.photo_url,
    status: row.status,
    profileId: row.profile_id,
    profileKey: row.profile_key,
    profileName: row.profile_name,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapOrganizationUser(row: DbOrganizationUserRow): AdminOrganizationUser {
  return {
    ...mapUser(row),
    organizationRole: row.organization_role,
    membershipStatus: row.membership_status,
    isPrimary: row.is_primary,
    membershipUpdatedAt: toIso(row.membership_updated_at)
  };
}

function mapOrganization(row: DbOrganizationRow): AdminOrganization {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    status: row.status,
    role: row.role,
    isPrimary: row.is_primary,
    membershipStatus: row.membership_status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapProfile(row: DbProfileRow): AdminProfile {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapProduct(row: DbProductRow): AdminProduct {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    logoUrl: row.logo_url,
    primaryColor: row.primary_color,
    accentColor: row.accent_color,
    registerCallbackUrl: row.register_callback_url,
    termsUrl: row.terms_url,
    oauthClientId: row.oauth_client_id,
    allowedRedirectUris: row.allowed_redirect_uris,
    allowedLogoutUris: row.allowed_logout_uris,
    allowedOrigins: row.allowed_origins,
    allowGoogleLogin: row.allow_google_login,
    allowGithubLogin: row.allow_github_login,
    allowEmailPasswordLogin: row.allow_email_password_login,
    allowPasskeyLogin: row.allow_passkey_login,
    allowBackgroundAuth: row.allow_background_auth,
    accessTokenTtlSeconds: row.access_token_ttl_seconds,
    refreshTokenTtlSeconds: row.refresh_token_ttl_seconds,
    authSyncStatus: row.auth_sync_status,
    authSyncError: row.auth_sync_error,
    authSyncedAt: row.auth_synced_at ? toIso(row.auth_synced_at) : null,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapCustomization(row: DbCustomizationRow): AdminProductCustomization {
  return {
    id: row.id,
    productId: row.product_id,
    domain: row.domain,
    displayName: row.display_name,
    logoUrl: row.logo_url,
    faviconUrl: row.favicon_url,
    primaryColor: row.primary_color,
    accentColor: row.accent_color,
    backgroundColor: row.background_color,
    textColor: row.text_color,
    themeTokens: row.theme_tokens,
    customCss: row.custom_css,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapService(row: DbServiceRow): AdminService {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    serviceType: row.service_type,
    packageName: row.package_name,
    entrypointUrl: row.entrypoint_url,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapProductService(row: DbProductServiceRow): ProductService {
  return {
    id: row.id,
    productId: row.product_id,
    serviceId: row.service_id,
    status: row.status,
    displayOrder: Number(row.display_order ?? 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function toUuidOrNull(value: string | undefined) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

interface DbUserRow {
  id: string;
  email: string;
  name: string;
  photo_url: string | null;
  status: AdminUser["status"];
  profile_id: string | null;
  profile_key: string | null;
  profile_name: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DbOrganizationUserRow extends DbUserRow {
  organization_role: Exclude<AdminOrganizationRole, "platform_superadmin">;
  membership_status: AdminStatus;
  is_primary: boolean;
  membership_updated_at: Date | string;
}

interface DbProfileRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: AdminProfile["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface DbOrganizationRow {
  id: string;
  key: string;
  name: string;
  status: AdminOrganization["status"];
  role?: AdminOrganizationRole;
  is_primary?: boolean;
  membership_status?: AdminOrganization["membershipStatus"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface DbProductRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  primary_color: string;
  accent_color: string;
  register_callback_url: string | null;
  terms_url: string | null;
  oauth_client_id: string | null;
  allowed_redirect_uris: string[];
  allowed_logout_uris: string[];
  allowed_origins: string[];
  allow_google_login: boolean;
  allow_github_login: boolean;
  allow_email_password_login: boolean;
  allow_passkey_login: boolean;
  allow_background_auth: boolean;
  access_token_ttl_seconds: number;
  refresh_token_ttl_seconds: number;
  auth_sync_status: AdminProduct["authSyncStatus"];
  auth_sync_error: string | null;
  auth_synced_at: Date | string | null;
  status: AdminProduct["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface DbCustomizationRow {
  id: string;
  product_id: string;
  domain: string;
  display_name: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  background_color: string | null;
  text_color: string | null;
  theme_tokens: Record<string, unknown>;
  custom_css: Record<string, unknown>;
  status: AdminProductCustomization["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface DbServiceRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  service_type: AdminService["serviceType"];
  package_name: string | null;
  entrypoint_url: string | null;
  status: AdminService["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface DbProductServiceRow {
  id: string;
  product_id: string;
  service_id: string;
  status: ProductService["status"];
  display_order: number | string;
  created_at: Date | string;
  updated_at: Date | string;
}
