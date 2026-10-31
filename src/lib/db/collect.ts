import { and, count, eq, exists, isNull, lt, or } from "drizzle-orm";
import type { BolnaClient } from "../bolna/client";
import { bolnaTime } from "../calls/ingest/interpret";
import { FINAL_STATUS_RANK } from "../calls/ingest/status";
import type { Db } from "./client";
import { ourAgentIds } from "./queries/agents";
import { type DbConn, ingestExecution } from "./queries/ingest";
import { callFlags, calls } from "./schema";

/**
 * Collects call results from Bolna (spec §5.3): every call that isn't finished yet is fetched
 * (`GET /executions/{id}`) and ingested. Used by the live set page, the Sync button on Ops → Calls,
 * `pnpm calls:sync` and `pnpm calls:watch`. Only reads from Bolna: nothing here can place a call.
 *
 * It also runs the extraction fallback. When Bolna's extraction of a finished conversation comes back
 * empty (it happened on a real call: its extraction step ran on nothing), we wait a few minutes for a
 * late one, then re-read the stored transcript with the same agent's own extractions
 * (`testExtractions`, free). If that comes back empty too, the call stays held for a person; nothing is
 * ever invented.
 */

/** How long after a call ends we wait for Bolna's own (late) extraction before re-reading the transcript. */
export const REEXTRACT_AFTER_MS = 3 * 60_000;

export type CollectBolna = Pick<BolnaClient, "getExecution" | "testExtractions">;

export type CollectSummary = {
  /** Calls fetched from Bolna. */
  checked: number;
  /** Fetched calls that had news (a new status, a late extraction, a re-extraction). */
  updated: number;
  /** Calls that reached a final status in this run. */
  finished: number;
  /** Calls whose transcript was re-read, and how many of those then had answers. */
  reextracted: number;
  recovered: number;
  /** Calls still to collect afterwards: not finished, or waiting for the fallback. */
  pending: number;
  /** One entry per call that failed (call id and message only: no personal data). */
  errors: { callId: string; message: string }[];
};

type Conn = DbConn & Pick<Db, "selectDistinct">;

const missingExtraction = (tx: Pick<Db, "select">) =>
  exists(
    tx
      .select({ id: callFlags.id })
      .from(callFlags)
      .where(and(eq(callFlags.callId, calls.id), eq(callFlags.code, "extraction_missing"))),
  );

/** Calls still to collect: not finished, or finished with no extraction and no fallback yet. */
function toCollect(db: Pick<Db, "select">) {
  return or(lt(calls.statusRank, FINAL_STATUS_RANK), and(missingExtraction(db), isNull(calls.reextractedAt)));
}

/** How many calls are still to collect (calls:watch stops at zero). */
export async function pendingCollection(db: Pick<Db, "select">): Promise<number> {
  const [row] = await db.select({ n: count() }).from(calls).where(toCollect(db));
  return row?.n ?? 0;
}

export async function collectCalls(
  db: Conn,
  bolna: CollectBolna,
  options: { now?: Date } = {},
): Promise<CollectSummary> {
  const now = options.now ?? new Date();
  const summary: CollectSummary = {
    checked: 0,
    updated: 0,
    finished: 0,
    reextracted: 0,
    recovered: 0,
    pending: 0,
    errors: [],
  };
  const ctx = { ourAgentIds: await ourAgentIds(db) };

  const candidates = await db
    .select({
      id: calls.id,
      executionId: calls.executionId,
      statusRank: calls.statusRank,
      bolnaStatus: calls.bolnaStatus,
      updatedAt: calls.bolnaUpdatedAt,
    })
    .from(calls)
    .where(toCollect(db))
    .orderBy(calls.initiatedAt);
  if (candidates.length === 0) {
    summary.pending = await pendingCollection(db);
    return summary;
  }

  // One call at a time: a transaction (tests) has a single connection, and Bolna has rate limits.
  for (const candidate of candidates) {
    try {
      const execution = await bolna.getExecution(candidate.executionId);
      summary.checked++;
      // Nothing new: don't fill the event log while a live set checks on its call every few seconds.
      const updatedAt = bolnaTime(execution.updated_at);
      const unchanged =
        execution.status === candidate.bolnaStatus &&
        updatedAt &&
        candidate.updatedAt &&
        candidate.updatedAt.getTime() >= updatedAt.getTime();
      if (!unchanged) {
        const result = await ingestExecution(db, execution, ctx);
        if (result.result === "rejected") throw new Error("Bolna returned an execution from an agent we don't have");
        if (result.result === "unlinked") throw new Error("Bolna's execution doesn't link to this call");
        if (result.result === "ingested") summary.updated++;
      }

      const [call] = await db
        .select({
          statusRank: calls.statusRank,
          endedAt: calls.endedAt,
          reextractedAt: calls.reextractedAt,
          missing: missingExtraction(db),
        })
        .from(calls)
        .where(eq(calls.id, candidate.id));
      if (!call) continue;
      if (candidate.statusRank < FINAL_STATUS_RANK && call.statusRank === FINAL_STATUS_RANK) summary.finished++;

      const transcript = typeof execution.transcript === "string" ? execution.transcript.trim() : "";
      const due = call.endedAt !== null && now.getTime() - call.endedAt.getTime() >= REEXTRACT_AFTER_MS;
      if (!call.missing || call.reextractedAt !== null || !due || !transcript) continue;

      // Claim the call first, so two syncs running at once never both re-read it.
      const claimed = await db
        .update(calls)
        .set({ reextractedAt: now })
        .where(and(eq(calls.id, candidate.id), isNull(calls.reextractedAt)))
        .returning({ id: calls.id });
      if (claimed.length === 0) continue;

      let data: Record<string, unknown>;
      try {
        const reread = await bolna.testExtractions(execution.agent_id, transcript);
        data = (reread.extracted_data ?? {}) as Record<string, unknown>;
      } catch (error) {
        // Release the claim: the next sync tries again.
        await db.update(calls).set({ reextractedAt: null }).where(eq(calls.id, candidate.id));
        throw error;
      }
      await ingestExecution(db, execution, { ...ctx, reextracted: { data, at: now } });
      summary.reextracted++;
      const [after] = await db
        .select({ source: calls.extractionSource })
        .from(calls)
        .where(eq(calls.id, candidate.id));
      if (after?.source === "reextract") summary.recovered++;
    } catch (error) {
      summary.errors.push({ callId: candidate.id, message: error instanceof Error ? error.message : String(error) });
    }
  }

  summary.pending = await pendingCollection(db);
  return summary;
}

/** The summary in a sentence, for the Sync button and the scripts. */
export function describeCollection(s: CollectSummary): string {
  if (s.checked === 0 && s.errors.length === 0) {
    return s.pending > 0 ? "No news yet: calls are still in progress." : "Nothing to sync: every call is up to date.";
  }
  const parts = [`Checked ${s.checked} call${s.checked === 1 ? "" : "s"}`];
  if (s.updated) parts.push(`${s.updated} updated`);
  if (s.finished) parts.push(`${s.finished} finished`);
  if (s.reextracted) {
    parts.push(
      `${s.reextracted} re-read from the transcript (${s.recovered} with answers${s.recovered < s.reextracted ? ", the rest held for review" : ""})`,
    );
  }
  if (s.pending) parts.push(`${s.pending} still in progress`);
  if (s.errors.length) parts.push(`${s.errors.length} failed`);
  return `${parts.join(", ")}.`;
}
