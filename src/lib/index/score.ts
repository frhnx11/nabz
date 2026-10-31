import type { Indicator, SurveyDefinition } from "../surveys/schema";

/**
 * Scores one dealer's answers for one survey week, exactly as the survey definition says.
 * Pure and sector-generic: the index engine aggregates these per cut; the call pop-up shows them.
 *
 * Every indicator becomes 0–100 (50 = no change / normal). The composite (e.g. Demand) is the
 * weighted mean of the indicators this dealer actually has, with "bad news" indicators inverted
 * (100 − x), renormalised over the weights present, and only if at least `minComponents` are present.
 */

export type Answers = Readonly<Record<string, string | number>>;

export type IndicatorScore = {
  key: string;
  question: string;
  score: number | null;
  /** Why there is no score, when there isn't one. */
  missing: null | "not_answered" | "needs_previous_week";
};

export type CompositeComponent = {
  indicator: string;
  weightPct: number;
  invert: boolean;
  /** The indicator's score as published (before inversion). */
  score: number;
  /** What enters the composite: the score, or 100 − score when inverted. */
  contribution: number;
};

export type CompositeScore = {
  key: string;
  value: number | null;
  components: CompositeComponent[];
  /** Sum of the weights actually used (100 when every component is present). */
  usedWeightPct: number;
  missing: null | "too_few_components";
};

export type DealerScore = {
  indicators: IndicatorScore[];
  composite: CompositeScore;
};

function scoreIndicator(indicator: Indicator, answers: Answers, previous: Answers | null): IndicatorScore {
  const rule = indicator.rule;
  const base = { key: indicator.key, question: rule.question };
  const value = answers[rule.question];

  if (rule.kind === "map") {
    const score =
      typeof value === "string" && Object.hasOwn(rule.scores, value) ? rule.scores[value] : undefined;
    return score === undefined
      ? { ...base, score: null, missing: "not_answered" }
      : { ...base, score, missing: null };
  }

  // Momentum: compare with the same dealer's answer last week.
  if (typeof value !== "number" || !Number.isFinite(value))
    return { ...base, score: null, missing: "not_answered" };
  const prev = previous?.[rule.question];
  if (typeof prev !== "number" || !Number.isFinite(prev)) {
    return { ...base, score: null, missing: "needs_previous_week" };
  }
  // "Rose" means it grew by more than tolerancePct of last week's value (integer-safe, handles zero).
  const change = 100 * (value - prev);
  const band = rule.tolerancePct * prev;
  const score = change > band ? rule.score.rose : -change > band ? rule.score.fell : rule.score.within;
  return { ...base, score, missing: null };
}

export function scoreDealer(
  definition: Pick<SurveyDefinition, "indicators" | "composite">,
  answers: Answers,
  previousAnswers: Answers | null = null,
): DealerScore {
  const indicators = definition.indicators.map((ind) => scoreIndicator(ind, answers, previousAnswers));
  const byKey = new Map(indicators.map((s) => [s.key, s]));

  const components: CompositeComponent[] = [];
  for (const c of definition.composite.components) {
    const s = byKey.get(c.indicator);
    if (!s || s.score === null) continue;
    components.push({
      indicator: c.indicator,
      weightPct: c.weightPct,
      invert: c.invert,
      score: s.score,
      contribution: c.invert ? 100 - s.score : s.score,
    });
  }

  const usedWeightPct = components.reduce((sum, c) => sum + c.weightPct, 0);
  const enough = components.length >= definition.composite.minComponents && usedWeightPct > 0;
  const value = enough
    ? components.reduce((sum, c) => sum + c.weightPct * c.contribution, 0) / usedWeightPct
    : null;

  return {
    indicators,
    composite: {
      key: definition.composite.key,
      value,
      components,
      usedWeightPct,
      missing: enough ? null : "too_few_components",
    },
  };
}
