import { and, eq, isNull, max } from "drizzle-orm";
import { AGENTS, type AgentEntry, agentConfig, validateAgents } from "../calls/agents";
import type { Db } from "./client";
import { audit } from "./queries/audit";
import { agentVersions, surveys } from "./schema";

/**
 * Mirrors the agent registry (src/lib/calls/agents.ts) into `agent_versions`, with a snapshot of each
 * agent's Bolna configuration (fetched by the caller: `pnpm agents:sync`). Idempotent: an agent whose
 * configuration hasn't changed stays as it is. A changed agent, or a new agent for a language, becomes
 * a new version and the one it replaces is retired (never deleted: calls point at it).
 */
export async function syncAgents(
  db: Pick<Db, "transaction">,
  snapshots: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  options: { now?: Date; actor: string; agents?: readonly AgentEntry[] },
): Promise<string[]> {
  const agents = options.agents ?? AGENTS;
  const now = options.now ?? new Date();
  const problems = validateAgents(agents);
  if (problems.length > 0) throw new Error(`The agent registry is invalid:\n- ${problems.join("\n- ")}`);

  return db.transaction(async (tx) => {
    const results: string[] = [];
    const surveyIds = new Map<string, string>();
    const surveyId = async (survey: AgentEntry["survey"]) => {
      const key = `${survey.slug} v${survey.version}`;
      const known = surveyIds.get(key);
      if (known) return known;
      const [row] = await tx
        .select({ id: surveys.id })
        .from(surveys)
        .where(and(eq(surveys.slug, survey.slug), eq(surveys.version, survey.version)));
      if (!row) throw new Error(`Survey ${key} is not in the database yet: run pnpm db:sync first.`);
      surveyIds.set(key, row.id);
      return row.id;
    };

    const kept = new Set<string>();
    for (const entry of agents) {
      const snapshot = snapshots.get(entry.bolnaAgentId);
      if (!snapshot) throw new Error(`No Bolna snapshot for ${entry.label} (agent ${entry.bolnaAgentId})`);
      const forSurvey = await surveyId(entry.survey);
      const { config, sha256 } = agentConfig(entry, snapshot);
      const name = `${entry.survey.slug} v${entry.survey.version} ${entry.language} (${entry.label})`;

      const [current] = await tx
        .select()
        .from(agentVersions)
        .where(
          and(
            eq(agentVersions.surveyId, forSurvey),
            eq(agentVersions.language, entry.language),
            isNull(agentVersions.retiredAt),
          ),
        );
      if (current && current.bolnaAgentId === entry.bolnaAgentId && current.configSha256 === sha256) {
        kept.add(current.id);
        results.push(`${name}: unchanged`);
        continue;
      }

      if (current) {
        await tx.update(agentVersions).set({ retiredAt: now }).where(eq(agentVersions.id, current.id));
      }
      const [{ latest } = { latest: null }] = await tx
        .select({ latest: max(agentVersions.version) })
        .from(agentVersions)
        .where(eq(agentVersions.bolnaAgentId, entry.bolnaAgentId));
      const version = (latest ?? 0) + 1;
      const [row] = await tx
        .insert(agentVersions)
        .values({
          surveyId: forSurvey,
          language: entry.language,
          label: entry.label,
          bolnaAgentId: entry.bolnaAgentId,
          version,
          config,
          configSha256: sha256,
          syncedAt: now,
          syncedBy: options.actor,
        })
        .returning({ id: agentVersions.id });
      kept.add(row!.id);
      await audit(tx, {
        actor: options.actor,
        action: "agent.sync",
        entityType: "agent_version",
        entityId: row!.id,
        before: current ? { label: current.label, bolnaAgentId: current.bolnaAgentId, version: current.version } : null,
        after: { label: entry.label, bolnaAgentId: entry.bolnaAgentId, version },
        meta: { survey: `${entry.survey.slug} v${entry.survey.version}`, language: entry.language },
      });
      results.push(
        !current
          ? `${name}: created`
          : current.bolnaAgentId === entry.bolnaAgentId
            ? `${name}: new version ${version} (the agent changed in Bolna)`
            : `${name}: now current, replaces ${current.label}`,
      );
    }

    // A language dropped from the registry: its agent stops being current.
    const current = await tx.select().from(agentVersions).where(isNull(agentVersions.retiredAt));
    for (const row of current) {
      if (kept.has(row.id)) continue;
      await tx.update(agentVersions).set({ retiredAt: now }).where(eq(agentVersions.id, row.id));
      await audit(tx, {
        actor: options.actor,
        action: "agent.retire",
        entityType: "agent_version",
        entityId: row.id,
        before: { label: row.label, bolnaAgentId: row.bolnaAgentId, version: row.version },
        meta: { language: row.language },
      });
      results.push(`${row.language} (${row.label}): retired, no longer in the registry`);
    }
    return results;
  });
}
