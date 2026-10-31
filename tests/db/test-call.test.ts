import { count, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { AGENTS } from "../../src/lib/calls/agents";
import { createBolnaClient } from "../../src/lib/bolna/client";
import { type DialerConfig, placeTestCall, testCallPreview } from "../../src/lib/bolna/dialer";
import { syncAgents } from "../../src/lib/db/agents";
import { ingestExecution } from "../../src/lib/db/queries/ingest";
import {
  auditLog,
  callFlags,
  calls,
  dealers,
  dialerLog,
  setRecipients,
  sets,
  surveys,
  executionEvents,
} from "../../src/lib/db/schema";
import { ctx, execution, type Tx } from "./call-fixtures";
import { inRollback, testDb } from "./helpers";

const { db, pool } = testDb();
afterAll(() => pool.end());

const OWNER = "+919000012345";
const CONFIG: DialerConfig = {
  callingEnabled: true,
  scope: { mode: "testing", allowedNumbers: [OWNER] },
  capUsd: 1,
  actor: "ops",
};

/** A real client whose network is mocked, so `makeCall`'s own wall still runs and nothing is ever dialled. */
function bolnaWith(respond: () => Promise<Response>) {
  const fetch = vi.fn(respond);
  const sleep = vi.fn(async () => {});
  return {
    fetch,
    bolna: createBolnaClient({
      apiKey: "k",
      callingEnabled: true,
      scope: { mode: "testing", allowedNumbers: [OWNER] },
      fetch,
      sleep,
    }),
  };
}
const placedOk = () =>
  Promise.resolve(
    new Response(JSON.stringify({ message: "done", status: "queued", execution_id: "exec-test-1" })),
  );

async function dealer(tx: Tx, patch: Partial<typeof dealers.$inferInsert> = {}) {
  const [d] = await tx
    .insert(dealers)
    .values({
      sectorSlug: "vehicles",
      businessName: "Fixture Hero Motors",
      phoneE164: OWNER,
      cityCode: "ka-bengaluru",
      attributes: { brand: "hero", segment: "two_wheeler" },
      language: "kn",
      ...patch,
    })
    .returning({ id: dealers.id });
  return d!.id;
}

async function registerAgents(tx: Tx) {
  await syncAgents(tx, new Map(AGENTS.map((a) => [a.bolnaAgentId, { id: a.bolnaAgentId }])), {
    actor: "test",
  });
}

/** Every table a call could change, except the dialer log itself. */
async function everythingElse(tx: Tx) {
  type Counted =
    | typeof calls
    | typeof callFlags
    | typeof sets
    | typeof setRecipients
    | typeof auditLog
    | typeof executionEvents;
  const n = async (t: Counted) => (await tx.select({ n: count() }).from(t))[0]!.n;
  return {
    calls: await n(calls),
    flags: await n(callFlags),
    runs: await n(sets),
    recipients: await n(setRecipients),
    audit: await n(auditLog),
    events: await n(executionEvents),
    surveys: await tx
      .select({ id: surveys.id, frozenAt: surveys.frozenAt })
      .from(surveys)
      .orderBy(surveys.id),
    dealers: await tx.select().from(dealers).orderBy(dealers.id),
  };
}

const logRows = (tx: Tx) => tx.select().from(dialerLog).where(eq(dialerLog.action, "test_call"));

describe("placeTestCall", () => {
  it("places the call with the dealer's language agent, and changes nothing but the dialer log", async () => {
    await inRollback(db, async (tx) => {
      await registerAgents(tx);
      const id = await dealer(tx);
      const before = await everythingElse(tx);
      const { bolna, fetch } = bolnaWith(placedOk);

      expect(await placeTestCall(tx, bolna, id, CONFIG)).toEqual({
        status: "placed",
        executionId: "exec-test-1",
      });

      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.bolna.ai/call");
      expect(JSON.parse(String(init.body))).toEqual({
        agent_id: AGENTS.find((a) => a.language === "kn")!.bolnaAgentId,
        recipient_phone_number: OWNER,
        user_data: {
          dealer_name: "Fixture Hero Motors",
          brand: "Hero",
          city: "Bengaluru",
          repeat_call: "no",
        },
      });

      expect(await everythingElse(tx)).toEqual(before);
      const log = await logRows(tx);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        allowed: true,
        recipientCount: 1,
        estimatedCostCents: 18,
        httpStatus: 200,
        bolnaRef: "exec-test-1",
        actor: "ops",
      });
      expect(JSON.stringify(log[0])).not.toContain("9000012345");
    });
  });

  it("refuses with nothing sent, and logs why (never the number)", async () => {
    await inRollback(db, async (tx) => {
      await registerAgents(tx);
      const id = await dealer(tx);
      const stranger = await dealer(tx, { phoneE164: "+919876543210" });
      const { bolna, fetch } = bolnaWith(placedOk);

      const attempts: [string, DialerConfig, string][] = [
        [id, { ...CONFIG, callingEnabled: false }, "calling_off"],
        [stranger, CONFIG, "number_not_permitted"],
        ["not-a-uuid", CONFIG, "no_dealer"],
      ];
      for (const [dealerId, config] of attempts) {
        expect(await placeTestCall(tx, bolna, dealerId, config)).toMatchObject({ status: "refused" });
      }
      expect(fetch).not.toHaveBeenCalled();
      const log = await logRows(tx);
      expect(log.map((l) => l.refusalCode).sort()).toEqual(attempts.map(([, , c]) => c).sort());
      expect(log.every((l) => !l.allowed && l.estimatedCostCents === 0)).toBe(true);
      expect(JSON.stringify(log)).not.toMatch(/9000012345|9876543210/);
    });
  });

  it("refuses when no agent is synced for the language", async () => {
    await inRollback(db, async (tx) => {
      const id = await dealer(tx);
      const { bolna, fetch } = bolnaWith(placedOk);
      expect(await placeTestCall(tx, bolna, id, CONFIG)).toMatchObject({
        status: "refused",
        message: "No agent is synced for Kannada. Run pnpm agents:sync.",
      });
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  it("Bolna rejecting the call frees the estimate, and isn't retried", async () => {
    await inRollback(db, async (tx) => {
      await registerAgents(tx);
      const id = await dealer(tx);
      const { bolna, fetch } = bolnaWith(() =>
        Promise.resolve(new Response(JSON.stringify({ message: "no balance" }), { status: 503 })),
      );
      expect(await placeTestCall(tx, bolna, id, CONFIG)).toMatchObject({ status: "refused" });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [log] = await logRows(tx);
      expect(log).toMatchObject({
        allowed: false,
        refusalCode: "bolna_error",
        estimatedCostCents: 0,
        httpStatus: 503,
      });
    });
  });

  it("no answer from Bolna keeps the estimate (the call may have gone out), and isn't retried", async () => {
    await inRollback(db, async (tx) => {
      await registerAgents(tx);
      const id = await dealer(tx);
      const { bolna, fetch } = bolnaWith(() => Promise.reject(new TypeError("fetch failed")));
      expect(await placeTestCall(tx, bolna, id, CONFIG)).toMatchObject({ status: "unknown" });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [log] = await logRows(tx);
      expect(log).toMatchObject({ allowed: true, estimatedCostCents: 18 });
      expect(log!.refusalDetail).toMatch(/may have gone out/);
    });
  });

  it("counts toward the daily cap: at $1 the sixth in 24 hours is refused", async () => {
    await inRollback(db, async (tx) => {
      await registerAgents(tx);
      const id = await dealer(tx);
      const { bolna, fetch } = bolnaWith(placedOk);
      const now = new Date();
      for (let i = 0; i < 5; i++) {
        expect(await placeTestCall(tx, bolna, id, CONFIG, now)).toMatchObject({ status: "placed" });
      }
      expect(await placeTestCall(tx, bolna, id, CONFIG, now)).toMatchObject({
        status: "refused",
        message: expect.stringMatching(/daily spend cap/),
      });
      expect(fetch).toHaveBeenCalledTimes(5);
      // A day later they no longer count.
      const tomorrow = new Date(now.getTime() + 25 * 60 * 60_000);
      expect(await placeTestCall(tx, bolna, id, CONFIG, tomorrow)).toMatchObject({ status: "placed" });
    });
  });

  it("anything Bolna later reports about it stays unlinked and changes nothing", async () => {
    await inRollback(db, async (tx) => {
      await registerAgents(tx);
      await dealer(tx);
      const reported = execution("en01-completed", null);
      const before = await tx.select({ n: count() }).from(calls);
      const out = await ingestExecution(tx, reported, ctx(reported));
      expect(out).toMatchObject({ result: "unlinked", callId: null });
      expect(await tx.select({ n: count() }).from(calls)).toEqual(before);
    });
  });
});

describe("testCallPreview", () => {
  it("says who would be called and with which agent, and writes nothing", async () => {
    await inRollback(db, async (tx) => {
      await registerAgents(tx);
      const kannada = await dealer(tx);
      const hindi = await dealer(tx, { language: "hi" });
      const before = (await logRows(tx)).length;

      expect(await testCallPreview(tx, kannada, CONFIG)).toEqual({
        phone: "+91•••••2345",
        language: "Kannada",
        agentLabel: "kn01",
        tested: false,
        estimateCents: 18,
        refusal: null,
      });
      expect(await testCallPreview(tx, hindi, CONFIG)).toMatchObject({ agentLabel: "hi04", tested: true });
      expect((await testCallPreview(tx, kannada, { ...CONFIG, callingEnabled: false })).refusal).toMatch(
        /switched off/,
      );
      expect(await logRows(tx)).toHaveLength(before);
    });
  });
});

describe("the wall under it all", () => {
  it("makeCall still refuses a number outside the permitted list even if the rules were wrong", async () => {
    const { bolna, fetch } = bolnaWith(placedOk);
    await expect(bolna.makeCall({ agentId: "a", to: "+919876543210" })).rejects.toThrow(
      /NABZ_MODE=production/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
