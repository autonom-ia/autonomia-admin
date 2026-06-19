import type { Pool } from "pg";
import type { AdminOrganization, AdminProduct, AdminProductCustomization, AdminProfile, AdminRole, AdminService, AdminUser, ProductService } from "./types.js";

export interface UpsertProductInput {
  key: string;
  name: string;
  description?: string | null | undefined;
  logoUrl?: string | null | undefined;
  primaryColor?: string | undefined;
  accentColor?: string | undefined;
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
  id?: string | undefined;
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
    const result = await this.db.query(userSelectSql("ORDER BY u.email ASC"));
    return result.rows.map(mapUser);
  }

  async ensureUser(input: Pick<AdminUser, "email" | "name"> & { id?: string | undefined; photoUrl?: string | null | undefined }) {
    const profile = await this.getDefaultProfile();
    const result = await this.db.query(
      `INSERT INTO admin.users (identity_user_id, email, name, photo_url, profile_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       ON CONFLICT (email) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, admin.users.name),
         photo_url = COALESCE(EXCLUDED.photo_url, admin.users.photo_url),
         profile_id = COALESCE(admin.users.profile_id, EXCLUDED.profile_id),
         updated_at = now()
       RETURNING id`,
      [toUuidOrNull(input.id), input.email, input.name, input.photoUrl ?? null, profile.id]
    );
    const user = await this.getUserById(String(result.rows[0].id));
    await this.ensureDefaultUserOrganization(user.id);
    return user;
  }

  async upsertUser(input: UpsertUserInput) {
    const profile = await this.findProfile({ profileId: input.profileId, profileKey: input.profileKey });
    const existing = input.id ? await this.getUserById(input.id).catch(() => null) : null;
    const result = await this.db.query(
      `INSERT INTO admin.users (identity_user_id, email, name, photo_url, profile_id, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         photo_url = EXCLUDED.photo_url,
         profile_id = EXCLUDED.profile_id,
         status = EXCLUDED.status,
         updated_at = now()
       RETURNING id`,
      [
        toUuidOrNull(existing?.id ?? input.id),
        input.email,
        input.name,
        input.photoUrl ?? existing?.photoUrl ?? null,
        profile.id,
        input.status ?? existing?.status ?? "active"
      ]
    );
    const user = await this.getUserById(String(result.rows[0].id));
    await this.ensureDefaultUserOrganization(user.id);
    return user;
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

  private async ensureDefaultUserOrganization(userId: string) {
    await this.db.query(
      `WITH has_primary AS (
         SELECT EXISTS (
           SELECT 1
           FROM admin.user_organizations
           WHERE user_id = $1
             AND is_primary = true
             AND status = 'active'
         ) AS value
       )
       INSERT INTO admin.user_organizations (user_id, organization_id, role, is_primary, status)
       SELECT $1, o.id, 'admin', NOT hp.value, 'active'
       FROM admin.organizations o
       CROSS JOIN has_primary hp
       WHERE o.key = 'autonomia'
       ON CONFLICT (user_id, organization_id) DO UPDATE SET
         is_primary = admin.user_organizations.is_primary OR EXCLUDED.is_primary,
         status = 'active',
         updated_at = now()`,
      [userId]
    );
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
         key, name, description, logo_url, primary_color, accent_color, oauth_client_id,
         allowed_redirect_uris, allowed_logout_uris, allowed_origins,
         allow_google_login, allow_github_login, allow_email_password_login, allow_passkey_login, allow_background_auth,
         access_token_ttl_seconds, refresh_token_ttl_seconds, status, auth_sync_status, auth_sync_error, auth_synced_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'pending', NULL, NULL)
       ON CONFLICT (key) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         logo_url = EXCLUDED.logo_url,
         primary_color = EXCLUDED.primary_color,
         accent_color = EXCLUDED.accent_color,
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
  role?: string;
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
