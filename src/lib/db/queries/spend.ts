import { and, eq, gte, sql, sum } from "drizzle-orm";
import type { Db } from "../client";
import { calls, dialerLog } from "../schema";

/**
 * What Bolna has charged in the 24 hours before `now`, for the daily spend cap (US cents): calls'
 * cost, plus each test call's estimate (they have no call row, so no real cost).
 */
export async function spentLast24hCents(db: Pick<Db, "select">, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60_000);
  const [made] = await db
    .select({ cents: sum(calls.costCents) })
    .from(calls)
    .where(gte(sql`coalesce(${calls.endedAt}, ${calls.initiatedAt})`, since));
  const [tests] = await db
    .select({ cents: sum(dialerLog.estimatedCostCents) })
    .from(dialerLog)
    .where(and(eq(dialerLog.action, "test_call"), eq(dialerLog.allowed, true), gte(dialerLog.at, since)));
  return Number(made?.cents ?? 0) + Number(tests?.cents ?? 0);
}
