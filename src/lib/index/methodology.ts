import type { Indicator, SurveyDefinition } from "../surveys/schema";

/**
 * What the Methodology page shows, read straight from the survey definition so it can't drift from what
 * the engine does. Pure and sector-generic.
 */

const capitalise = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

export type QuestionRow = {
  key: string;
  en: string;
  /** The sub-indices this answer feeds. Empty: it isn't scored. */
  feeds: string[];
  /** The question whose answer this one only checks, for an answer that isn't scored. */
  checks: string | null;
};

export function questionRows(definition: SurveyDefinition): QuestionRow[] {
  const labelOf = (key: string) => definition.questions.find((q) => q.key === key)?.label.en ?? key;
  return definition.questions.map((q) => {
    const check = definition.qa.rules.find((r) => r.kind === "trend_vs_number_change" && r.number === q.key);
    return {
      key: q.key,
      en: q.ask.en,
      feeds: definition.indicators.filter((i) => i.rule.question === q.key).map((i) => i.label.en),
      checks: check?.kind === "trend_vs_number_change" ? labelOf(check.trend) : null,
    };
  });
}

function scoringText(rule: Indicator["rule"]): string {
  if (rule.kind === "map") {
    return Object.entries(rule.scores)
      .map(([option, score]) => `${capitalise(option)} ${score}`)
      .join(" · ");
  }
  const t = rule.tolerancePct;
  return `Fell over ${t}%: ${rule.score.fell} · Within ${t}%: ${rule.score.within} · Rose over ${t}%: ${rule.score.rose}`;
}

export type ScoringRow = {
  key: string;
  label: string;
  description: string;
  question: string;
  scoring: string;
  /** Share of the composite, or null if it isn't part of it. */
  weightPct: number | null;
  /** Bad news for demand when high, so it's flipped (100 − score) inside the composite. */
  inverted: boolean;
};

export function scoringRows(definition: SurveyDefinition): ScoringRow[] {
  return definition.indicators.map((i) => {
    const component = definition.composite.components.find((c) => c.indicator === i.key);
    return {
      key: i.key,
      label: i.label.en,
      description: i.description.en,
      question: definition.questions.find((q) => q.key === i.rule.question)?.label.en ?? i.rule.question,
      scoring: scoringText(i.rule),
      weightPct: component?.weightPct ?? null,
      inverted: component?.invert ?? false,
    };
  });
}
