import type { SurveyDefinition } from "../surveys/schema";
import { type GroupResult, nationalOf, type WeekIndex } from "./engine";

/**
 * Up to three plain-English key findings for a week, written from the numbers only (no model):
 * the clearest answer signal nationally, the spread across the primary attribute (brand), and the
 * biggest move since last week across a geography (state). Groups with a low-n warning are left out.
 */

export type FindingsInput = {
  definition: SurveyDefinition;
  current: WeekIndex;
  previous: WeekIndex | null;
  /** Display label for a dimension value. */
  label: (dimension: string, code: string) => string;
  nouns: { one: string; other: string };
  /** Dimension to compare across (vehicles: brand). */
  spreadDimension: string | null;
  /** Dimension to look for the biggest move in (vehicles: state). */
  moverDimension: string | null;
};

const pct = (share: number) => `${Math.round(share * 100)}%`;
const one = (v: number) => v.toFixed(1);

const OPTION_WORDS: Record<string, string> = { up: "up", down: "down", high: "high", low: "low" };

function cutFor(definition: SurveyDefinition, dimension: string) {
  return definition.cuts.find((c) => c.dims.length === 1 && c.dims[0] === dimension && c.poolWeeks === 1);
}

function solid(groups: GroupResult[] | undefined): (GroupResult & { composite: { value: number } })[] {
  return (groups ?? []).filter(
    (g): g is GroupResult & { composite: { value: number } } =>
      !g.lowN && !g.suppressed && g.composite.value !== null,
  );
}

function signalFinding({ definition, current, nouns }: FindingsInput): string | null {
  const nat = nationalOf(definition, current);
  if (!nat) return null;
  let best: { text: string; strength: number } | null = null;
  for (const ind of definition.indicators) {
    if (ind.rule.kind !== "map") continue;
    const s = nat.indicators[ind.key];
    if (!s || s.value === null || !s.breakdown || s.lowN || s.suppressed) continue;
    const entries = Object.entries(ind.rule.scores);
    const top = entries.find(([, score]) => score === 100)?.[0];
    const bottom = entries.find(([, score]) => score === 0)?.[0];
    if (!top || !bottom) continue;
    const strength = Math.abs(s.value - 50);
    if (best && strength <= best.strength) continue;
    const word = (o: string) => OPTION_WORDS[o] ?? o.replaceAll("_", " ");
    best = {
      strength,
      text: `${ind.label.en}: ${word(top)} at ${pct(s.breakdown[top] ?? 0)} of ${nouns.other}, ${word(bottom)} at ${pct(s.breakdown[bottom] ?? 0)}.`,
    };
  }
  return best?.text ?? null;
}

function spreadFinding({ definition, current, label, nouns, spreadDimension }: FindingsInput): string | null {
  if (!spreadDimension) return null;
  const cut = cutFor(definition, spreadDimension);
  const groups = solid(cut && current.cuts[cut.key]).toSorted(
    (a, b) => b.composite.value - a.composite.value,
  );
  if (groups.length < 2) return null;
  const hi = groups[0]!;
  const lo = groups.at(-1)!;
  const name = (g: GroupResult) => label(spreadDimension, g.values[spreadDimension]!);
  return `${definition.composite.label.en} is strongest among ${name(hi)} ${nouns.other} (${one(hi.composite.value)}) and weakest among ${name(lo)} ${nouns.other} (${one(lo.composite.value)}).`;
}

function moverFinding({
  definition,
  current,
  previous,
  label,
  moverDimension,
}: FindingsInput): string | null {
  if (!moverDimension || !previous) return null;
  const cut = cutFor(definition, moverDimension);
  if (!cut) return null;
  const before = new Map(solid(previous.cuts[cut.key]).map((g) => [g.key, g.composite.value]));
  let best: { g: GroupResult & { composite: { value: number } }; delta: number } | null = null;
  for (const g of solid(current.cuts[cut.key])) {
    const prev = before.get(g.key);
    if (prev === undefined) continue;
    const delta = g.composite.value - prev;
    if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { g, delta };
  }
  if (!best || Math.abs(best.delta) < 1) return null;
  const where = label(moverDimension, best.g.values[moverDimension]!);
  const verb = best.delta > 0 ? "rose" : "fell";
  return `The biggest move since last week was in ${where}: the ${definition.composite.label.en.toLowerCase()} ${verb} ${one(Math.abs(best.delta))} points to ${one(best.g.composite.value)}.`;
}

export function keyFindings(input: FindingsInput): string[] {
  return [signalFinding(input), spreadFinding(input), moverFinding(input)].filter(
    (f): f is string => f !== null,
  );
}
