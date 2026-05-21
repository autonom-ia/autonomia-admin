import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
import { config } from "./config.js";
import type { AuthenticatedPrincipal } from "./types.js";

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export class AuthError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

export async function requirePrincipal(request: FastifyRequest): Promise<AuthenticatedPrincipal> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new AuthError();
  const token = header.slice("Bearer ".length).trim();
  if (!token) throw new AuthError();

  const claims = await verifyOrDecode(token);
  const email = stringClaim(claims.email) ?? stringClaim(claims.username) ?? stringClaim(claims["cognito:username"]);
  const id = stringClaim(claims.sub) ?? email;
  if (!email || !id) throw new AuthError("Token does not contain an email/sub.");

  return {
    id,
    email,
    name: stringClaim(claims.name) ?? email.split("@")[0] ?? email,
    ...(stringClaim(claims.token_use) ? { tokenUse: stringClaim(claims.token_use) } : {}),
    rawClaims: claims
  };
}

async function verifyOrDecode(token: string): Promise<Record<string, unknown>> {
  if (!config.jwksUrl) return decodeJwt(token);

  jwks ??= createRemoteJWKSet(new URL(config.jwksUrl));
  const options = {
    ...(config.jwtIssuer ? { issuer: config.jwtIssuer } : {}),
    ...(config.jwtAudience ? { audience: config.jwtAudience } : {})
  };
  const verified = await jwtVerify(token, jwks, options);
  return verified.payload;
}

function stringClaim(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
