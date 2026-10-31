import { canonicalHash } from "../domain/canonical-json";
import { isUuid } from "../domain/uuid";
import { CALL_LANGUAGE_CODES, type CallLanguage } from "../reference/languages";
import { SURVEYS } from "../surveys/registry";

/**
 * Which Bolna agent asks a survey in which language. Pure configuration, like the survey definitions:
 * the agents themselves are built and tested in the call lab (`../call-lab`), and their ids are copied
 * here from the lab's `.agents.json` files. `pnpm agents:sync` then snapshots each agent's Bolna
 * configuration into `agent_versions`, so every call records exactly which agent asked it.
 *
 * To change an agent: build a new lab version (hi05, …), replace its entry here, run agents:sync.
 * The old agent is retired, never deleted: past calls still point at it.
 */

export type AgentEntry = {
  survey: { slug: string; version: number };
  language: CallLanguage;
  /** The lab version that built this agent. */
  label: string;
  bolnaAgentId: string;
  /** Has had a real call in the lab. The others are drafts awaiting a native speaker's review. */
  tested: boolean;
};

const PULSE_V2 = { slug: "vehicle_pulse", version: 2 };

export const AGENTS: readonly AgentEntry[] = [
  { survey: PULSE_V2, language: "en", label: "en01", bolnaAgentId: "4f7929fb-8e19-4d6e-a9db-5129fcea1356", tested: true },
  { survey: PULSE_V2, language: "hi", label: "hi04", bolnaAgentId: "017e390a-7737-454d-9edd-861588cda64c", tested: true },
  { survey: PULSE_V2, language: "ta", label: "ta02", bolnaAgentId: "5683fce7-dc22-4b5b-bfea-47b6f8150c7a", tested: true },
  // Odia is "or" here (ISO 639-1); Sarvam calls it "od", which the agent was built with.
  { survey: PULSE_V2, language: "or", label: "od01", bolnaAgentId: "37e279c2-a82f-422b-8b74-7059fcc73198", tested: true },
  { survey: PULSE_V2, language: "bn", label: "bn01", bolnaAgentId: "23d4ea67-650a-46bd-bc8b-92b1f462a402", tested: false },
  { survey: PULSE_V2, language: "mr", label: "mr01", bolnaAgentId: "290c0e63-6084-48c1-8e10-f71b86505dcd", tested: false },
  { survey: PULSE_V2, language: "te", label: "te01", bolnaAgentId: "5e282dbc-2df4-4ebc-ab38-9a7fab7698e2", tested: false },
  { survey: PULSE_V2, language: "gu", label: "gu01", bolnaAgentId: "56a29960-7987-42e3-8614-3100e5b2d52e", tested: false },
  { survey: PULSE_V2, language: "kn", label: "kn01", bolnaAgentId: "ba510a38-4ed5-41c9-a376-9ceebd2c4e18", tested: false },
  { survey: PULSE_V2, language: "ml", label: "ml01", bolnaAgentId: "fdee8756-9081-4d80-8857-61c461ac184e", tested: false },
  { survey: PULSE_V2, language: "pa", label: "pa01", bolnaAgentId: "97990919-5fbf-4b2c-a3a5-b8adaf5dd56e", tested: false },
  { survey: PULSE_V2, language: "as", label: "as01", bolnaAgentId: "cf062146-043a-494b-ad21-31f5494fc495", tested: false },
];

export function agentFor(
  language: string,
  survey: { slug: string; version: number },
  agents: readonly AgentEntry[] = AGENTS,
): AgentEntry | null {
  return (
    agents.find((a) => a.language === language && a.survey.slug === survey.slug && a.survey.version === survey.version) ??
    null
  );
}

/** Problems with the registry: run by tests and by agents:sync. */
export function validateAgents(agents: readonly AgentEntry[] = AGENTS): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const surveys = new Map<string, Set<string>>();
  for (const a of agents) {
    const survey = `${a.survey.slug} v${a.survey.version}`;
    if (!SURVEYS.some((s) => s.slug === a.survey.slug && s.version === a.survey.version)) {
      errors.push(`${a.label}: unknown survey ${survey}`);
    }
    if (!isUuid(a.bolnaAgentId)) errors.push(`${a.label}: agent id is not a UUID`);
    if (ids.has(a.bolnaAgentId)) errors.push(`${a.label}: agent ${a.bolnaAgentId} is listed twice`);
    ids.add(a.bolnaAgentId);
    const languages = surveys.get(survey) ?? new Set<string>();
    if (languages.has(a.language)) errors.push(`${survey}: two agents for ${a.language}`);
    languages.add(a.language);
    surveys.set(survey, languages);
  }
  for (const [survey, languages] of surveys) {
    const missing = CALL_LANGUAGE_CODES.filter((c) => !languages.has(c));
    if (missing.length) errors.push(`${survey}: no agent for ${missing.join(", ")}`);
  }
  return errors;
}

/** Fields of Bolna's agent record that change without the agent changing (its processing state, save time). */
const VOLATILE_AGENT_FIELDS = ["agent_status", "updated_at"] as const;

/**
 * What we store for an agent version: which agent it is plus Bolna's configuration of it (prompt,
 * voice, models, extractions), and its fingerprint. A change to either is a new version. `tested` is
 * left out: marking a draft as tested doesn't change the agent.
 */
export function agentConfig(entry: AgentEntry, snapshot: Readonly<Record<string, unknown>>) {
  const agent: Record<string, unknown> = { ...snapshot };
  for (const field of VOLATILE_AGENT_FIELDS) delete agent[field];
  const { tested: _tested, ...which } = entry;
  const config = { entry: which, agent };
  return { config, sha256: canonicalHash(config).sha256 };
}
