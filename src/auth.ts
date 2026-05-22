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
  const profileClaims = decodeIdentityClaims(request);
  const email =
    stringClaim(profileClaims.email) ??
    stringClaim(claims.email) ??
    stringClaim(claims.username) ??
    stringClaim(claims["cognito:username"]);
  const id = stringClaim(claims.sub) ?? stringClaim(profileClaims.sub) ?? email;
  if (!email || !id) throw new AuthError("Token does not contain an email/sub.");

  return {
    id,
    email,
    name: stringClaim(profileClaims.name) ?? stringClaim(claims.name) ?? email.split("@")[0] ?? email,
    ...(stringClaim(claims.token_use) ? { tokenUse: stringClaim(claims.token_use) } : {}),
    rawClaims: claims
  };
}

function decodeIdentityClaims(request: FastifyRequest): Record<string, unknown> {
  const header = request.headers["x-identity-token"];
  const token = Array.isArray(header) ? header[0] : header;
  if (!token) return {};
  try {
    return decodeJwt(token);
  } catch {
    return {};
  }
}

async function verifyOrDecode(token: string): Promise<Record<string, unknown>> {
  if (!config.jwksUrl) return decodeJwt(token);

  jwks ??= createRemoteJWKSet(new URL(config.jwksUrl));
  const options = {
    ...(config.jwtIssuer ? { issuer: config.jwtIssuer } : {})
  };
  const verified = await jwtVerify(token, jwks, options);
  assertExpectedAudienceOrClient(verified.payload);
  return verified.payload;
}

function stringClaim(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function assertExpectedAudienceOrClient(claims: Record<string, unknown>) {
  if (!config.jwtAudience) return;

  const audience = claims.aud;
  const clientId = stringClaim(claims.client_id);
  const audienceMatches = Array.isArray(audience)
    ? audience.includes(config.jwtAudience)
    : audience === config.jwtAudience;

  if (!audienceMatches && clientId !== config.jwtAudience) {
    throw new AuthError("Token audience/client_id does not match this API.");
  }
}
