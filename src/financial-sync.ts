import { randomUUID } from "node:crypto";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { config } from "./config.js";
import type { AdminOrganization, AdminProduct, AdminService } from "./types.js";

const sqs = new SQSClient({ region: config.awsRegion });

type FinancialCatalogItemType = "product" | "service";

export interface FinancialCatalogItemUpsertedEvent {
  eventId: string;
  eventType: "admin.product.financial_catalog_upserted" | "admin.service.financial_catalog_upserted";
  occurredAt: string;
  source: "admin";
  data: {
    operatorKey: "autonom-ia";
    operatorName: "Autonom.ia";
    item: {
      sourceId: string;
      type: FinancialCatalogItemType;
      key: string;
      name: string;
      description: string | null;
      logoUrl?: string | null;
      primaryColor?: string | null;
      accentColor?: string | null;
      registerCallbackUrl?: string | null;
      termsUrl?: string | null;
      status: "active" | "inactive";
    };
  };
}

export interface FinancialOrganizationUpsertedEvent {
  eventId: string;
  eventType: "admin.organization.upserted";
  occurredAt: string;
  source: "admin";
  data: {
    organization: {
      id: string;
      key: string;
      name: string;
      status: "active" | "inactive";
    };
  };
}

export async function publishOrganizationFinancialUpserted(organization: AdminOrganization) {
  if (!config.financialSyncQueueUrl) {
    throw new Error("FINANCIAL_SYNC_QUEUE_URL is required to publish financial organization sync events.");
  }

  const event: FinancialOrganizationUpsertedEvent = {
    eventId: randomUUID(),
    eventType: "admin.organization.upserted",
    occurredAt: new Date().toISOString(),
    source: "admin",
    data: {
      organization: {
        id: organization.id,
        key: organization.key,
        name: organization.name,
        status: organization.status
      }
    }
  };

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: config.financialSyncQueueUrl,
      MessageBody: JSON.stringify(event)
    })
  );

  return event;
}

export async function publishProductFinancialCatalogUpserted(product: AdminProduct) {
  return publishFinancialCatalogItemUpserted({
    eventType: "admin.product.financial_catalog_upserted",
    type: "product",
    sourceId: product.id,
    key: product.key,
    name: product.name,
    description: product.description,
    logoUrl: product.logoUrl,
    primaryColor: product.primaryColor,
    accentColor: product.accentColor,
    registerCallbackUrl: product.registerCallbackUrl,
    termsUrl: product.termsUrl,
    status: product.status
  });
}

export async function publishServiceFinancialCatalogUpserted(service: AdminService) {
  return publishFinancialCatalogItemUpserted({
    eventType: "admin.service.financial_catalog_upserted",
    type: "service",
    sourceId: service.id,
    key: service.key,
    name: service.name,
    description: service.description,
    status: service.status
  });
}

async function publishFinancialCatalogItemUpserted(input: {
  eventType: FinancialCatalogItemUpsertedEvent["eventType"];
  type: FinancialCatalogItemType;
  sourceId: string;
  key: string;
  name: string;
  description: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  registerCallbackUrl?: string | null;
  termsUrl?: string | null;
  status: "active" | "inactive";
}) {
  if (!config.financialSyncQueueUrl) {
    throw new Error("FINANCIAL_SYNC_QUEUE_URL is required to publish financial catalog sync events.");
  }

  const event: FinancialCatalogItemUpsertedEvent = {
    eventId: randomUUID(),
    eventType: input.eventType,
    occurredAt: new Date().toISOString(),
    source: "admin",
    data: {
      operatorKey: "autonom-ia",
      operatorName: "Autonom.ia",
      item: {
        sourceId: input.sourceId,
        type: input.type,
        key: input.key,
        name: input.name,
        description: input.description,
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
        ...(input.primaryColor !== undefined ? { primaryColor: input.primaryColor } : {}),
        ...(input.accentColor !== undefined ? { accentColor: input.accentColor } : {}),
        ...(input.registerCallbackUrl !== undefined ? { registerCallbackUrl: input.registerCallbackUrl } : {}),
        ...(input.termsUrl !== undefined ? { termsUrl: input.termsUrl } : {}),
        status: input.status
      }
    }
  };

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: config.financialSyncQueueUrl,
      MessageBody: JSON.stringify(event)
    })
  );

  return event;
}

export interface ProductServicesSyncedEvent {
  eventId: string;
  eventType: "admin.product.services_synced";
  occurredAt: string;
  source: "admin";
  data: {
    operatorKey: "autonom-ia";
    operatorName: "Autonom.ia";
    product: { key: string };
    services: Array<{ key: string; displayOrder: number }>;
  };
}

export async function publishProductServicesSynced(productKey: string, services: Array<{ key: string; displayOrder: number }>) {
  if (!config.financialSyncQueueUrl) {
    throw new Error("FINANCIAL_SYNC_QUEUE_URL is required to publish product services sync events.");
  }

  const event: ProductServicesSyncedEvent = {
    eventId: randomUUID(),
    eventType: "admin.product.services_synced",
    occurredAt: new Date().toISOString(),
    source: "admin",
    data: {
      operatorKey: "autonom-ia",
      operatorName: "Autonom.ia",
      product: { key: productKey },
      services
    }
  };

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: config.financialSyncQueueUrl,
      MessageBody: JSON.stringify(event)
    })
  );

  return event;
}
