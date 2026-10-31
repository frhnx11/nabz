import { db } from "@/lib/db/client";
import { loadIndexInputs } from "@/lib/db/queries/index-data";
import { weekStartOf } from "@/lib/domain/week";
import type { WeekIndex } from "@/lib/index/engine";
import { dimensionValueLabel, geoDimension, primaryAttributeDimension } from "@/lib/index/labels";
import { buildPulseView, historyStart, parseWeekParam } from "@/lib/index/view";
import { getSector } from "@/lib/sectors/registry";
import type { SurveyDefinition } from "@/lib/surveys/schema";

export const SECTOR = getSector("vehicles");

/**
 * The live view of one Pulse week for the client pages: every usable call.
 * Call after `await io()`: it reads the clock.
 */
export async function loadPulse(weekParam: string | string[] | undefined) {
  const now = new Date();
  const inputs = await loadIndexInputs(db(), {
    surveySlug: SECTOR.pulseSurvey!,
    fromWeek: historyStart(now),
  });
  if (!inputs) return null;
  const { definition } = inputs.survey;
  const view = buildPulseView(
    { definition, calls: inputs.calls, cityOf: inputs.cityOf },
    { now, week: parseWeekParam(weekParam, weekStartOf(now)) },
  );
  if (!view) return null;
  return { definition, ...view };
}

export type LoadedPulse = NonNullable<Awaited<ReturnType<typeof loadPulse>>>;

/** Dealers per value of one dimension this week, most first. */
function dealersBy(definition: SurveyDefinition, index: WeekIndex, dimension: string | null) {
  if (!dimension) return [];
  return (index.cuts[dimension] ?? [])
    .map((g) => ({ label: dimensionValueLabel(definition, SECTOR, dimension, g.values[dimension]!), n: g.n }))
    .toSorted((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

/** The latest week's dealer counts by brand and by state. Call after `await io()`: it reads the clock. */
export async function loadDealerCounts() {
  const pulse = await loadPulse(undefined);
  if (!pulse) return null;
  const { definition, index } = pulse;
  return {
    byBrand: dealersBy(definition, index, primaryAttributeDimension(definition)),
    byState: dealersBy(definition, index, geoDimension(definition, "state")),
  };
}
