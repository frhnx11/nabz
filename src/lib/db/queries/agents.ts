import { and, asc, eq, isNull } from "drizzle-orm";
import type { CallLanguage } from "../../reference/languages";
import type { Db } from "../client";
import { agentVersions, surveys } from "../schema";

/**
 * Every Bolna agent we have ever registered, retired ones included: a late event from an agent we
 * have since replaced is still ours. Ingestion rejects executions from any other agent.
 */
export async function ourAgentIds(db: Pick<Db, "selectDistinct">): Promise<ReadonlySet<string>> {
  const rows = await db.selectDistinct({ id: agentVersions.bolnaAgentId }).from(agentVersions);
  return new Set(rows.map((r) => r.id));
}

/** The agent new calls in this language use for this survey version, or null if none is synced. */
export async function currentAgent(db: Pick<Db, "select">, surveyId: string, language: CallLanguage) {
  const [row] = await db
    .select({
      id: agentVersions.id,
      bolnaAgentId: agentVersions.bolnaAgentId,
      label: agentVersions.label,
      version: agentVersions.version,
    })
    .from(agentVersions)
    .where(
      and(eq(agentVersions.surveyId, surveyId), eq(agentVersions.language, language), isNull(agentVersions.retiredAt)),
    );
  return row ?? null;
}

/** The current agents, for Ops → System. */
export async function listAgents(db: Pick<Db, "select">) {
  return db
    .select({
      surveySlug: surveys.slug,
      surveyVersion: surveys.version,
      language: agentVersions.language,
      label: agentVersions.label,
      bolnaAgentId: agentVersions.bolnaAgentId,
      version: agentVersions.version,
      syncedAt: agentVersions.syncedAt,
    })
    .from(agentVersions)
    .innerJoin(surveys, eq(surveys.id, agentVersions.surveyId))
    .where(isNull(agentVersions.retiredAt))
    .orderBy(asc(surveys.slug), asc(surveys.version), asc(agentVersions.language));
}
