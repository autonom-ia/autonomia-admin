import "dotenv/config";

function list(value: string | undefined, fallback: string[]) {
  if (!value) return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? "3003"),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL,
  databasePoolMax: Number(process.env.DATABASE_POOL_MAX ?? "5"),
  databaseSslMode: process.env.DATABASE_SSL_MODE ?? process.env.PGSSLMODE,
  databaseSslRejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
  authSyncQueueUrl: process.env.AUTH_SYNC_QUEUE_URL,
  financialSyncQueueUrl: process.env.FINANCIAL_SYNC_QUEUE_URL,
  corsOrigins: list(process.env.CORS_ORIGINS, ["http://localhost:3002"]),
  jwtIssuer: process.env.JWT_ISSUER,
  jwtAudience: process.env.JWT_AUDIENCE,
  jwksUrl: process.env.JWKS_URL,
  awsRegion: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1",
  assetsBucket: process.env.ADMIN_ASSETS_BUCKET,
  assetsPublicBaseUrl: process.env.ADMIN_ASSETS_PUBLIC_BASE_URL,
  uploadUrlExpiresSeconds: Number(process.env.ADMIN_UPLOAD_URL_EXPIRES_SECONDS ?? "300")
};
