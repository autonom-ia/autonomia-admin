import { z } from "zod";
import { getPool } from "./db.js";
import { reconcileFinancialSyncSnapshots } from "./financial-access-outbox.js";

const requestSchema = z.object({
  reconciliationKey: z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/),
  batchSize: z.number().int().min(1).max(500).optional()
}).strict();

export async function handler(input: unknown) {
  const request = requestSchema.parse(input);
  return reconcileFinancialSyncSnapshots(
    getPool(),
    request.reconciliationKey,
    request.batchSize
  );
}
