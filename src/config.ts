import "dotenv/config";

function list(value: string | undefined, fallback: string[]) {
  if (!value) return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? "3003"),
  host: process.env.HOST ?? "0.0.0.0",
  corsOrigins: list(process.env.CORS_ORIGINS, ["http://localhost:3002"]),
  jwtIssuer: process.env.JWT_ISSUER,
  jwtAudience: process.env.JWT_AUDIENCE,
  jwksUrl: process.env.JWKS_URL
};
