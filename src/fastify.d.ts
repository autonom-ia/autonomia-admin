import type { AdminOrganization, AdminPermission, AdminUser, AuthenticatedPrincipal } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    principal: AuthenticatedPrincipal;
    adminUser: AdminUser;
    adminPermissions: AdminPermission[];
    adminOrganization?: AdminOrganization | undefined;
  }
}
