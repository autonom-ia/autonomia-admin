import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePrincipal } from "./auth.js";
import { store } from "./store.js";

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

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true, service: "autonomia-admin" }));

  app.addHook("preHandler", async (request, reply) => {
    if (request.url === "/health") return;
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

  app.get("/admin/users", async () => store.listUsers());
  app.get("/admin/roles", async () => store.listRoles());

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
