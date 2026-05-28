import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { config } from "./config.js";

const s3 = new S3Client({ region: config.awsRegion });

export interface CreateUploadUrlInput {
  fileName: string;
  contentType: string;
  folder?: string | undefined;
}

export async function createUploadUrl(input: CreateUploadUrlInput) {
  if (!config.assetsBucket) {
    const error = new Error("ADMIN_ASSETS_BUCKET is not configured.") as Error & { statusCode?: number };
    error.statusCode = 503;
    throw error;
  }

  if (!input.contentType.startsWith("image/")) {
    const error = new Error("Only image uploads are supported.") as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  const extension = safeExtension(input.fileName, input.contentType);
  const folder = sanitizeFolder(input.folder ?? "uploads");
  const key = `${folder}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
  const command = new PutObjectCommand({
    Bucket: config.assetsBucket,
    Key: key,
    ContentType: input.contentType
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: config.uploadUrlExpiresSeconds });
  const publicUrl = `${publicBaseUrl()}/${encodeAssetKey(key)}`;

  return {
    uploadUrl,
    publicUrl,
    key,
    method: "PUT" as const,
    headers: {
      "content-type": input.contentType
    },
    expiresIn: config.uploadUrlExpiresSeconds
  };
}

export async function getAssetObject(key: string) {
  if (!config.assetsBucket) {
    const error = new Error("ADMIN_ASSETS_BUCKET is not configured.") as Error & { statusCode?: number };
    error.statusCode = 503;
    throw error;
  }

  const normalizedKey = normalizeAssetKey(key);
  const result = await s3.send(new GetObjectCommand({
    Bucket: config.assetsBucket,
    Key: normalizedKey
  }));

  return {
    body: result.Body ? Buffer.from(await result.Body.transformToByteArray()) : Buffer.alloc(0),
    contentType: result.ContentType ?? "application/octet-stream",
    contentLength: result.ContentLength,
    cacheControl: result.CacheControl ?? "public, max-age=31536000, immutable"
  };
}

function publicBaseUrl() {
  if (config.assetsPublicBaseUrl) return config.assetsPublicBaseUrl.replace(/\/+$/g, "");
  return "/assets";
}

function encodeAssetKey(key: string) {
  return key.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function normalizeAssetKey(key: string) {
  const decoded = decodeURIComponent(key).replace(/^\/+/, "");
  if (!decoded || decoded.includes("..")) {
    const error = new Error("Invalid asset key.") as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return decoded;
}

function safeExtension(fileName: string, contentType: string) {
  const fromName = extname(fileName).toLowerCase().replace(/[^.a-z0-9]/g, "");
  if (fromName && fromName.length <= 8) return fromName;
  if (contentType === "image/png") return ".png";
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/svg+xml") return ".svg";
  return "";
}

function sanitizeFolder(value: string) {
  return value
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((part) => part.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase())
    .filter(Boolean)
    .join("/") || "uploads";
}
