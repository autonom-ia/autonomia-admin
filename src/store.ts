import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { AdminProduct, AdminRole, AdminService, AdminUser } from "./types.js";

export interface UpsertProductInput {
  key: string;
  name: string;
  description?: string | null | undefined;
  logoUrl?: string | null | undefined;
  primaryColor?: string | undefined;
  accentColor?: string | undefined;
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
  roleNames?: string[] | undefined;
}

export interface UpsertRoleInput {
  id?: string | undefined;
  name: string;
  description?: string | null | undefined;
  permissions?: string[] | undefined;
  status?: AdminRole["status"] | undefined;
}

const now = () => new Date().toISOString();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidOrNew = (id?: string | null) => (id && uuidPattern.test(id) ? id : randomUUID());

const createdAt = now();

const products = new Map<string, AdminProduct>([
  [
    "neuroai-web",
    {
      id: randomUUID(),
      key: "neuroai-web",
      name: "NeuroAI",
      description: "Studio operacional do NeuroAI",
      logoUrl: null,
      primaryColor: "#1E3A8A",
      accentColor: "#38BDF8",
      status: "active",
      createdAt,
      updatedAt: createdAt
    }
  ],
  [
    "autonomia-studio",
    {
      id: randomUUID(),
      key: "autonomia-studio",
      name: "Autonomia Studio",
      description: "Console administrativo Autonom.ia",
      logoUrl: null,
      primaryColor: "#0F172A",
      accentColor: "#F97316",
      status: "active",
      createdAt,
      updatedAt: createdAt
    }
  ]
]);

const services = new Map<string, AdminService>([
  [
    "admin",
    {
      id: randomUUID(),
      key: "admin",
      name: "Admin",
      description: "Usuarios, produtos e services",
      serviceType: "sdk",
      packageName: "@autonom-ia/admin-sdk",
      entrypointUrl: null,
      status: "active",
      createdAt,
      updatedAt: createdAt
    }
  ]
]);

const users = new Map<string, AdminUser>();

const roles = new Map<string, AdminRole>([
  [
    "admin",
    {
      id: randomUUID(),
      name: "Administrador",
      description: "Acesso administrativo completo",
      permissions: ["admin.users.read", "admin.roles.read", "admin.products.read", "admin.services.read"],
      status: "active"
    }
  ],
  [
    "commercial",
    {
      id: randomUUID(),
      name: "Comercial",
      description: "Acesso comercial inicial",
      permissions: ["admin.users.read", "admin.products.read", "admin.services.read"],
      status: "active"
    }
  ]
]);

interface StoreSnapshot {
  products?: AdminProduct[];
  services?: AdminService[];
  users?: AdminUser[];
  roles?: AdminRole[];
}

const dataFile = resolve(process.cwd(), ".data/admin-store.json");

loadSnapshot();

export const store = {
  listProducts() {
    return [...products.values()];
  },
  upsertProduct(input: UpsertProductInput) {
    const existing = products.get(input.key);
    const timestamp = now();
    const product: AdminProduct = {
      id: uuidOrNew(existing?.id),
      key: input.key,
      name: input.name,
      description: input.description ?? existing?.description ?? null,
      logoUrl: input.logoUrl ?? existing?.logoUrl ?? null,
      primaryColor: input.primaryColor ?? existing?.primaryColor ?? "#1E3A8A",
      accentColor: input.accentColor ?? existing?.accentColor ?? "#38BDF8",
      status: input.status ?? existing?.status ?? "active",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    products.set(product.key, product);
    saveSnapshot();
    return product;
  },
  listServices() {
    return [...services.values()];
  },
  upsertService(input: UpsertServiceInput) {
    const existing = services.get(input.key);
    const timestamp = now();
    const service: AdminService = {
      id: uuidOrNew(existing?.id),
      key: input.key,
      name: input.name,
      description: input.description ?? existing?.description ?? null,
      serviceType: input.serviceType ?? existing?.serviceType ?? "sdk",
      packageName: input.packageName ?? existing?.packageName ?? null,
      entrypointUrl: input.entrypointUrl ?? existing?.entrypointUrl ?? null,
      status: input.status ?? existing?.status ?? "active",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    services.set(service.key, service);
    saveSnapshot();
    return service;
  },
  listUsers() {
    return [...users.values()];
  },
  ensureUser(input: Pick<AdminUser, "id" | "email" | "name"> & Partial<Pick<AdminUser, "photoUrl">>) {
    const existing = users.get(input.email);
    const timestamp = now();
    const user: AdminUser = {
      id: uuidOrNew(existing?.id ?? input.id),
      email: input.email,
      name: input.name,
      photoUrl: input.photoUrl ?? existing?.photoUrl ?? null,
      status: existing?.status ?? "active",
      roleNames: existing?.roleNames ?? ["Administrador"],
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    users.set(user.email, user);
    saveSnapshot();
    return user;
  },
  upsertUser(input: UpsertUserInput) {
    const existing = users.get(input.email) ?? [...users.values()].find((user) => user.id === input.id);
    const timestamp = now();
    const user: AdminUser = {
      id: uuidOrNew(existing?.id ?? input.id),
      email: input.email,
      name: input.name,
      photoUrl: input.photoUrl ?? existing?.photoUrl ?? null,
      status: input.status ?? existing?.status ?? "active",
      roleNames: input.roleNames ?? existing?.roleNames ?? ["Administrador"],
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    if (existing?.email && existing.email !== user.email) users.delete(existing.email);
    users.set(user.email, user);
    saveSnapshot();
    return user;
  },
  listRoles() {
    return [...roles.values()];
  },
  upsertRole(input: UpsertRoleInput) {
    const id = uuidOrNew(input.id);
    const existing = roles.get(id) ?? [...roles.values()].find((role) => role.id === input.id || role.name === input.name);
    const role: AdminRole = {
      id: uuidOrNew(existing?.id ?? id),
      name: input.name,
      description: input.description ?? existing?.description ?? null,
      permissions: input.permissions ?? existing?.permissions ?? [],
      status: input.status ?? existing?.status ?? "active"
    };
    roles.set(role.id.replace(/^role_/, ""), role);
    saveSnapshot();
    return role;
  }
};

function loadSnapshot() {
  try {
    const snapshot = JSON.parse(readFileSync(dataFile, "utf8")) as StoreSnapshot;
    let normalized = false;
    if (snapshot.products) products.clear();
    if (snapshot.services) services.clear();
    if (snapshot.users) users.clear();
    if (snapshot.roles) roles.clear();
    snapshot.products?.forEach((product) => {
      const item = { ...product, id: uuidOrNew(product.id) };
      normalized ||= item.id !== product.id;
      products.set(item.key, item);
    });
    snapshot.services?.forEach((service) => {
      const item = { ...service, id: uuidOrNew(service.id) };
      normalized ||= item.id !== service.id;
      services.set(item.key, item);
    });
    snapshot.users?.forEach((user) => {
      const item = { ...user, id: uuidOrNew(user.id) };
      normalized ||= item.id !== user.id;
      users.set(item.email, item);
    });
    snapshot.roles?.forEach((role) => {
      const item = { ...role, id: uuidOrNew(role.id) };
      normalized ||= item.id !== role.id;
      roles.set(item.id, item);
    });
    if (normalized) saveSnapshot();
  } catch {
    // Local development starts with seed data when no persisted file exists.
  }
}

function saveSnapshot() {
  const snapshot: StoreSnapshot = {
    products: [...products.values()],
    services: [...services.values()],
    users: [...users.values()],
    roles: [...roles.values()]
  };
  mkdirSync(dirname(dataFile), { recursive: true });
  writeFileSync(dataFile, JSON.stringify(snapshot, null, 2));
}
