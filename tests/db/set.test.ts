import { count, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { type BolnaExecution, createBolnaClient } from "../../src/lib/bolna/client";
import type { DialerConfig } from "../../src/lib/bolna/dialer";
import { advanceSet, setPreview, startSet, stopSet } from "../../src/lib/bolna/set-dialer";
import { AGENTS } from "../../src/lib/calls/agents";
import { syncAgents } from "../../src/lib/db/agents";
import type { Db } from "../../src/lib/db/client";
import { getCallDetail, listCalls } from "../../src/lib/db/queries/calls";
import { loadIndexInputs } from "../../src/lib/db/queries/index-data";
import { listSets, setDetail } from "../../src/lib/db/queries/sets";
import {
  agentVersions,
  auditLog,
  batches,
  batchMembers,
  calls,
  dealers,
  dialerLog,
  setRecipients,
  sets,
} from "../../src/lib/db/schema";
import { execution, type Tx, WEEK } from "./call-fixtures";
import { inRollback, testDb } from "./helpers";

const { db, pool } = testDb();
afterAll(() => pool.end());

const OWNER = "+919000012345";
const NOW = new Date("2026-10-30T06:30:00Z");
const CONFIG: DialerConfig = {
  callingEnabled: true,
  scope: { mode: "testing", allowedNumbers: [OWNER] },
  capUsd: 10,
  actor: "ops",
};
const agentId = (language: string) => AGENTS.find((a) => a.language === language)!.bolnaAgentId;

/** A real client over a mocked network: its walls still run, and nothing can dial. */
function mockBolna(place: () => Response | Error | null = () => null) {
  const dialled: { agent_id: string; recipient_phone_number: string; user_data: Record<string, string> }[] =
    [];
  const executions = new Map<string, BolnaExecution>();
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace("https://api.bolna.ai", "");
    if (path === "/call") {
      const failure = place();
      if (failure instanceof Error) throw failure;
      if (failure) return failure;
      dialled.push(JSON.parse(String(init!.body)));
      return Response.json({ message: "done", status: "queued", execution_id: `exec-${dialled.length}` });
    }
    const id = path.match(/^\/executions\/(.+)$/)?.[1];
    if (id) {
      const e = executions.get(id);
      if (e) return Response.json(e);
      return Response.json({
        id,
        agent_id: agentId("hi"),
        status: "ringing",
        updated_at: "2026-10-30T06:30:05+00:00",
      });
    }
    throw new Error(`unexpected ${path}`);
  });
  const bolna = createBolnaClient({
    apiKey: "k",
    callingEnabled: true,
    scope: CONFIG.scope,
    fetch: fetch as typeof globalThis.fetch,
    sleep: async () => {},
  });
  /** Bolna reports call number `n` (1-based) as finished, from a real execution. */
  const finish = (n: number, name = "en01-completed", patch: Partial<BolnaExecution> = {}) => {
    const ref = dialled[n - 1]!.user_data.nabz_call_ref!;
    executions.set(`exec-${n}`, execution(name, ref, { id: `exec-${n}`, ...patch }));
  };
  return { bolna, fetch, dialled, finish };
}

async function dealer(tx: Tx, name: string, language = "hi", phone = OWNER) {
  const [d] = await tx
    .insert(dealers)
    .values({
      sectorSlug: "vehicles",
      businessName: name,
      phoneE164: phone,
      cityCode: "ka-bengaluru",
      attributes: { brand: "hero", segment: "two_wheeler" },
      language,
    })
    .returning({ id: dealers.id });
  return d!.id;
}

async function batchOf(tx: Tx, ids: string[]) {
  const [b] = await tx
    .insert(batches)
    .values({ sectorSlug: "vehicles", name: `Set fixture ${Math.random()}`, createdBy: "test" })
    .returning({ id: batches.id });
  for (const dealerId of ids) await tx.insert(batchMembers).values({ batchId: b!.id, dealerId });
  return b!.id;
}

async function setup(tx: Tx) {
  await syncAgents(tx, new Map(AGENTS.map((a) => [a.bolnaAgentId, { id: a.bolnaAgentId }])), {
    actor: "test",
  });
}

async function started(tx: Tx, batchId: string, config = CONFIG) {
  const result = await startSet(tx, batchId, config, NOW);
  if (result.status !== "started") throw new Error(result.message);
  return result.setId;
}

const statusOf = async (tx: Tx, id: string) => (await tx.select().from(sets).where(eq(sets.id, id)))[0]!;
const rowsOf = async (tx: Tx, id: string) => (await setDetail(tx as unknown as Db, id))!.rows;

describe("a set calls one row at a time", () => {
  it("goes down the batch in order, waits for each call, and highlights the one being called", async () => {
    await inRollback(db, async (tx) => {
      await setup(tx);
      const [b, a] = [await dealer(tx, "B Hero"), await dealer(tx, "A Hero")];
      const setId = await started(tx, await batchOf(tx, [b, a]));
      const m = mockBolna();

      // Starting dials nothing: the live page's first step does.
      expect(m.dialled).toHaveLength(0);
      expect((await rowsOf(tx, setId)).map((r) => [r.name, r.state])).toEqual([
        ["A Hero", "waiting"],
        ["B Hero", "waiting"],
      ]);

      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);
      expect(m.dialled.map((d) => d.user_data.dealer_name)).toEqual(["A Hero"]);
      expect((await rowsOf(tx, setId)).map((r) => r.state)).toEqual(["calling", "waiting"]);

      // Steps while it rings dial nothing.
      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);
      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);
      expect(m.dialled).toHaveLength(1);

      // It ends: the highlight moves on, and shares a number without trouble.
      m.finish(1);
      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);
      expect(m.dialled.map((d) => d.user_data.dealer_name)).toEqual(["A Hero", "B Hero"]);
      expect((await rowsOf(tx, setId)).map((r) => [r.state, r.label])).toEqual([
        ["done", "Completed"],
        ["calling", "Calling…"],
      ]);

      m.finish(2);
      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);
      expect(m.dialled).toHaveLength(2);
      expect((await statusOf(tx, setId)).status).toBe("completed");

      // A finished set never dials again.
      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);
      expect(m.dialled).toHaveLength(2);
    });
  });

  it("uses each dealer's language agent, recorded on the call, and sends what links the call back", async () => {
    await inRollback(db, async (tx) => {
      await setup(tx);
      const id = await dealer(tx, "Kaveri Hero", "kn");
      const setId = await started(tx, await batchOf(tx, [id]));
      const m = mockBolna();
      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);

      expect(m.dialled[0]).toMatchObject({
        agent_id: agentId("kn"),
        recipient_phone_number: OWNER,
        user_data: {
          dealer_name: "Kaveri Hero",
          brand: "Hero",
          city: "Bengaluru",
          repeat_call: "no",
          nabz_dealer_id: id,
        },
      });
      const [recipient] = await tx.select().from(setRecipients).where(eq(setRecipients.dealerId, id));
      expect(m.dialled[0]!.user_data.nabz_call_ref).toBe(recipient!.callRef);
      const [call] = await tx.select().from(calls).where(eq(calls.executionId, "exec-1"));
      const [kn01] = await tx.select().from(agentVersions).where(eq(agentVersions.label, "kn01"));
      expect(call).toMatchObject({
        agentVersionId: kn01!.id,
        setId: setId,
        derivedStatus: "queued",
        weekStart: WEEK,
      });
    });
  });

  it("an agent's opted_out on one row doesn't stop the later rows on that number", async () => {
    await inRollback(db, async (tx) => {
      await setup(tx);
      const ids = [await dealer(tx, "A Hero"), await dealer(tx, "B Hero")];
      const setId = await started(tx, await batchOf(tx, ids));
      const m = mockBolna();
      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);

      const e = execution("en01-completed", null);
      const pulse = (e.extracted_data as { Pulse: object }).Pulse;
      m.finish(1, "en01-completed", {
        extracted_data: { Pulse: { ...pulse, outcome: { objective: "opted_out", confidence: 0.9 } } },
      } as Partial<BolnaExecution>);
      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);

      expect(m.dialled.map((d) => d.user_data.dealer_name)).toEqual(["A Hero", "B Hero"]);
      expect((await rowsOf(tx, setId)).map((r) => r.state)).toEqual(["done", "calling"]);
    });
  });

  it("stops at the spend cap and says why", async () => {
    await inRollback(db, async (tx) => {
      await setup(tx);
      const setId = await started(
        tx,
        await batchOf(tx, [await dealer(tx, "A Hero"), await dealer(tx, "B Hero")]),
      );
      const m = mockBolna();
      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);
      m.finish(1, "en01-completed", { total_cost: 95, updated_at: NOW.toISOString() });
      await advanceSet(tx, m.bolna, setId, { ...CONFIG, capUsd: 1 }, NOW);
      expect(m.dialled).toHaveLength(1);
      const run = await statusOf(tx, setId);
      expect(run).toMatchObject({ status: "stopped" });
      expect(run.stopReason).toMatch(/daily spend cap/);
    });
  });

  it("stops if calling is switched off mid-set", async () => {
    await inRollback(db, async (tx) => {
      await setup(tx);
      const setId = await started(tx, await batchOf(tx, [await dealer(tx, "A Hero")]));
      const m = mockBolna();
      await advanceSet(tx, m.bolna, setId, { ...CONFIG, callingEnabled: false }, NOW);
      expect(m.dialled).toHaveLength(0);
      expect((await statusOf(tx, setId)).stopReason).toMatch(/switched off/);
    });
  });

  it("Bolna refusing a row moves on, never redials, and isn't retried", async () => {
    await inRollback(db, async (tx) => {
      await setup(tx);
      const setId = await started(
        tx,
        await batchOf(tx, [await dealer(tx, "A Hero"), await dealer(tx, "B Hero")]),
      );
      let first = true;
      const m = mockBolna(() => {
        if (!first) return null;
        first = false;
        return Response.json({ message: "no" }, { status: 503 });
      });
      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);
      expect(m.fetch.mock.calls.filter(([u]) => String(u).endsWith("/call"))).toHaveLength(1);
      expect((await rowsOf(tx, setId)).map((r) => r.state)).toEqual(["failed", "waiting"]);

      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);
      expect(m.dialled.map((d) => d.user_data.dealer_name)).toEqual(["B Hero"]);
      const log = await tx.select().from(dialerLog).where(eq(dialerLog.setId, setId));
      expect(log.map((l) => l.refusalCode).sort()).toEqual(["bolna_error", null].sort());
      expect(JSON.stringify(log)).not.toContain("9000012345");
    });
  });

  it("no answer from Bolna isn't redialled either: the call may have gone out", async () => {
    await inRollback(db, async (tx) => {
      await setup(tx);
      const setId = await started(tx, await batchOf(tx, [await dealer(tx, "A Hero")]));
      const m = mockBolna(() => new TypeError("fetch failed"));
      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);
      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);
      expect(m.fetch.mock.calls.filter(([u]) => String(u).endsWith("/call"))).toHaveLength(1);
      expect((await statusOf(tx, setId)).status).toBe("completed");
    });
  });

  it("Stop means no further calls, audited; the call in progress can still report", async () => {
    await inRollback(db, async (tx) => {
      await setup(tx);
      const setId = await started(
        tx,
        await batchOf(tx, [await dealer(tx, "A Hero"), await dealer(tx, "B Hero")]),
      );
      const m = mockBolna();
      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);
      await stopSet(tx, setId, { actor: "ops" });
      m.finish(1);
      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);

      expect(m.dialled).toHaveLength(1);
      const rows = await rowsOf(tx, setId);
      expect(rows.map((r) => r.state)).toEqual(["done", "not_called"]);
      expect((await statusOf(tx, setId)).stopReason).toBe("Stopped by ops.");
      expect(await tx.select({ n: count() }).from(auditLog).where(eq(auditLog.action, "set.stop"))).toEqual([
        { n: 1 },
      ]);
    });
  });
});

describe("starting a set", () => {
  it("previews without writing, and refuses when calling is off, or another set is going", async () => {
    await inRollback(db, async (tx) => {
      await setup(tx);
      const batchId = await batchOf(tx, [await dealer(tx, "A Hero")]);
      const preview = await setPreview(tx, batchId, CONFIG, NOW);
      expect(preview?.plan).toMatchObject({ refusal: null, callCount: 1, estimateCents: 18 });
      expect(await tx.select({ n: count() }).from(sets).where(eq(sets.batchId, batchId))).toEqual([{ n: 0 }]);

      expect(await startSet(tx, batchId, { ...CONFIG, callingEnabled: false }, NOW)).toMatchObject({
        status: "refused",
      });
      expect(await tx.select({ n: count() }).from(sets).where(eq(sets.batchId, batchId))).toEqual([{ n: 0 }]);

      await started(tx, batchId);
      const other = await batchOf(tx, [await dealer(tx, "B Hero")]);
      expect(await startSet(tx, other, CONFIG, NOW)).toMatchObject({
        status: "refused",
        message: expect.stringMatching(/Another set/),
      });
    });
  });
});

describe("running a batch again", () => {
  /** Runs a one-dealer set through one call and returns it. */
  async function oneCall(tx: Tx, batchId: string, name: string, patch: Partial<BolnaExecution>, id: string) {
    const setId = await started(tx, batchId);
    const m = mockBolna();
    await advanceSet(tx, m.bolna, setId, CONFIG, NOW);
    const ref = m.dialled[0]!.user_data.nabz_call_ref!;
    // Execution ids must differ between sets: rename the mock's call to this one.
    await tx.update(calls).set({ executionId: id }).where(eq(calls.executionId, "exec-1"));
    m.fetch.mockImplementation(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith(`/executions/${id}`)) return Response.json(execution(name, ref, { id, ...patch }));
      throw new Error(`unexpected ${path}`);
    });
    await advanceSet(tx, m.bolna, setId, CONFIG, NOW);
    return setId;
  }

  it("makes a second set, calls everyone again, and the newest good call replaces the old in the index", async () => {
    await inRollback(db, async (tx) => {
      await setup(tx);
      const id = await dealer(tx, "A Hero");
      const batchId = await batchOf(tx, [id]);
      // Second call has fewer answers (4 of 5): it still wins, because it's newer.
      const first = await oneCall(
        tx,
        batchId,
        "en01-completed",
        { updated_at: "2026-10-30T06:40:00+00:00" },
        "first-call",
      );
      const second = await oneCall(
        tx,
        batchId,
        "hi04-owner-stock-unclear",
        { updated_at: "2026-10-30T07:40:00+00:00" },
        "second-call",
      );
      expect(first).not.toBe(second);

      const inputs = await loadIndexInputs(tx as unknown as Db, {
        surveySlug: "vehicle_pulse",
        fromWeek: WEEK,
      });
      const mine = inputs!.calls.filter((c) => c.dealerId === id);
      expect(mine).toHaveLength(2);

      const { rows } = await listCalls(tx as unknown as Db, { page: 1, setId: first });
      expect(rows.map((r) => [r.id !== undefined, r.replaced])).toEqual([[true, true]]);
      const newer = await listCalls(tx as unknown as Db, { page: 1, setId: second });
      expect(newer.rows[0]!.replaced).toBe(false);
      expect((await getCallDetail(tx as unknown as Db, rows[0]!.id))!.replaced).toBe(true);
    });
  });

  it("a newer call that didn't get answers replaces nothing", async () => {
    await inRollback(db, async (tx) => {
      await setup(tx);
      const batchId = await batchOf(tx, [await dealer(tx, "A Hero")]);
      const first = await oneCall(
        tx,
        batchId,
        "en01-completed",
        { updated_at: "2026-10-30T06:40:00+00:00" },
        "first-call",
      );
      await oneCall(
        tx,
        batchId,
        "en01-completed",
        {
          status: "no-answer",
          conversation_duration: 0,
          transcript: null,
          updated_at: "2026-10-30T07:40:00+00:00",
        },
        "second-call",
      );
      const { rows } = await listCalls(tx as unknown as Db, { page: 1, setId: first });
      expect(rows[0]!.replaced).toBe(false);
    });
  });
});

describe("listSets", () => {
  it("shows each run of a batch, with progress", async () => {
    await inRollback(db, async (tx) => {
      await setup(tx);
      const batchId = await batchOf(tx, [await dealer(tx, "A Hero"), await dealer(tx, "B Hero")]);
      const setId = await started(tx, batchId);
      const m = mockBolna();
      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);
      m.finish(1);
      await advanceSet(tx, m.bolna, setId, CONFIG, NOW);

      const { rows } = await listSets(tx as unknown as Db, { page: 1 });
      const mine = rows.find((r) => r.id === setId)!;
      expect(mine).toMatchObject({ status: "running", total: 2, done: 1, answered: 1 });
      expect(mine.batchName).toMatch(/Set fixture/);
      expect(mine.costCents).toBeGreaterThan(0);
    });
  });
});
