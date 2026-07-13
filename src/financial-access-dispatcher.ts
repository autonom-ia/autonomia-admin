import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { Pool } from "pg";
import { config } from "./config.js";
import { getPool } from "./db.js";
import {
  financialAccessSnapshotSchema,
  financialOrganizationSnapshotSchema,
  type FinancialSyncSnapshotEvent
} from "./financial-access-outbox.js";

type Sender = {
  send(command: SendMessageCommand): Promise<unknown>;
};

type ClaimedEvent = {
  table: "financial_access_outbox" | "financial_organization_outbox";
  event_id: string;
  aggregate_id: string;
  revision: string;
  event_type: FinancialSyncSnapshotEvent["eventType"];
  schema_version: number;
  lease_token: string;
  attempt_count: number;
  payload: unknown;
};

export type DispatchResult = {
  claimed: number;
  published: number;
  failed: number;
};

export class FinancialAccessOutboxDispatcher {
  constructor(
    private readonly db: Pool,
    private readonly sender: Sender,
    private readonly queueUrl: string,
    private readonly options: {
      batchSize?: number;
      leaseSeconds?: number;
      now?: () => Date;
    } = {}
  ) {
    if (!queueUrl) throw new Error("FINANCIAL_SYNC_QUEUE_URL is required to dispatch financial access snapshots.");
  }

  async dispatch(): Promise<DispatchResult> {
    const claimed = [
      ...await this.claim(
        "financial_access_outbox",
        "admin_user_id",
        this.options.batchSize ?? 10
      ),
      ...await this.claim(
        "financial_organization_outbox",
        "organization_id",
        this.options.batchSize ?? 10
      )
    ];
    let published = 0;
    let failed = 0;
    for (const row of claimed) {
      try {
        const payload = parseAndValidateEnvelope(row);
        await this.sender.send(new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(payload)
        }));
        const result = await this.db.query(
          `UPDATE admin.${row.table}
           SET status = 'published',
               published_at = $3,
               lease_token = NULL,
               lease_until = NULL,
               last_error = NULL,
               updated_at = $3
           WHERE event_id = $1
             AND status = 'processing'
             AND lease_token = $2`,
          [row.event_id, row.lease_token, this.now()]
        );
        if (result.rowCount === 1) published += 1;
      } catch (error) {
        failed += 1;
        const delaySeconds = Math.min(300, 2 ** Math.min(row.attempt_count, 8));
        const now = this.now();
        const result = await this.db.query(
          `UPDATE admin.${row.table}
           SET status = 'pending',
               next_attempt_at = $3,
               lease_token = NULL,
               lease_until = NULL,
               last_error = $4,
               updated_at = $2
           WHERE event_id = $1
             AND status = 'processing'
             AND lease_token = $5`,
          [
            row.event_id,
            now,
            new Date(now.getTime() + delaySeconds * 1000),
            errorMessage(error),
            row.lease_token
          ]
        );
        if (result.rowCount !== 1) failed -= 1;
      }
    }
    return { claimed: claimed.length, published, failed };
  }

  private async claim(
    table: ClaimedEvent["table"],
    aggregateColumn: "admin_user_id" | "organization_id",
    limit: number
  ): Promise<ClaimedEvent[]> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const now = this.now();
      const result = await client.query<ClaimedEvent>(
        `WITH candidates AS (
           SELECT event_id
           FROM admin.${table}
           WHERE (status = 'pending' AND next_attempt_at <= $1)
              OR (status = 'processing' AND lease_until <= $1)
           ORDER BY created_at, event_id
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE admin.${table} outbox
         SET status = 'processing',
             attempt_count = outbox.attempt_count + 1,
             lease_token = gen_random_uuid(),
             lease_until = $1 + make_interval(secs => $3),
             updated_at = $1
         FROM candidates
         WHERE outbox.event_id = candidates.event_id
         RETURNING
           outbox.event_id,
           outbox.${aggregateColumn} AS aggregate_id,
           outbox.revision,
           outbox.event_type,
           outbox.schema_version,
           outbox.lease_token,
           outbox.attempt_count,
           outbox.payload`,
        [now, limit, this.options.leaseSeconds ?? 60]
      );
      await client.query("COMMIT");
      return result.rows.map((row) => ({ ...row, table }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private now() {
    return this.options.now?.() ?? new Date();
  }
}

export async function handler() {
  const sender = new SQSClient({ region: config.awsRegion });
  const dispatcher = new FinancialAccessOutboxDispatcher(
    getPool(),
    sender,
    config.financialSyncQueueUrl ?? "",
    {
      batchSize: config.financialAccessOutboxBatchSize,
      leaseSeconds: config.financialAccessOutboxLeaseSeconds
    }
  );
  return dispatcher.dispatch();
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2000);
}

function parseAndValidateEnvelope(row: ClaimedEvent): FinancialSyncSnapshotEvent {
  const payload = row.event_type === "admin.financial_access.snapshot"
    ? financialAccessSnapshotSchema.parse(row.payload)
    : financialOrganizationSnapshotSchema.parse(row.payload);
  if (
    payload.eventId !== row.event_id
    || payload.eventType !== row.event_type
    || payload.schemaVersion !== row.schema_version
    || payload.aggregate.id !== row.aggregate_id
    || payload.aggregate.revision !== Number(row.revision)
  ) {
    throw new Error("Financial sync outbox envelope does not match its payload.");
  }
  return payload;
}
