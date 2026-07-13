import type { AdminPermission, AdminUser, AuthenticatedPrincipal } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    principal: AuthenticatedPrincipal;
    adminUser: AdminUser;
    adminPermissions: AdminPermission[];
  }
}
