import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { dealerDims } from "../../index/dims";
import type { EngineCall } from "../../index/engine";
import type { Answers } from "../../index/score";
import type { SurveyDefinition } from "../../surveys/schema";
import type { Db } from "../client";
import { calls, geoCities, geoStates, dealers, surveys } from "../schema";

export type IndexInputs = {
  survey: { title: string; sectorSlug: string; definition: SurveyDefinition };
  calls: EngineCall[];
  /** Dealer id → city code, for coverage counts. */
  cityOf: Map<string, string>;
};

/**
 * Everything the index engine needs for one survey: its latest definition and every call that could
 * count (QA passed or approved, at least one answer) from `fromWeek` on, with each dealer's dimensions. Null when the survey isn't synced.
 */
export async function loadIndexInputs(
  db: Db,
  options: { surveySlug: string; fromWeek: string },
): Promise<IndexInputs | null> {
  const [survey] = await db
    .select({ title: surveys.title, sectorSlug: surveys.sectorSlug, definition: surveys.definition })
    .from(surveys)
    .where(eq(surveys.slug, options.surveySlug))
    .orderBy(desc(surveys.version))
    .limit(1);
  if (!survey) return null;
  const definition = survey.definition as SurveyDefinition;

  const rows = await db
    .select({
      dealerId: calls.dealerId,
      weekStart: calls.weekStart,
      at: sql<string>`to_char(coalesce(${calls.startedAt}, ${calls.initiatedAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      derivedStatus: calls.derivedStatus,
      qaState: calls.qaState,
      answeredCount: calls.answeredCount,
      answers: calls.answers,
      attributes: dealers.attributes,
      cityCode: dealers.cityCode,
      state: geoCities.stateCode,
      cityTier: geoCities.tier,
      region: geoStates.regionCode,
    })
    .from(calls)
    .innerJoin(surveys, eq(surveys.id, calls.surveyId))
    .innerJoin(dealers, eq(dealers.id, calls.dealerId))
    .innerJoin(geoCities, eq(geoCities.code, dealers.cityCode))
    .innerJoin(geoStates, eq(geoStates.code, geoCities.stateCode))
    .where(
      and(
        eq(surveys.slug, options.surveySlug),
        gte(calls.weekStart, options.fromWeek),
        inArray(calls.qaState, ["auto_ok", "approved"]),
        gte(calls.answeredCount, 1),
      ),
    );

  const cityOf = new Map<string, string>();
  const engineCalls = rows.map((r): EngineCall => {
    cityOf.set(r.dealerId, r.cityCode);
    return {
      dealerId: r.dealerId,
      weekStart: r.weekStart,
      at: r.at,
      derivedStatus: r.derivedStatus,
      qaState: r.qaState,
      answeredCount: r.answeredCount,
      answers: r.answers as Answers,
      dims: dealerDims(definition, r.attributes, {
        state: r.state,
        region: r.region,
        cityTier: r.cityTier,
      }),
    };
  });

  return {
    survey: { title: survey.title, sectorSlug: survey.sectorSlug, definition },
    calls: engineCalls,
    cityOf,
  };
}
