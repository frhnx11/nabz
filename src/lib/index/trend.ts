import { addWeeks, weekLabel } from "../domain/week";
import type { SurveyDefinition } from "../surveys/schema";
import { computeWeekIndex, type EngineCall, nationalOf, type WeekIndex } from "./engine";

/** One week of the headline composite. */
export type TrendPoint = { weekStart: string; value: number | null; margin: number | null; n: number };

/** The `count` weeks ending at `endWeek`, oldest first. */
export function weekWindow(endWeek: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addWeeks(endWeek, i - count + 1));
}

/** Computes each week's index once, plus the national composite as a trend line. */
export function computeTrend(
  definition: SurveyDefinition,
  calls: EngineCall[],
  weeks: string[],
): { indices: Map<string, WeekIndex>; points: TrendPoint[] } {
  const indices = new Map<string, WeekIndex>();
  const points: TrendPoint[] = [];
  for (const week of weeks) {
    const index = computeWeekIndex(definition, week, calls);
    indices.set(week, index);
    const nat = nationalOf(definition, index);
    points.push({
      weekStart: week,
      value: nat?.composite.value ?? null,
      margin: nat?.composite.margin ?? null,
      n: nat?.n ?? 0,
    });
  }
  return { indices, points };
}

/** Mean of the weeks that have a value, with how many weeks it covers. */
export function trendAverage(points: TrendPoint[]): { value: number; weeks: number } | null {
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return { value: values.reduce((a, b) => a + b, 0) / values.length, weeks: values.length };
}

/**
 * "Highest since 2026-W38", "Lowest in 8 weeks": said only when the last point beats at least the
 * two weeks before it. Weeks without a value are skipped.
 */
export function extremeNote(points: TrendPoint[]): string | null {
  const known = points.filter((p): p is TrendPoint & { value: number } => p.value !== null);
  const last = points.at(-1);
  if (!last || last.value === null || known.length < 3) return null;
  const earlier = known.slice(0, -1);
  for (const [word, beats] of [
    ["Highest", (a: number, b: number) => a > b],
    ["Lowest", (a: number, b: number) => a < b],
  ] as const) {
    let i = earlier.length - 1;
    while (i >= 0 && beats(last.value, earlier[i]!.value)) i--;
    const beaten = earlier.length - 1 - i;
    if (beaten < 2) continue;
    if (i < 0) return `${word} in ${known.length} weeks`;
    return `${word} since ${weekLabel(earlier[i]!.weekStart)}`;
  }
  return null;
}
