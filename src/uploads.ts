import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
  const publicUrl = `${publicBaseUrl()}/${key}`;

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

function publicBaseUrl() {
  if (config.assetsPublicBaseUrl) return config.assetsPublicBaseUrl.replace(/\/+$/g, "");
  return `https://${config.assetsBucket}.s3.${config.awsRegion}.amazonaws.com`;
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
