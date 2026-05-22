import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePrincipal } from "./auth.js";
import { store } from "./store.js";
import { createUploadUrl, getAssetObject } from "./uploads.js";

const productSchema = z.object({
  key: z.string().min(2),
  name: z.string().min(2),
  description: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  primaryColor: z.string().optional(),
  accentColor: z.string().optional(),
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

const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  photoUrl: z.string().nullable().optional(),
  status: z.enum(["active", "inactive", "invited"]).optional(),
  roleNames: z.array(z.string()).optional()
});

const profileSchema = z.object({
  name: z.string().min(2).optional(),
  photoUrl: z.string().nullable().optional()
});

const roleSchema = z.object({
  name: z.string().min(2),
  description: z.string().nullable().optional(),
  permissions: z.array(z.string()).optional(),
  status: z.enum(["active", "inactive"]).optional()
});

const uploadUrlSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  folder: z.string().optional()
});

export async function registerRoutes(app: FastifyInstance) {
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
    try {
      const principal = await requirePrincipal(request);
      request.principal = principal;
      store.ensureUser({
        id: principal.id,
        email: principal.email,
        name: principal.name
      });
    } catch {
      return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Unauthorized." } });
    }
  });

  app.get("/admin/me", async (request) => {
    const principal = request.principal;
    const user = store.ensureUser({ id: principal.id, email: principal.email, name: principal.name });
    const roles = store.listRoles();
    const permissions = [...new Set(roles.flatMap((role) => role.permissions))];
    return {
      user,
      organizations: [{ id: "autonomia", name: "Autonom.ia" }],
      permissions,
      services: store.listServices(),
      products: store.listProducts()
    };
  });

  app.post("/admin/uploads/presigned-url", async (request, reply) => {
    const input = uploadUrlSchema.parse(request.body);
    return reply.code(201).send(await createUploadUrl(input));
  });

  app.patch("/admin/me", async (request) => {
    const principal = request.principal;
    const existing = store.ensureUser({ id: principal.id, email: principal.email, name: principal.name });
    const input = profileSchema.parse(request.body);
    return store.upsertUser(stripUndefined({
      id: existing.id,
      email: existing.email,
      name: input.name ?? existing.name,
      photoUrl: input.photoUrl ?? existing.photoUrl ?? null,
      status: existing.status,
      roleNames: existing.roleNames
    }));
  });

  app.get("/admin/users", async () => store.listUsers());
  app.post("/admin/users/invitations", async (request, reply) => {
    const input = userSchema.parse(request.body);
    return reply.code(201).send(store.upsertUser(stripUndefined({
      ...input,
      status: input.status ?? "invited",
      roleNames: input.roleNames ?? ["Administrador"]
    })));
  });
  app.patch("/admin/users/:userId", async (request) => {
    const params = request.params as { userId: string };
    const existing = store.listUsers().find((user) => user.id === params.userId || user.email === params.userId);
    const input = userSchema.partial().parse(request.body);
    return store.upsertUser(stripUndefined({
      id: existing?.id ?? params.userId,
      email: input.email ?? existing?.email ?? params.userId,
      name: input.name ?? existing?.name ?? params.userId,
      photoUrl: input.photoUrl ?? existing?.photoUrl ?? null,
      status: input.status ?? existing?.status ?? "active",
      roleNames: input.roleNames ?? existing?.roleNames
    }));
  });
  app.get("/admin/roles", async () => store.listRoles());
  app.post("/admin/roles", async (request, reply) => {
    const input = roleSchema.parse(request.body);
    return reply.code(201).send(store.upsertRole(stripUndefined({
      ...input,
      permissions: input.permissions ?? []
    })));
  });
  app.patch("/admin/roles/:roleId", async (request) => {
    const params = request.params as { roleId: string };
    const existing = store.listRoles().find((role) => role.id === params.roleId || role.name === params.roleId);
    const input = roleSchema.partial().parse(request.body);
    return store.upsertRole(stripUndefined({
      id: existing?.id ?? params.roleId,
      name: input.name ?? existing?.name ?? params.roleId,
      description: input.description ?? existing?.description ?? null,
      permissions: input.permissions ?? existing?.permissions ?? [],
      status: input.status ?? existing?.status ?? "active"
    }));
  });

  app.get("/admin/products", async () => store.listProducts());
  app.post("/admin/products", async (request, reply) => {
    const input = productSchema.parse(request.body);
    return reply.code(201).send(store.upsertProduct(stripUndefined(input)));
  });
  app.patch("/admin/products/:productKey", async (request) => {
    const params = request.params as { productKey: string };
    const existing = store.listProducts().find((product) => product.key === params.productKey);
    const input = productSchema.partial().parse(request.body);
    return store.upsertProduct(stripUndefined({
      ...input,
      key: params.productKey,
      name: input.name ?? existing?.name ?? params.productKey
    }));
  });

  app.get("/admin/services", async () => store.listServices());
  app.post("/admin/services", async (request, reply) => {
    const input = serviceSchema.parse(request.body);
    return reply.code(201).send(store.upsertService(stripUndefined(input)));
  });
  app.patch("/admin/services/:serviceKey", async (request) => {
    const params = request.params as { serviceKey: string };
    const existing = store.listServices().find((service) => service.key === params.serviceKey);
    const input = serviceSchema.partial().parse(request.body);
    return store.upsertService(stripUndefined({
      ...input,
      key: params.serviceKey,
      name: input.name ?? existing?.name ?? params.serviceKey
    }));
  });
}

function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
