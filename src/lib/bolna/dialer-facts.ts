import { desc, eq } from "drizzle-orm";
import type { PlanAgent } from "../calls/set-plan";
import type { Db } from "../db/client";
import { currentAgent } from "../db/queries/agents";
import { dealers, surveys } from "../db/schema";
import type { CallLanguage } from "../reference/languages";
import { getSector } from "../sectors/registry";

/** What placing a call depends on, shared by test calls and sets. Queries run one after another. */

export type Conn = Pick<Db, "select">;

export const dealerColumns = {
  dealerId: dealers.id,
  phoneE164: dealers.phoneE164,
  language: dealers.language,
  businessName: dealers.businessName,
  attributes: dealers.attributes,
  cityCode: dealers.cityCode,
  sectorSlug: dealers.sectorSlug,
};

/** The latest version of a sector's survey: the one new calls use. */
export async function latestSurveyOf(db: Conn, sectorSlug: string) {
  const slug = getSector(sectorSlug).pulseSurvey;
  if (!slug) return null;
  const [survey] = await db
    .select({ id: surveys.id, slug: surveys.slug, version: surveys.version })
    .from(surveys)
    .where(eq(surveys.slug, slug))
    .orderBy(desc(surveys.version))
    .limit(1);
  return survey ?? null;
}

/** The current agent for a language on a survey, or null if none is synced. */
export async function agentOf(db: Conn, surveyId: string, language: string): Promise<PlanAgent | null> {
  const agent = await currentAgent(db, surveyId, language as CallLanguage);
  return agent ? { agentVersionId: agent.id, bolnaAgentId: agent.bolnaAgentId, label: agent.label } : null;
}
