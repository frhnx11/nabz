import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AGENTS } from "../calls/agents";
import { type AgentDefinition, createMissingAgents, withAgentIds } from "./agent-setup";

const definition = (label: string): AgentDefinition => ({
  label,
  name: `Agent ${label}`,
  body: { agent_config: { agent_name: `Agent ${label}` } },
  dispositions: [{ name: "x", question: "y" }],
});

function fakeBolna(existing: { id: string; agent_name: string }[] = []) {
  return {
    agents: vi.fn(async () => existing),
    createAgent: vi.fn(async (body: unknown) => ({
      agent_id: `new-${(body as { agent_config: { agent_name: string } }).agent_config.agent_name}`,
      state: "created",
    })),
    createDispositions: vi.fn(async () => ({ message: "ok", ids: [] as string[] })),
  };
}

describe("createMissingAgents", () => {
  it("creates each agent with its extractions, and returns the ids", async () => {
    const bolna = fakeBolna();
    await expect(createMissingAgents(bolna, [definition("en01")])).resolves.toEqual({ en01: "new-Agent en01" });
    expect(bolna.createDispositions).toHaveBeenCalledWith("new-Agent en01", definition("en01").dispositions);
  });

  it("is safe to run again: an agent with the same name is kept, not created twice", async () => {
    const bolna = fakeBolna([{ id: "old", agent_name: "Agent en01" }]);
    await expect(createMissingAgents(bolna, [definition("en01")])).resolves.toEqual({ en01: "old" });
    expect(bolna.createAgent).not.toHaveBeenCalled();
  });

  it("says what to clean up when extractions fail", async () => {
    const bolna = fakeBolna();
    bolna.createDispositions.mockRejectedValueOnce(new Error("Bolna 500"));
    await expect(createMissingAgents(bolna, [definition("en01")])).rejects.toThrow(/Delete "Agent en01"/);
  });
});

describe("withAgentIds", () => {
  it("replaces the ids it has and keeps the rest", () => {
    const merged = withAgentIds(AGENTS, { en01: "11111111-1111-4111-8111-111111111111" });
    expect(merged.find((a) => a.label === "en01")!.bolnaAgentId).toBe("11111111-1111-4111-8111-111111111111");
    expect(merged.find((a) => a.label === "hi04")!.bolnaAgentId).toBe(AGENTS.find((a) => a.label === "hi04")!.bolnaAgentId);
  });
});

describe("the agent definitions in the repo", () => {
  const folder = resolve(process.cwd(), "agents/definitions");
  const files = readdirSync(folder);
  const read = (file: string) => readFileSync(resolve(folder, file), "utf8");

  it("cover every registered agent", () => {
    expect(files.map((f) => f.replace(".json", "")).toSorted()).toEqual(AGENTS.map((a) => a.label).toSorted());
  });

  it("name each agent the way Bolna will list it", () => {
    for (const file of files) {
      const d = JSON.parse(read(file)) as AgentDefinition & { body: { agent_config: { agent_name: string } } };
      expect(d.body.agent_config.agent_name).toBe(d.name);
      expect(d.dispositions.length).toBeGreaterThan(0);
    }
  });

  it("hold no phone numbers", () => {
    for (const file of files) expect(read(file)).not.toMatch(/\+91\d{10}/);
  });
});
