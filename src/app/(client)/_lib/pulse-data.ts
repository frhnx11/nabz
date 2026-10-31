import { db } from "@/lib/db/client";
import { loadIndexInputs } from "@/lib/db/queries/index-data";
import { weekStartOf } from "@/lib/domain/week";
import { buildPulseView, historyStart, parseWeekParam } from "@/lib/index/view";
import { getSector } from "@/lib/sectors/registry";

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
