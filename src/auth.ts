import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";
import type { AuthenticatedPrincipal } from "./types.js";

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export class AuthError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

export function assertAuthConfiguration() {
  const missing = [
    ["JWKS_URL", config.jwksUrl],
    ["JWT_ISSUER", config.jwtIssuer],
    ["JWT_AUDIENCE", config.jwtAudience]
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) {
    throw new Error(`JWT authentication is not configured. Missing: ${missing.join(", ")}.`);
  }
}

export async function requirePrincipal(request: FastifyRequest): Promise<AuthenticatedPrincipal> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new AuthError();
  const token = header.slice("Bearer ".length).trim();
  if (!token) throw new AuthError();

  const claims = await verifyToken(token, "access");
  const identityToken = identityTokenFromRequest(request);
  const profileClaims = identityToken ? await verifyToken(identityToken, "id") : {};
  const subject = stringClaim(claims.sub);
  const identitySubject = stringClaim(profileClaims.sub);
  if (!subject) throw new AuthError("Access token does not contain a subject.");
  if (identitySubject && identitySubject !== subject) {
    throw new AuthError("Access and identity token subjects do not match.");
  }
  const email =
    stringClaim(profileClaims.email) ??
    stringClaim(claims.email) ??
    stringClaim(claims.username) ??
    stringClaim(claims["cognito:username"]);
  if (!email) throw new AuthError("Verified token does not contain an email.");

  return {
    id: subject,
    email,
    name: stringClaim(profileClaims.name) ?? stringClaim(claims.name) ?? email.split("@")[0] ?? email,
    ...(stringClaim(claims.token_use) ? { tokenUse: stringClaim(claims.token_use) } : {}),
    rawClaims: claims
  };
}

function identityTokenFromRequest(request: FastifyRequest) {
  const header = request.headers["x-identity-token"];
  return Array.isArray(header) ? header[0] : header;
}

async function verifyToken(token: string, expectedTokenUse: "access" | "id"): Promise<Record<string, unknown>> {
  assertAuthConfiguration();

  jwks ??= createRemoteJWKSet(new URL(config.jwksUrl!));
  const verified = await jwtVerify(token, jwks, {
    issuer: config.jwtIssuer!,
    requiredClaims: ["sub", "token_use", "iat", "exp"]
  });
  assertExpectedClient(verified.payload, expectedTokenUse);
  if (stringClaim(verified.payload.token_use) !== expectedTokenUse) {
    throw new AuthError(`Expected a verified ${expectedTokenUse} token.`);
  }
  return verified.payload;
}

function stringClaim(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function assertExpectedClient(claims: Record<string, unknown>, tokenUse: "access" | "id") {
  const audience = claims.aud;
  const clientId = stringClaim(claims.client_id);
  const audienceMatches = Array.isArray(audience)
    ? audience.includes(config.jwtAudience!)
    : audience === config.jwtAudience;

  if (tokenUse === "access" && clientId !== config.jwtAudience) {
    throw new AuthError("Access token client_id does not match this API.");
  }
  if (tokenUse === "id" && !audienceMatches) {
    throw new AuthError("Identity token audience does not match this API.");
  }
}
