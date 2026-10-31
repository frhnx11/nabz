import { describe, expect, it } from "vitest";
import { CALL_LANGUAGE_CODES } from "../reference/languages";
import { AGENTS, type AgentEntry, agentConfig, agentFor, validateAgents } from "./agents";

const V2 = { slug: "vehicle_pulse", version: 2 };

describe("the agent registry", () => {
  it("is valid: one agent per call language for survey v2", () => {
    expect(validateAgents()).toEqual([]);
    expect(AGENTS.map((a) => a.language).toSorted()).toEqual([...CALL_LANGUAGE_CODES].toSorted());
  });

  it("marks the four agents that have had a real call as tested", () => {
    expect(AGENTS.filter((a) => a.tested).map((a) => a.label)).toEqual(["en01", "hi04", "ta02", "od01"]);
  });

  it("finds the agent for a language", () => {
    expect(agentFor("hi", V2)?.label).toBe("hi04");
    expect(agentFor("or", V2)?.label).toBe("od01");
    expect(agentFor("ur", V2)).toBeNull();
    expect(agentFor("hi", { slug: "vehicle_pulse", version: 1 })).toBeNull();
  });

  it("reports what's wrong with a broken registry", () => {
    const hi = AGENTS.find((a) => a.language === "hi")!;
    const broken: AgentEntry[] = [
      ...AGENTS.filter((a) => a.language !== "ta"),
      { ...hi, label: "hi05" },
      { ...hi, language: "kn", label: "x", bolnaAgentId: "not-a-uuid", survey: { slug: "vehicle_pulse", version: 9 } },
    ];
    const problems = validateAgents(broken);
    expect(problems).toEqual(
      expect.arrayContaining([
        "hi05: agent 017e390a-7737-454d-9edd-861588cda64c is listed twice",
        "vehicle_pulse v2: two agents for hi",
        "vehicle_pulse v2: no agent for ta",
        "x: unknown survey vehicle_pulse v9",
        "x: agent id is not a UUID",
      ]),
    );
  });
});

describe("agentConfig", () => {
  const entry = AGENTS[0]!;
  const snapshot = {
    id: entry.bolnaAgentId,
    agent_prompts: { task_1: { system_prompt: "Ask six questions." } },
    agent_status: "processed",
    updated_at: "2026-10-28T21:44:16.553018",
  };

  it("ignores what changes without the agent changing", () => {
    const a = agentConfig(entry, snapshot);
    const b = agentConfig(entry, { ...snapshot, agent_status: "processing", updated_at: "2026-10-30T10:00:00" });
    expect(b.sha256).toBe(a.sha256);
    expect(a.config.agent).not.toHaveProperty("updated_at");
    expect(agentConfig({ ...entry, tested: !entry.tested }, snapshot).sha256).toBe(a.sha256);
  });

  it("changes when the agent or our entry changes", () => {
    const a = agentConfig(entry, snapshot);
    const prompt = { ...snapshot, agent_prompts: { task_1: { system_prompt: "Ask seven questions." } } };
    expect(agentConfig(entry, prompt).sha256).not.toBe(a.sha256);
    expect(agentConfig({ ...entry, label: "en02" }, snapshot).sha256).not.toBe(a.sha256);
  });
});
