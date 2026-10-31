import { and, eq, isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { AGENTS, type AgentEntry } from "../../src/lib/calls/agents";
import { syncAgents } from "../../src/lib/db/agents";
import { currentAgent, listAgents, ourAgentIds } from "../../src/lib/db/queries/agents";
import { agentVersions, auditLog } from "../../src/lib/db/schema";
import { expectFailure, inRollback, latestSurveyId, testDb } from "./helpers";

const { db, pool } = testDb();
afterAll(() => pool.end());

const NOW = new Date("2026-10-30T10:00:00Z");
const LATER = new Date("2026-10-31T10:00:00Z");

/** What Bolna's GET /v2/agent/{id} returns, cut down. */
function snapshotsFor(agents: readonly AgentEntry[], prompt = "Ask six questions.") {
  return new Map(
    agents.map((a) => [
      a.bolnaAgentId,
      {
        id: a.bolnaAgentId,
        agent_name: `Nabz lab ${a.label}`,
        agent_prompts: { task_1: { system_prompt: `${prompt} (${a.language})` } },
        agent_status: "processed",
        updated_at: "2026-10-28T21:44:16.553018",
      },
    ]),
  );
}

describe("syncAgents", () => {
  it("registers one current agent per language, with its Bolna configuration", async () => {
    await inRollback(db, async (tx) => {
      const results = await syncAgents(tx, snapshotsFor(AGENTS), { now: NOW, actor: "test" });
      expect(results).toHaveLength(12);
      expect(results.every((r) => r.endsWith(": created"))).toBe(true);

      const rows = await listAgents(tx);
      expect(rows).toHaveLength(12);
      const hi = rows.find((r) => r.language === "hi");
      expect(hi).toMatchObject({ label: "hi04", version: 1, surveySlug: "vehicle_pulse", surveyVersion: 2 });

      const [stored] = await tx.select().from(agentVersions).where(eq(agentVersions.label, "od01"));
      expect(stored).toMatchObject({ language: "or", syncedBy: "test", retiredAt: null });
      expect(stored!.config).toMatchObject({
        entry: { label: "od01", language: "or" },
        agent: { agent_prompts: { task_1: { system_prompt: "Ask six questions. (or)" } } },
      });
      expect(stored!.config.agent).not.toHaveProperty("updated_at");

      const surveyId = await latestSurveyId(tx);
      expect(await currentAgent(tx, surveyId, "ta")).toMatchObject({ label: "ta02", bolnaAgentId: AGENTS[2]!.bolnaAgentId });
    });
  });

  it("re-syncing an unchanged registry changes nothing", async () => {
    await inRollback(db, async (tx) => {
      await syncAgents(tx, snapshotsFor(AGENTS), { now: NOW, actor: "test" });
      const rows = await tx.select().from(agentVersions);
      const audits = await tx.select().from(auditLog).where(eq(auditLog.action, "agent.sync"));
      // Bolna's status and save time moving on isn't a change.
      const moved = new Map([...snapshotsFor(AGENTS)].map(([id, s]) => [id, { ...s, updated_at: "2026-10-30T09:00:00" }]));
      const results = await syncAgents(tx, moved, { now: LATER, actor: "test" });
      expect(results.every((r) => r.endsWith(": unchanged"))).toBe(true);
      expect(await tx.select().from(agentVersions)).toEqual(rows);
      expect(await tx.select().from(auditLog).where(eq(auditLog.action, "agent.sync"))).toHaveLength(audits.length);
    });
  });

  it("an agent edited in Bolna becomes a new version; the old one is retired, not deleted", async () => {
    await inRollback(db, async (tx) => {
      await syncAgents(tx, snapshotsFor(AGENTS), { now: NOW, actor: "test" });
      const results = await syncAgents(tx, snapshotsFor(AGENTS, "Ask seven questions."), { now: LATER, actor: "test" });
      expect(results.filter((r) => r.includes("new version 2"))).toHaveLength(12);
      const hiRows = await tx.select().from(agentVersions).where(eq(agentVersions.language, "hi"));
      expect(hiRows.map((r) => [r.version, r.retiredAt?.toISOString() ?? null]).toSorted()).toEqual([
        [1, LATER.toISOString()],
        [2, null],
      ]);
    });
  });

  it("a new lab version for a language replaces the old agent", async () => {
    await inRollback(db, async (tx) => {
      await syncAgents(tx, snapshotsFor(AGENTS), { now: NOW, actor: "test" });
      const hi05: AgentEntry = {
        ...AGENTS.find((a) => a.language === "hi")!,
        label: "hi05",
        bolnaAgentId: "11111111-2222-4333-8444-555555555555",
      };
      const agents = AGENTS.map((a) => (a.language === "hi" ? hi05 : a));
      const results = await syncAgents(tx, snapshotsFor(agents), { now: LATER, actor: "test", agents });
      expect(results).toContain("vehicle_pulse v2 hi (hi05): now current, replaces hi04");
      expect(results.filter((r) => r.endsWith(": unchanged"))).toHaveLength(11);

      const surveyId = await latestSurveyId(tx);
      expect(await currentAgent(tx, surveyId, "hi")).toMatchObject({ label: "hi05", version: 1 });
      // Late events from the old agent are still ours.
      const ours = await ourAgentIds(tx);
      expect(ours.has(hi05.bolnaAgentId)).toBe(true);
      expect(ours.has(AGENTS.find((a) => a.language === "hi")!.bolnaAgentId)).toBe(true);
      const audit = await tx.select().from(auditLog).where(eq(auditLog.action, "agent.sync"));
      expect(audit.at(-1)).toMatchObject({ before: { label: "hi04" }, after: { label: "hi05" } });
    });
  });

  it("retires the agents of a survey dropped from the registry", async () => {
    await inRollback(db, async (tx) => {
      await syncAgents(tx, snapshotsFor(AGENTS), { now: NOW, actor: "test" });
      const results = await syncAgents(tx, new Map(), { now: LATER, actor: "test", agents: [] });
      expect(results).toHaveLength(12);
      expect(await listAgents(tx)).toEqual([]);
      expect(await tx.select().from(agentVersions)).toHaveLength(12);
    });
  });

  it("refuses an invalid registry, a missing snapshot, or a survey that isn't synced", async () => {
    await inRollback(db, async (tx) => {
      await expect(syncAgents(tx, snapshotsFor(AGENTS), { actor: "test", agents: AGENTS.slice(1) })).rejects.toThrow(
        /no agent for en/,
      );
      const missing = snapshotsFor(AGENTS);
      missing.delete(AGENTS[0]!.bolnaAgentId);
      await expect(syncAgents(tx, missing, { actor: "test" })).rejects.toThrow(/No Bolna snapshot for en01/);
      expect(await tx.select().from(agentVersions)).toEqual([]);
    });
  });

  it("the database allows only one current agent per survey and language", async () => {
    await inRollback(db, async (tx) => {
      await syncAgents(tx, snapshotsFor(AGENTS), { now: NOW, actor: "test" });
      const [hi] = await tx
        .select()
        .from(agentVersions)
        .where(and(eq(agentVersions.language, "hi"), isNull(agentVersions.retiredAt)));
      const { id: _id, ...copy } = hi!;
      const failure = await expectFailure(tx, (sp) =>
        sp.insert(agentVersions).values({ ...copy, bolnaAgentId: "11111111-2222-4333-8444-555555555555" }),
      );
      expect(failure.constraint).toBe("agent_versions_current_uq");
      const bad = await expectFailure(tx, (sp) =>
        sp.insert(agentVersions).values({ ...copy, language: "ur" as "hi", retiredAt: NOW, version: 9 }),
      );
      expect(bad.constraint).toBe("agent_versions_language_ck");
    });
  });
});
