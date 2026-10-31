/**
 * Creates the call agents in the Bolna account of BOLNA_API_KEY and saves their ids to agents.local.json,
 * which `pnpm agents:sync` then uses. Only for your own Bolna account: never places a call.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AgentDefinition, createMissingAgents } from "../../src/lib/bolna/agent-setup";
import { createBolnaClient } from "../../src/lib/bolna/client";
import { NO_NUMBERS } from "../../src/lib/calling-policy";
import { AGENTS_LOCAL_FILE, loadLocalEnv, runScript } from "./_env";

runScript(async () => {
  loadLocalEnv();
  const apiKey = process.env.BOLNA_API_KEY;
  if (!apiKey) throw new Error("BOLNA_API_KEY is not set");

  const folder = resolve(process.cwd(), "agents/definitions");
  const definitions = readdirSync(folder).map(
    (file) => JSON.parse(readFileSync(resolve(folder, file), "utf8")) as AgentDefinition,
  );

  // Calling stays switched off here whatever the environment says.
  const bolna = createBolnaClient({ apiKey, callingEnabled: false, scope: NO_NUMBERS });
  const ids = await createMissingAgents(bolna, definitions, (line) => console.log(`  ${line}`));

  writeFileSync(resolve(process.cwd(), AGENTS_LOCAL_FILE), `${JSON.stringify(ids, null, 2)}\n`);
  console.log(`✓ ${definitions.length} agents ready, ids saved to ${AGENTS_LOCAL_FILE}. Now run pnpm agents:sync.`);
});
