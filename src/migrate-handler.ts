import type { Context } from "aws-lambda";
import { runMigrations } from "./migrate.js";

export async function handler(_event: unknown, _context: Context) {
  await runMigrations();
  return { ok: true };
}
