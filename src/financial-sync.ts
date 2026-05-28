import { randomUUID } from "node:crypto";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { config } from "./config.js";
import type { AdminProduct, AdminService } from "./types.js";

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
      status: "active" | "inactive";
    };
  };
}

export async function publishProductFinancialCatalogUpserted(product: AdminProduct) {
  return publishFinancialCatalogItemUpserted({
    eventType: "admin.product.financial_catalog_upserted",
    type: "product",
    sourceId: product.id,
    key: product.key,
    name: product.name,
    description: product.description,
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
