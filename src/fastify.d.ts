import type { AdminUser, AuthenticatedPrincipal } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    principal: AuthenticatedPrincipal;
    adminUser: AdminUser;
  }
}
