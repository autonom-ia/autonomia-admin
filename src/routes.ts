import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { publishProductCustomizationUpserted, publishProductUpserted } from "./auth-sync.js";
import { requirePrincipal } from "./auth.js";
import { config } from "./config.js";
import { getPool } from "./db.js";
import { publishOrganizationFinancialUpserted, publishProductFinancialCatalogUpserted, publishServiceFinancialCatalogUpserted, publishProductServicesSynced } from "./financial-sync.js";
import { AdminRepository, AdminUserAccessError, LastOrganizationAdminError, OrganizationAccessError, OrganizationUserConflictError, OrganizationUserNotFoundError, ProtectedPlatformSuperadminError } from "./repository.js";
import { ADMIN_PERMISSIONS, type AdminPermission } from "./types.js";
import { createUploadUrl, getAssetObject } from "./uploads.js";

const productSchema = z.object({
  key: z.string().min(2),
  name: z.string().min(2),
  description: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  primaryColor: z.string().optional(),
  accentColor: z.string().optional(),
  registerCallbackUrl: z.string().url().nullable().optional(),
  termsUrl: z.string().url().nullable().optional(),
  oauthClientId: z.string().min(1).nullable().optional(),
  allowedRedirectUris: z.array(z.string().url()).optional(),
  allowedLogoutUris: z.array(z.string().url()).optional(),
  allowedOrigins: z.array(z.string().url()).optional(),
  allowGoogleLogin: z.boolean().optional(),
  allowGithubLogin: z.boolean().optional(),
  allowEmailPasswordLogin: z.boolean().optional(),
  allowPasskeyLogin: z.boolean().optional(),
  allowBackgroundAuth: z.boolean().optional(),
  accessTokenTtlSeconds: z.number().int().min(60).optional(),
  refreshTokenTtlSeconds: z.number().int().min(3600).optional(),
  status: z.enum(["active", "inactive"]).optional()
});

const serviceSchema = z.object({
  key: z.string().min(2),
  name: z.string().min(2),
  description: z.string().nullable().optional(),
  serviceType: z.enum(["sdk", "api", "worker", "integration"]).optional(),
  packageName: z.string().nullable().optional(),
  entrypointUrl: z.string().nullable().optional(),
  status: z.enum(["active", "inactive"]).optional()
});

const customizationSchema = z.object({
  domain: z.string().min(1),
  displayName: z.string().nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  faviconUrl: z.string().url().nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  textColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  themeTokens: z.record(z.unknown()).optional(),
  customCss: z.record(z.unknown()).optional(),
  status: z.enum(["active", "inactive"]).optional()
});

const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  photoUrl: z.string().nullable().optional(),
  status: z.enum(["active", "inactive", "invited"]).optional(),
  profileId: z.string().uuid().nullable().optional(),
  profileKey: z.string().min(1).nullable().optional()
});

const organizationInvitationSchema = userSchema.omit({ status: true }).extend({
  role: z.enum(["admin", "member"]).optional()
}).strict();

const organizationMembershipSchema = z.object({
  role: z.enum(["admin", "member"]).optional(),
  status: z.enum(["active", "inactive"]).optional()
}).strict().refine((value) => value.role !== undefined || value.status !== undefined, {
  message: "At least one membership field is required."
});

const uuidSchema = z.string().uuid();

const organizationSchema = z.object({
  key: z.string().min(2).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(2),
  status: z.enum(["active", "inactive"]).optional()
});

const profileSchema = z.object({
  name: z.string().min(2).optional(),
  photoUrl: z.string().nullable().optional()
});

const uploadUrlSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  folder: z.string().optional()
});

const productServicesSchema = z.object({
  serviceIds: z.array(z.string().uuid()).optional(),
  services: z.array(z.object({
    serviceId: z.string().uuid(),
    displayOrder: z.number().int().min(0).optional()
  })).optional()
});

export async function registerRoutes(app: FastifyInstance) {
  const admin = new AdminRepository(getPool());
  const requirePermission = (permission: AdminPermission) => async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.adminPermissions.includes(permission)) return;
    return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Insufficient administrative permission." } });
  };
  const requireOrganizationAdmin = (access: "read" | "write") => async (request: FastifyRequest, reply: FastifyReply) => {
    const rawSelector = request.headers["x-organization-id"];
    const selector = typeof rawSelector === "string" ? uuidSchema.safeParse(rawSelector) : null;
    if (rawSelector !== undefined && (!selector || !selector.success)) {
      return forbiddenOrganization(reply);
    }
    const platformPermission = `admin.users.${access}` as AdminPermission;
    const allowPlatformAccess = request.adminPermissions.includes(platformPermission);
    try {
      const organization = await admin.resolveOrganizationAccess({
        userId: request.adminUser.id,
        ...(selector?.success ? { organizationId: selector.data } : {}),
        allowPlatformAccess
      });
      if (!organization || (organization.role !== "admin" && !allowPlatformAccess)) {
        return forbiddenOrganization(reply);
      }
      request.adminOrganization = organization;
    } catch (error) {
      if (error instanceof OrganizationAccessError) return forbiddenOrganization(reply);
      throw error;
    }
  };

  app.get("/health", async () => ({ ok: true, service: "autonomia-admin" }));

  app.get("/assets/*", async (request, reply) => {
    const params = request.params as { "*": string };
    const asset = await getAssetObject(params["*"]);
    reply.header("content-type", asset.contentType);
    reply.header("cache-control", asset.cacheControl);
    if (asset.contentLength !== undefined) reply.header("content-length", asset.contentLength);
    return reply.send(asset.body);
  });

  app.addHook("preHandler", async (request, reply) => {
    if (request.url === "/health" || request.url.startsWith("/assets/")) return;
    let principal;
    try {
      principal = await requirePrincipal(request);
    } catch {
      return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Unauthorized." } });
    }
    request.principal = principal;
    try {
      const requestPath = request.url.split("?", 1)[0];
      const isMeHandshake = request.method === "GET" && requestPath === "/admin/me";
      if (
        isMeHandshake
        && config.platformSuperadminIdentitySub
        && principal.verifiedEmail?.toLowerCase() === config.platformSuperadminEmail
        && principal.id !== config.platformSuperadminIdentitySub
      ) {
        throw new AdminUserAccessError("Reserved platform superadmin identity does not match.");
      }
      if (isMeHandshake && config.platformSuperadminIdentitySub === principal.id) {
        request.adminUser = await admin.bootstrapPlatformSuperadmin({
          identityUserId: principal.id,
          ...(principal.verifiedEmail ? { verifiedEmail: principal.verifiedEmail } : {}),
          ...(principal.verifiedName ? { verifiedName: principal.verifiedName } : {}),
          expectedEmail: config.platformSuperadminEmail
        });
      } else {
        request.adminUser = await admin.authenticateProvisionedUser({
          identityUserId: principal.id,
          ...(principal.verifiedEmail ? { verifiedEmail: principal.verifiedEmail } : {}),
          ...(principal.verifiedName ? { verifiedName: principal.verifiedName } : {}),
          allowFirstLink: isMeHandshake
        });
      }
      request.adminPermissions = await admin.listUserPermissions(request.adminUser.id);
    } catch (error) {
      if (error instanceof AdminUserAccessError) {
        return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Administrative user is not active." } });
      }
      throw error;
    }
  });

  app.get("/admin/me", async (request) => {
    const user = request.adminUser;
    return {
      user,
      organizations: await admin.listUserOrganizations(user.id),
      permissions: request.adminPermissions
    };
  });

  app.patch("/admin/me", async (request) => {
    const existing = request.adminUser;
    const input = profileSchema.parse(request.body);
    return admin.upsertUser(stripUndefined({
      adminUserId: existing.id,
      email: existing.email,
      name: input.name ?? existing.name,
      photoUrl: input.photoUrl ?? existing.photoUrl ?? null,
      status: existing.status,
      profileId: existing.profileId ?? null
    }));
  });

  app.post("/admin/uploads/presigned-url", { preHandler: requirePermission("admin.products.write") }, async (request, reply) => {
    const input = uploadUrlSchema.parse(request.body);
    return reply.code(201).send(await createUploadUrl(input));
  });

  app.get("/admin/profiles", { preHandler: requirePermission("admin.users.read") }, async () => admin.listProfiles());
  app.get("/admin/permissions", { preHandler: requirePermission("admin.users.read") }, async () => ADMIN_PERMISSIONS);

  app.get("/admin/organizations", { preHandler: requirePermission("admin.organizations.read") }, async () => admin.listOrganizations());
  app.post("/admin/organizations", { preHandler: requirePermission("admin.organizations.write") }, async (request, reply) => {
    const input = organizationSchema.parse(request.body);
    const organization = await admin.upsertOrganization(stripUndefined(input));
    try {
      await publishOrganizationFinancialUpserted(organization);
    } catch (error) {
      request.log.warn({ err: error, organizationId: organization.id, organizationKey: organization.key }, "organization financial sync publish failed");
    }
    return reply.code(201).send(organization);
  });
  app.patch("/admin/organizations/:organizationKey", { preHandler: requirePermission("admin.organizations.write") }, async (request) => {
    const params = request.params as { organizationKey: string };
    const existing = (await admin.listOrganizations()).find((organization) => organization.key === params.organizationKey);
    const input = organizationSchema.partial().parse(request.body);
    const organization = await admin.upsertOrganization(stripUndefined({
      ...input,
      key: params.organizationKey,
      name: input.name ?? existing?.name ?? params.organizationKey
    }));
    try {
      await publishOrganizationFinancialUpserted(organization);
    } catch (error) {
      request.log.warn({ err: error, organizationId: organization.id, organizationKey: organization.key }, "organization financial sync publish failed");
    }
    return organization;
  });

  app.get("/admin/users", { preHandler: requireOrganizationAdmin("read") }, async (request) => {
    return admin.listOrganizationUsers(request.adminOrganization!.id);
  });
  app.get("/admin/users/:userId", { preHandler: requireOrganizationAdmin("read") }, async (request, reply) => {
    const params = request.params as { userId: string };
    const userId = uuidSchema.safeParse(params.userId);
    if (!userId.success) return notFoundUser(reply);
    try {
      return await admin.getOrganizationUser(request.adminOrganization!.id, userId.data);
    } catch (error) {
      if (error instanceof OrganizationUserNotFoundError) return notFoundUser(reply);
      throw error;
    }
  });
  app.post("/admin/users/invitations", { preHandler: requireOrganizationAdmin("write") }, async (request, reply) => {
    const input = organizationInvitationSchema.parse(request.body);
    if (input.email.toLowerCase() === config.platformSuperadminEmail) {
      return reply.code(409).send({
        error: { code: "CONFLICT", message: "The reserved platform superadmin email cannot be invited through tenant routes." }
      });
    }
    try {
      return reply.code(201).send(await admin.inviteOrganizationUser(
        request.adminOrganization!.id,
        request.adminUser.id,
        stripUndefined(input)
      ));
    } catch (error) {
      if (error instanceof ProtectedPlatformSuperadminError || error instanceof OrganizationUserConflictError) {
        return reply.code(409).send({ error: { code: "CONFLICT", message: error.message } });
      }
      if (error instanceof OrganizationAccessError) return forbiddenOrganization(reply);
      throw error;
    }
  });
  app.patch("/admin/users/:userId", { preHandler: requireOrganizationAdmin("write") }, async (request, reply) => {
    const params = request.params as { userId: string };
    const userId = uuidSchema.safeParse(params.userId);
    if (!userId.success) return notFoundUser(reply);
    const input = organizationMembershipSchema.parse(request.body);
    try {
      return await admin.updateOrganizationUserMembership(
        request.adminOrganization!.id,
        userId.data,
        request.adminUser.id,
        stripUndefined(input)
      );
    } catch (error) {
      if (error instanceof OrganizationUserNotFoundError) return notFoundUser(reply);
      if (error instanceof LastOrganizationAdminError || error instanceof OrganizationUserConflictError) {
        return reply.code(409).send({ error: { code: "CONFLICT", message: error.message } });
      }
      if (error instanceof OrganizationAccessError) return forbiddenOrganization(reply);
      throw error;
    }
  });
  app.post("/admin/users/:userId/activate", { preHandler: requireOrganizationAdmin("write") }, async (request, reply) => {
    const params = request.params as { userId: string };
    const userId = uuidSchema.safeParse(params.userId);
    if (!userId.success) return notFoundUser(reply);
    try {
      return await admin.updateOrganizationUserMembership(
        request.adminOrganization!.id,
        userId.data,
        request.adminUser.id,
        { status: "active" }
      );
    } catch (error) {
      return handleOrganizationUserMutationError(error, reply);
    }
  });
  app.post("/admin/users/:userId/deactivate", { preHandler: requireOrganizationAdmin("write") }, async (request, reply) => {
    const params = request.params as { userId: string };
    const userId = uuidSchema.safeParse(params.userId);
    if (!userId.success) return notFoundUser(reply);
    try {
      return await admin.updateOrganizationUserMembership(
        request.adminOrganization!.id,
        userId.data,
        request.adminUser.id,
        { status: "inactive" }
      );
    } catch (error) {
      return handleOrganizationUserMutationError(error, reply);
    }
  });
  app.delete("/admin/users/:userId", { preHandler: requireOrganizationAdmin("write") }, async (request, reply) => {
    const params = request.params as { userId: string };
    const userId = uuidSchema.safeParse(params.userId);
    if (!userId.success) return notFoundUser(reply);
    try {
      return await admin.updateOrganizationUserMembership(
        request.adminOrganization!.id,
        userId.data,
        request.adminUser.id,
        { status: "inactive" }
      );
    } catch (error) {
      return handleOrganizationUserMutationError(error, reply);
    }
  });

  app.get("/admin/products", { preHandler: requirePermission("admin.products.read") }, async () => admin.listProducts());
  app.post("/admin/products", { preHandler: requirePermission("admin.products.write") }, async (request, reply) => {
    const input = productSchema.parse(request.body);
    let product = await admin.upsertProduct(stripUndefined(input));
    try {
      await publishProductUpserted(product);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to publish auth sync event.";
      request.log.warn({ err: error, productId: product.id, productKey: product.key }, "product auth sync publish failed");
      product = await admin.markProductAuthSyncFailed(product.id, message);
    }
    try {
      await publishProductFinancialCatalogUpserted(product);
    } catch (error) {
      request.log.warn({ err: error, productId: product.id, productKey: product.key }, "product financial sync publish failed");
    }
    return reply.code(201).send(product);
  });
  app.patch("/admin/products/:productKey", { preHandler: requirePermission("admin.products.write") }, async (request) => {
    const params = request.params as { productKey: string };
    const existing = (await admin.listProducts()).find((product) => product.key === params.productKey);
    const input = productSchema.partial().parse(request.body);
    let product = await admin.upsertProduct(stripUndefined({
      ...input,
      key: params.productKey,
      name: input.name ?? existing?.name ?? params.productKey
    }));
    try {
      await publishProductUpserted(product);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to publish auth sync event.";
      request.log.warn({ err: error, productId: product.id, productKey: product.key }, "product auth sync publish failed");
      product = await admin.markProductAuthSyncFailed(product.id, message);
    }
    try {
      await publishProductFinancialCatalogUpserted(product);
    } catch (error) {
      request.log.warn({ err: error, productId: product.id, productKey: product.key }, "product financial sync publish failed");
    }
    return product;
  });

  app.get("/admin/products/:productId/customizations", { preHandler: requirePermission("admin.products.read") }, async (request) => {
    const params = request.params as { productId: string };
    return admin.listProductCustomizations(params.productId);
  });
  app.post("/admin/products/:productId/customizations", { preHandler: requirePermission("admin.products.write") }, async (request, reply) => {
    const params = request.params as { productId: string };
    const input = customizationSchema.parse(request.body);
    const product = await admin.getProductById(params.productId);
    const customization = await admin.upsertProductCustomization({ ...input, productId: product.id });
    await publishProductCustomizationUpserted(product, customization);
    return reply.code(201).send(customization);
  });
  app.patch("/admin/products/:productId/customizations/:customizationId", { preHandler: requirePermission("admin.products.write") }, async (request) => {
    const params = request.params as { productId: string; customizationId: string };
    const existing = await admin.getProductCustomization(params.customizationId);
    const input = customizationSchema.partial().parse(request.body);
    const product = await admin.getProductById(params.productId);
    const customization = await admin.upsertProductCustomization({
      id: existing.id,
      productId: product.id,
      domain: input.domain ?? existing.domain,
      displayName: input.displayName ?? existing.displayName,
      logoUrl: input.logoUrl ?? existing.logoUrl,
      faviconUrl: input.faviconUrl ?? existing.faviconUrl,
      primaryColor: input.primaryColor ?? existing.primaryColor,
      accentColor: input.accentColor ?? existing.accentColor,
      backgroundColor: input.backgroundColor ?? existing.backgroundColor,
      textColor: input.textColor ?? existing.textColor,
      themeTokens: input.themeTokens ?? existing.themeTokens,
      customCss: input.customCss ?? existing.customCss,
      status: input.status ?? existing.status
    });
    await publishProductCustomizationUpserted(product, customization);
    return customization;
  });

  app.get("/admin/products/:productId/services", { preHandler: requirePermission("admin.products.read") }, async (request) => {
    const params = request.params as { productId: string };
    return admin.listProductServices(params.productId);
  });

  app.put("/admin/products/:productId/services", { preHandler: requirePermission("admin.products.write") }, async (request) => {
    const params = request.params as { productId: string };
    const input = productServicesSchema.parse(request.body);
    const result = await admin.replaceProductServices(params.productId, input.services ?? input.serviceIds ?? []);
    try {
      const product = await admin.getProductById(params.productId);
      if (product) {
        const allServices = await admin.listServices();
        const serviceKeyById = new Map(allServices.map((service) => [service.id, service.key]));
        const services = result
          .map((entry) => ({ key: serviceKeyById.get(entry.serviceId), displayOrder: entry.displayOrder }))
          .filter((entry): entry is { key: string; displayOrder: number } => Boolean(entry.key));
        await publishProductServicesSynced(product.key, services);
      }
    } catch (cause) {
      request.log.error({ err: cause }, "failed to publish product services sync event");
    }
    return result;
  });

  app.get("/admin/services", { preHandler: requirePermission("admin.services.read") }, async () => admin.listServices());
  app.post("/admin/services", { preHandler: requirePermission("admin.services.write") }, async (request, reply) => {
    const input = serviceSchema.parse(request.body);
    const service = await admin.upsertService(stripUndefined(input));
    try {
      await publishServiceFinancialCatalogUpserted(service);
    } catch (error) {
      request.log.warn({ err: error, serviceId: service.id, serviceKey: service.key }, "service financial sync publish failed");
    }
    return reply.code(201).send(service);
  });
  app.patch("/admin/services/:serviceKey", { preHandler: requirePermission("admin.services.write") }, async (request) => {
    const params = request.params as { serviceKey: string };
    const existing = (await admin.listServices()).find((service) => service.key === params.serviceKey);
    const input = serviceSchema.partial().parse(request.body);
    const service = await admin.upsertService(stripUndefined({
      ...input,
      key: params.serviceKey,
      name: input.name ?? existing?.name ?? params.serviceKey
    }));
    try {
      await publishServiceFinancialCatalogUpserted(service);
    } catch (error) {
      request.log.warn({ err: error, serviceId: service.id, serviceKey: service.key }, "service financial sync publish failed");
    }
    return service;
  });
}

function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function forbiddenOrganization(reply: FastifyReply) {
  return reply.code(403).send({
    error: { code: "FORBIDDEN", message: "Organization access is not allowed." }
  });
}

function notFoundUser(reply: FastifyReply) {
  return reply.code(404).send({ error: { code: "NOT_FOUND", message: "User not found." } });
}

function handleOrganizationUserMutationError(error: unknown, reply: FastifyReply) {
  if (error instanceof OrganizationUserNotFoundError) return notFoundUser(reply);
  if (error instanceof LastOrganizationAdminError || error instanceof OrganizationUserConflictError) {
    return reply.code(409).send({ error: { code: "CONFLICT", message: error.message } });
  }
  if (error instanceof OrganizationAccessError) return forbiddenOrganization(reply);
  throw error;
}
