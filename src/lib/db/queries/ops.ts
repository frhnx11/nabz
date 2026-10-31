import { count } from "drizzle-orm";
import type { Db } from "../client";
import { batches, calls, dealers, sets } from "../schema";

/** Total rows in the main tables, across all data. */
export async function dataTotals(db: Db) {
  const [r] = await db.select({ n: count() }).from(dealers);
  const [b] = await db.select({ n: count() }).from(batches);
  const [u] = await db.select({ n: count() }).from(sets);
  const [c] = await db.select({ n: count() }).from(calls);
  return { dealers: r?.n ?? 0, batches: b?.n ?? 0, sets: u?.n ?? 0, calls: c?.n ?? 0 };
}
