/**
 * Snapshots each registered Bolna agent (src/lib/calls/agents.ts, or the ids `pnpm agents:create` saved)
 * into agent_versions. Reads agents from Bolna (free GET requests); never places a call. Run after
 * `pnpm db:sync`.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AgentIds, withAgentIds } from "../../src/lib/bolna/agent-setup";
import { BolnaError, createBolnaClient } from "../../src/lib/bolna/client";
import { AGENTS, validateAgents } from "../../src/lib/calls/agents";
import { NO_NUMBERS } from "../../src/lib/calling-policy";
import { syncAgents } from "../../src/lib/db/agents";
import { createDb } from "../../src/lib/db/client";
import { AGENTS_LOCAL_FILE, loadLocalEnv, runScript } from "./_env";

runScript(async () => {
  loadLocalEnv();
  const url = process.env.DATABASE_URL;
  const apiKey = process.env.BOLNA_API_KEY;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!apiKey) throw new Error("BOLNA_API_KEY is not set");

  const localFile = resolve(process.cwd(), AGENTS_LOCAL_FILE);
  const agents = existsSync(localFile)
    ? withAgentIds(AGENTS, JSON.parse(readFileSync(localFile, "utf8")) as AgentIds)
    : AGENTS;
  const problems = validateAgents(agents);
  if (problems.length > 0) throw new Error(`The agent registry is invalid:\n- ${problems.join("\n- ")}`);

  // Read-only use of the client: calling stays switched off here whatever the environment says.
  const bolna = createBolnaClient({ apiKey, callingEnabled: false, scope: NO_NUMBERS });
  const snapshots = new Map<string, Record<string, unknown>>();
  for (const entry of agents) {
    let agent: Record<string, unknown>;
    try {
      agent = await bolna.getAgent(entry.bolnaAgentId);
    } catch (error) {
      if (error instanceof BolnaError && error.status < 500) {
        throw new Error(`Your Bolna account can't read the ${entry.label} agent. Run pnpm agents:create first.`, { cause: error });
      }
      throw error;
    }
    if (agent.id !== entry.bolnaAgentId) throw new Error(`Bolna returned another agent for ${entry.label}`);
    snapshots.set(entry.bolnaAgentId, agent);
  }

  const { db, pool } = createDb(url, { max: 1 });
  try {
    const results = await syncAgents(db, snapshots, { actor: "agents:sync", agents });
    console.log(`✓ ${agents.length} agents checked\n${results.map((r) => `  ${r}`).join("\n")}`);
  } finally {
    await pool.end();
  }
});
