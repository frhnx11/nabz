import { addWeeks, weekStartFromLabel, weekStartOf } from "../domain/week";
import { getCity } from "../reference/geo";
import type { SurveyDefinition } from "../surveys/schema";
import type { EngineCall, WeekIndex } from "./engine";
import { computeTrend, type TrendPoint, weekWindow } from "./trend";

/**
 * What the client pages show for one survey week, computed live from the calls: the week's index, last week's (for changes), the headline trend and coverage.
 */

export const TREND_WEEKS = 8;
/** How far back a page may go, and how much history the loader fetches. */
export const HISTORY_WEEKS = 12;

export type PulseView = {
  currentWeek: string;
  /** The latest week with answers: the default page. */
  latestWeek: string;
  week: string;
  /** The week is still running, so more calls can come in. */
  inProgress: boolean;
  index: WeekIndex;
  previous: WeekIndex | null;
  /** The headline composite for the TREND_WEEKS weeks ending at `week`. */
  points: TrendPoint[];
  coverage: { dealers: number; states: number; cities: number };
  hasPrevWeek: boolean;
  hasNextWeek: boolean;
};

/** "2026-W44" from the URL → week start, if it's a real week inside the history we keep. */
export function parseWeekParam(value: string | string[] | undefined, currentWeek: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const week = weekStartFromLabel(value);
    return week <= currentWeek && week >= addWeeks(currentWeek, -(HISTORY_WEEKS - 1)) ? week : null;
  } catch {
    return null;
  }
}

/** The first week the loader must fetch so every page in the history can compute its trend. */
export function historyStart(now: Date): string {
  // + TREND_WEEKS for the oldest page's trend, + 1 for its momentum (previous week).
  return addWeeks(weekStartOf(now), -(HISTORY_WEEKS + TREND_WEEKS));
}

export function buildPulseView(
  inputs: { definition: SurveyDefinition; calls: EngineCall[]; cityOf: ReadonlyMap<string, string> },
  options: { now: Date; week?: string | null },
): PulseView | null {
  const currentWeek = weekStartOf(options.now);
  // The latest week with any answers (normally the running one); the default page.
  const answered = new Set(
    inputs.calls
      .filter((c) => c.answeredCount >= inputs.definition.qa.minAnsweredForUsable)
      .map((c) => c.weekStart),
  );
  let latestWeek: string | null = null;
  for (let i = 0; i < HISTORY_WEEKS && !latestWeek; i++) {
    const w = addWeeks(currentWeek, -i);
    if (answered.has(w)) latestWeek = w;
  }
  if (!latestWeek) return null;
  const week = options.week && options.week <= latestWeek ? options.week : latestWeek;

  const weeks = weekWindow(week, TREND_WEEKS);
  const { indices, points } = computeTrend(inputs.definition, inputs.calls, weeks);
  const index = indices.get(week)!;
  const previous = indices.get(addWeeks(week, -1)) ?? null;

  const states = new Set<string>();
  const cities = new Set<string>();
  for (const id of index.counted) {
    const code = inputs.cityOf.get(id);
    if (!code) continue;
    cities.add(code);
    states.add(getCity(code).state);
  }

  return {
    currentWeek,
    latestWeek,
    week,
    inProgress: week === currentWeek,
    index,
    previous,
    points,
    coverage: { dealers: index.dealers, states: states.size, cities: cities.size },
    hasPrevWeek:
      (previous?.dealers ?? 0) > 0 && addWeeks(week, -1) >= addWeeks(currentWeek, -(HISTORY_WEEKS - 1)),
    hasNextWeek: week < latestWeek,
  };
}
