import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import ta02Reextracted from "../../src/lib/calls/ingest/fixtures/ta02-reextracted.json";
import { AGENTS } from "../../src/lib/calls/agents";
import { BolnaError, type BolnaExecution } from "../../src/lib/bolna/client";
import { syncAgents } from "../../src/lib/db/agents";
import { type CollectBolna, collectCalls, describeCollection, pendingCollection } from "../../src/lib/db/collect";
import { ingestExecution } from "../../src/lib/db/queries/ingest";
import { callFlags, calls } from "../../src/lib/db/schema";
import { ctx, execution, later, setup, type Tx, withPulse } from "./call-fixtures";
import { inRollback, testDb } from "./helpers";

const { db, pool } = testDb();
afterAll(() => pool.end());

const MINUTE = 60_000;

/** Registers our agents (as `pnpm agents:sync` would), so collection accepts their executions. */
async function registerAgents(tx: Tx) {
  const snapshots = new Map(AGENTS.map((a) => [a.bolnaAgentId, { id: a.bolnaAgentId }]));
  await syncAgents(tx, snapshots, { actor: "test" });
}

/** A Bolna that returns these executions (or throws these errors), and re-extracts with `reread`. */
function fakeBolna(
  executions: Record<string, BolnaExecution | Error>,
  reread: () => Promise<{ extracted_data?: BolnaExecution["extracted_data"] }> = async () => ({}),
) {
  return {
    getExecution: vi.fn(async (id: string) => {
      const e = executions[id];
      if (!e) throw new BolnaError(404, `no execution ${id}`, null);
      if (e instanceof Error) throw e;
      return e;
    }),
    testExtractions: vi.fn(async (_agentId: string, _transcript: string) => reread()),
  } satisfies CollectBolna;
}

/** A call whose execution we've heard about once (as the dialer will record it), in `status`. */
async function placed(tx: Tx, name: string, status = "in-progress", phone?: string) {
  const s = await setup(tx, { phone });
  const final = execution(name, s.callRef);
  const early = { ...final, status, updated_at: later(final, -2), extracted_data: null, transcript: null };
  await ingestExecution(tx, early, ctx(early));
  return { s, final };
}

async function callOf(tx: Tx, executionId: string) {
  const [row] = await tx.select().from(calls).where(eq(calls.executionId, executionId));
  return row!;
}

async function flagCodes(tx: Tx, callId: string) {
  return (await tx.select({ code: callFlags.code }).from(callFlags).where(eq(callFlags.callId, callId)))
    .map((f) => f.code)
    .sort();
}

describe("collectCalls", () => {
  it("fetches a call that isn't finished and stores its result", async () => {
    await inRollback(db, async (tx) => {
      await registerAgents(tx);
      const { final } = await placed(tx, "en01-completed");
      expect(await pendingCollection(tx)).toBe(1);
      const bolna = fakeBolna({ [final.id]: final });

      const summary = await collectCalls(tx, bolna);
      expect(summary).toMatchObject({ checked: 1, updated: 1, finished: 1, reextracted: 0, pending: 0, errors: [] });
      expect(await callOf(tx, final.id)).toMatchObject({
        derivedStatus: "completed",
        qaState: "auto_ok",
        answeredCount: 5,
        extractionSource: "bolna",
      });
      expect(bolna.testExtractions).not.toHaveBeenCalled();

      // A finished call with its answers is never fetched again.
      const again = await collectCalls(tx, bolna);
      expect(again.checked).toBe(0);
      expect(bolna.getExecution).toHaveBeenCalledTimes(1);
      expect(describeCollection(again)).toBe("Nothing to sync: every call is up to date.");
    });
  });

  it("keeps a call that is still going on the list", async () => {
    await inRollback(db, async (tx) => {
      await registerAgents(tx);
      const { final } = await placed(tx, "en01-completed", "ringing");
      const ringing = { ...final, status: "in-progress", updated_at: later(final, -1), extracted_data: null };
      const summary = await collectCalls(tx, fakeBolna({ [final.id]: ringing }));
      expect(summary).toMatchObject({ checked: 1, updated: 1, finished: 0, pending: 1 });
      expect(describeCollection(summary)).toBe("Checked 1 call, 1 updated, 1 still in progress.");
    });
  });

  it("one call failing doesn't stop the others", async () => {
    await inRollback(db, async (tx) => {
      await registerAgents(tx);
      const a = await placed(tx, "en01-completed", "in-progress", "+919000000011");
      const b = await placed(tx, "od01-completed", "in-progress", "+919000000012");
      const bolna = fakeBolna({ [a.final.id]: new BolnaError(500, "Bolna GET → 500: down", null), [b.final.id]: b.final });
      const summary = await collectCalls(tx, bolna);
      expect(summary).toMatchObject({ checked: 1, finished: 1, pending: 1 });
      expect(summary.errors).toEqual([{ callId: (await callOf(tx, a.final.id)).id, message: "Bolna GET → 500: down" }]);
      expect(await callOf(tx, b.final.id)).toMatchObject({ derivedStatus: "completed" });
    });
  });
});

describe("collectCalls: the extraction fallback", () => {
  /** ta02: a finished Tamil conversation whose Bolna extraction came back empty. */
  async function emptyExtraction(tx: Tx) {
    await registerAgents(tx);
    const { final } = await placed(tx, "ta02-extraction-missing");
    const endedAt = new Date(final.updated_at as string);
    return { final, endedAt };
  }

  it("waits for a late extraction first", async () => {
    await inRollback(db, async (tx) => {
      const { final, endedAt } = await emptyExtraction(tx);
      const bolna = fakeBolna({ [final.id]: final });
      const summary = await collectCalls(tx, bolna, { now: new Date(endedAt.getTime() + MINUTE) });
      expect(summary).toMatchObject({ checked: 1, finished: 1, reextracted: 0, pending: 1 });
      expect(bolna.testExtractions).not.toHaveBeenCalled();
      const call = await callOf(tx, final.id);
      expect(call).toMatchObject({ qaState: "needs_review", extractionSource: null, reextractedAt: null });
      expect(await flagCodes(tx, call.id)).toEqual(["extraction_missing"]);
    });
  });

  it("then re-reads the transcript once, and the call counts", async () => {
    await inRollback(db, async (tx) => {
      const { final, endedAt } = await emptyExtraction(tx);
      const now = new Date(endedAt.getTime() + 5 * MINUTE);
      const bolna = fakeBolna({ [final.id]: final }, async () => ta02Reextracted as never);

      const summary = await collectCalls(tx, bolna, { now });
      expect(summary).toMatchObject({ checked: 1, reextracted: 1, recovered: 1, pending: 0, errors: [] });
      expect(bolna.testExtractions).toHaveBeenCalledWith(final.agent_id, final.transcript!.trim());
      const call = await callOf(tx, final.id);
      expect(call).toMatchObject({
        derivedStatus: "completed",
        qaState: "auto_ok",
        answeredCount: 5,
        extractionSource: "reextract",
        reextractedAt: now,
        answers: { enquiries_trend: "down", bookings_week: 12, loan_rejections: "high" },
      });
      expect(call.reextractedData).toEqual(ta02Reextracted.extracted_data);
      expect(await flagCodes(tx, call.id)).toEqual(["reextracted"]);
      expect(describeCollection(summary)).toBe("Checked 1 call, 1 updated, 1 finished, 1 re-read from the transcript (1 with answers).");

      // Done: a later sync leaves it alone, and replaying Bolna's execution keeps the re-read answers.
      expect((await collectCalls(tx, bolna, { now })).checked).toBe(0);
      expect(bolna.testExtractions).toHaveBeenCalledTimes(1);
      const replay = await ingestExecution(tx, final, ctx(final));
      expect(replay.result).toBe("stale");
      expect(await callOf(tx, final.id)).toEqual(call);
    });
  });

  it("Bolna's own extraction, arriving later still, replaces the re-read answers", async () => {
    await inRollback(db, async (tx) => {
      const { final, endedAt } = await emptyExtraction(tx);
      const now = new Date(endedAt.getTime() + 5 * MINUTE);
      await collectCalls(tx, fakeBolna({ [final.id]: final }, async () => ta02Reextracted as never), { now });
      const en01 = execution("en01-completed", null);
      const late = { ...final, extracted_data: en01.extracted_data, updated_at: later(final, 10) };
      await ingestExecution(tx, late, ctx(late));
      const call = await callOf(tx, final.id);
      expect(call).toMatchObject({ extractionSource: "bolna", answers: { enquiries_trend: "same", bookings_week: 20 } });
      expect(await flagCodes(tx, call.id)).toEqual([]);
    });
  });

  it("a re-read that also comes back empty leaves the call held, and isn't repeated", async () => {
    await inRollback(db, async (tx) => {
      const { final, endedAt } = await emptyExtraction(tx);
      const now = new Date(endedAt.getTime() + 5 * MINUTE);
      const bolna = fakeBolna({ [final.id]: final }, async () => withPulse(final, null));
      const summary = await collectCalls(tx, bolna, { now });
      expect(summary).toMatchObject({ reextracted: 1, recovered: 0, pending: 0 });
      expect(describeCollection(summary)).toContain("(0 with answers, the rest held for review)");
      const call = await callOf(tx, final.id);
      expect(call).toMatchObject({ qaState: "needs_review", extractionSource: null, answers: {}, reextractedAt: now });
      expect(await flagCodes(tx, call.id)).toEqual(["extraction_missing"]);
      expect((await collectCalls(tx, bolna, { now })).checked).toBe(0);
      expect(bolna.testExtractions).toHaveBeenCalledTimes(1);
    });
  });

  it("a failed re-read is tried again on the next sync", async () => {
    await inRollback(db, async (tx) => {
      const { final, endedAt } = await emptyExtraction(tx);
      const now = new Date(endedAt.getTime() + 5 * MINUTE);
      const reread = vi
        .fn<() => Promise<{ extracted_data?: BolnaExecution["extracted_data"] }>>()
        .mockRejectedValueOnce(new BolnaError(503, "Bolna POST → 503: busy", null))
        .mockResolvedValueOnce(ta02Reextracted as never);
      const bolna = fakeBolna({ [final.id]: final }, reread);

      const first = await collectCalls(tx, bolna, { now });
      expect(first).toMatchObject({ reextracted: 0, pending: 1 });
      expect(first.errors).toHaveLength(1);
      expect((await callOf(tx, final.id)).reextractedAt).toBeNull();

      const second = await collectCalls(tx, bolna, { now: new Date(now.getTime() + MINUTE) });
      expect(second).toMatchObject({ reextracted: 1, recovered: 1, pending: 0, errors: [] });
      expect(await callOf(tx, final.id)).toMatchObject({ extractionSource: "reextract", qaState: "auto_ok" });
    });
  });
});
