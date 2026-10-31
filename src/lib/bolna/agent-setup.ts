import type { AgentEntry } from "../calls/agents";
import type { BolnaClient, BolnaDisposition } from "./client";

/**
 * Creating the call agents in a Bolna account (`pnpm agents:create`), so someone with their own key can
 * run calls. The definitions in `agents/definitions/` are exported from the call lab. Creating an agent
 * places no call.
 */

export type AgentDefinition = {
  label: string;
  name: string;
  body: unknown;
  dispositions: BolnaDisposition[];
};

/** Label → Bolna agent id: the contents of `agents.local.json`. */
export type AgentIds = Record<string, string>;

/**
 * Creates every agent the account doesn't already have (matched by name, so it's safe to run again).
 * `onProgress` hears each result as it happens.
 */
export async function createMissingAgents(
  bolna: Pick<BolnaClient, "agents" | "createAgent" | "createDispositions">,
  definitions: readonly AgentDefinition[],
  onProgress: (line: string) => void = () => {},
): Promise<AgentIds> {
  const existing = new Map((await bolna.agents()).map((a) => [a.agent_name, a.id]));
  const ids: AgentIds = {};
  for (const definition of definitions) {
    const found = existing.get(definition.name);
    if (found) {
      ids[definition.label] = found;
      onProgress(`${definition.label}: already there`);
      continue;
    }
    const { agent_id: agentId } = await bolna.createAgent(definition.body);
    try {
      await bolna.createDispositions(agentId, definition.dispositions);
    } catch (error) {
      throw new Error(
        `${definition.label}: the agent was created but its extractions weren't. Delete "${definition.name}" in Bolna's dashboard, then run this again.`,
        { cause: error },
      );
    }
    ids[definition.label] = agentId;
    onProgress(`${definition.label}: created`);
  }
  return ids;
}

/** The registry with the ids from `agents.local.json` in place of its own. */
export function withAgentIds(agents: readonly AgentEntry[], ids: AgentIds): AgentEntry[] {
  return agents.map((entry) => ({ ...entry, bolnaAgentId: ids[entry.label] ?? entry.bolnaAgentId }));
}
