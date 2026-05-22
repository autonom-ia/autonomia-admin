import { randomUUID } from "node:crypto";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { config } from "./config.js";
import type { AdminProduct, AdminProductCustomization } from "./types.js";

const sqs = new SQSClient({ region: config.awsRegion });

export interface AdminProductUpsertedEvent {
  eventId: string;
  eventType: "admin.product.upserted";
  occurredAt: string;
  source: "admin";
  data: {
    productId: string;
    productKey: string;
    name: string;
    description: string | null;
    logoUrl: string | null;
    primaryColor: string;
    accentColor: string;
    status: AdminProduct["status"];
    oauth: {
      clientId: string;
      allowedRedirectUris: string[];
      allowedLogoutUris: string[];
      allowedOrigins: string[];
      allowGoogleLogin: boolean;
      allowGithubLogin: boolean;
      allowEmailPasswordLogin: boolean;
      allowPasskeyLogin: boolean;
      accessTokenTtlSeconds: number;
      refreshTokenTtlSeconds: number;
    };
  };
}

export interface AdminProductCustomizationUpsertedEvent {
  eventId: string;
  eventType: "admin.product_customization.upserted";
  occurredAt: string;
  source: "admin";
  data: {
    productId: string;
    productKey: string;
    oauthClientId: string;
    productCustomizationId: string;
    domain: string;
    displayName: string | null;
    logoUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string | null;
    accentColor: string | null;
    backgroundColor: string | null;
    textColor: string | null;
    themeTokens: Record<string, unknown>;
    customCss: Record<string, unknown>;
    status: AdminProductCustomization["status"];
  };
}

export async function publishProductUpserted(product: AdminProduct) {
  if (!config.authSyncQueueUrl) {
    throw new Error("AUTH_SYNC_QUEUE_URL is required to publish admin.product.upserted.");
  }

  const event: AdminProductUpsertedEvent = {
    eventId: randomUUID(),
    eventType: "admin.product.upserted",
    occurredAt: new Date().toISOString(),
    source: "admin",
    data: {
      productId: product.id,
      productKey: product.key,
      name: product.name,
      description: product.description,
      logoUrl: product.logoUrl,
      primaryColor: product.primaryColor,
      accentColor: product.accentColor,
      status: product.status,
      oauth: {
        clientId: product.oauthClientId ?? product.key,
        allowedRedirectUris: product.allowedRedirectUris,
        allowedLogoutUris: product.allowedLogoutUris,
        allowedOrigins: product.allowedOrigins,
        allowGoogleLogin: product.allowGoogleLogin,
        allowGithubLogin: product.allowGithubLogin,
        allowEmailPasswordLogin: product.allowEmailPasswordLogin,
        allowPasskeyLogin: product.allowPasskeyLogin,
        accessTokenTtlSeconds: product.accessTokenTtlSeconds,
        refreshTokenTtlSeconds: product.refreshTokenTtlSeconds
      }
    }
  };

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: config.authSyncQueueUrl,
      MessageBody: JSON.stringify(event)
    })
  );

  return event;
}

export async function publishProductCustomizationUpserted(product: AdminProduct, customization: AdminProductCustomization) {
  if (!config.authSyncQueueUrl) {
    throw new Error("AUTH_SYNC_QUEUE_URL is required to publish admin.product_customization.upserted.");
  }

  const event: AdminProductCustomizationUpsertedEvent = {
    eventId: randomUUID(),
    eventType: "admin.product_customization.upserted",
    occurredAt: new Date().toISOString(),
    source: "admin",
    data: {
      productId: product.id,
      productKey: product.key,
      oauthClientId: product.oauthClientId ?? product.key,
      productCustomizationId: customization.id,
      domain: customization.domain,
      displayName: customization.displayName,
      logoUrl: customization.logoUrl,
      faviconUrl: customization.faviconUrl,
      primaryColor: customization.primaryColor,
      accentColor: customization.accentColor,
      backgroundColor: customization.backgroundColor,
      textColor: customization.textColor,
      themeTokens: customization.themeTokens,
      customCss: customization.customCss,
      status: customization.status
    }
  };

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: config.authSyncQueueUrl,
      MessageBody: JSON.stringify(event)
    })
  );

  return event;
}
