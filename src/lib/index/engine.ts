import { addWeeks } from "../domain/week";
import type { Cut, SurveyDefinition } from "../surveys/schema";
import { type Answers, scoreDealer } from "./score";

/**
 * The index engine: turns one survey week of calls into every cut the client pages show (national,
 * brand, state, segment, city tier, region, brand × state). Pure and sector-generic.
 *
 * Rules (all from the survey definition):
 * - only usable calls count: QA passed or approved, and at least `minAnsweredForUsable` answers;
 * - one call per dealer per week (most answers, then completed, then latest);
 * - momentum indicators compare with the dealer's own best call of the previous week;
 * - a cut pooled over 2 weeks uses each dealer's latest week in the window;
 * - values: the mean of dealers' scores, with a 95% margin (1.96 × SD / √n, from n ≥ 2);
 * - below `suppressBelow` dealers a value is hidden; below `lowNBelow` it carries a warning. Every
 *   indicator (and the composite) meets these on its own n, the dealers who answered it, as well as
 *   the group's: a cell of 5 where only 1 dealer answered loans must not show that dealer's answer.
 */

export type EngineCall = {
  dealerId: string;
  weekStart: string;
  /** Sortable time of the call (ISO string), used to pick the latest. */
  at: string;
  derivedStatus: string;
  qaState: string;
  answeredCount: number;
  answers: Answers;
  /** The dealer's dimension values: attribute dimensions plus state, region and city_tier. */
  dims: Readonly<Record<string, string>>;
};

export type Stat = {
  value: number | null;
  margin: number | null;
  n: number;
  /** Share of dealers per answer option, for map indicators (e.g. { up: 0.63, same: 0.25, down: 0.12 }). */
  breakdown: Record<string, number> | null;
  /** Fewer than the cut's `lowNBelow` dealers behind this value (shown with a warning). */
  lowN: boolean;
  /** Hidden: the group, or this value's own n, is under the cut's `suppressBelow`. `n` stays. */
  suppressed: boolean;
};

export type GroupResult = {
  /** Canonical key, e.g. "brand=hero;state=KA" ("" for the national cut). */
  key: string;
  values: Record<string, string>;
  /** Dealers in the group with at least one usable answer. */
  n: number;
  lowN: boolean;
  suppressed: boolean;
  composite: Stat;
  indicators: Record<string, Stat>;
};

export type WeekIndex = {
  weekStart: string;
  /** Usable dealers this week (national). */
  dealers: number;
  /** Their ids, for coverage counts (states, cities). */
  counted: string[];
  cuts: Record<string, GroupResult[]>;
};

function isUsable(def: SurveyDefinition, c: EngineCall): boolean {
  return (
    (c.qaState === "auto_ok" || c.qaState === "approved") && c.answeredCount >= def.qa.minAnsweredForUsable
  );
}

/**
 * Each dealer's newest call among the given (usable) calls: if a dealer is called again in a week, the
 * new answers replace the old ones. The whole call is used; answers are never mixed across calls.
 */
function latestPerDealer(calls: EngineCall[]): Map<string, EngineCall> {
  const latest = new Map<string, EngineCall>();
  for (const c of calls) {
    const cur = latest.get(c.dealerId);
    if (!cur || c.at > cur.at) latest.set(c.dealerId, c);
  }
  return latest;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stat(
  values: number[],
  breakdown: Record<string, number> | null,
  cut: Cut,
  groupSuppressed: boolean,
): Stat {
  const n = values.length;
  // No answers is "no value", not "suppressed": there is nothing to protect.
  const suppressed = n > 0 && (groupSuppressed || (cut.suppressBelow !== null && n < cut.suppressBelow));
  const lowN = n > 0 && cut.lowNBelow !== null && n < cut.lowNBelow;
  if (n === 0 || suppressed) return { value: null, margin: null, n, breakdown: null, lowN, suppressed };
  const m = mean(values);
  let margin: number | null = null;
  if (n >= 2) {
    const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1);
    margin = (1.96 * Math.sqrt(variance)) / Math.sqrt(n);
  }
  return { value: m, margin, n, breakdown, lowN, suppressed };
}

type Scored = {
  dims: Readonly<Record<string, string>>;
  composite: number | null;
  indicators: Record<string, number | null>;
  answers: Answers;
};

export function computeWeekIndex(
  definition: SurveyDefinition,
  weekStart: string,
  calls: EngineCall[],
): WeekIndex {
  const usable = calls.filter((c) => isUsable(definition, c));
  const byWeek = new Map<string, EngineCall[]>();
  for (const c of usable) byWeek.set(c.weekStart, [...(byWeek.get(c.weekStart) ?? []), c]);
  const bestByWeek = new Map<string, Map<string, EngineCall>>();
  const best = (week: string) => {
    let m = bestByWeek.get(week);
    if (!m) {
      m = latestPerDealer(byWeek.get(week) ?? []);
      bestByWeek.set(week, m);
    }
    return m;
  };

  const score = (c: EngineCall): Scored => {
    const prev = best(addWeeks(c.weekStart, -1)).get(c.dealerId)?.answers ?? null;
    const s = scoreDealer(definition, c.answers, prev);
    return {
      dims: c.dims,
      composite: s.composite.value,
      indicators: Object.fromEntries(s.indicators.map((i) => [i.key, i.score])),
      answers: c.answers,
    };
  };

  /** Dealers counted for a cut: this week's best call, or (pooled) the latest week in the window. */
  const dealersFor = (cut: Cut): Scored[] => {
    const chosen = new Map<string, EngineCall>();
    for (let w = cut.poolWeeks - 1; w >= 0; w--) {
      for (const [rid, c] of best(addWeeks(weekStart, -w))) chosen.set(rid, c); // later weeks overwrite
    }
    return [...chosen.values()].map(score);
  };

  const cuts: Record<string, GroupResult[]> = {};
  for (const cut of definition.cuts) {
    const groups = new Map<string, { values: Record<string, string>; members: Scored[] }>();
    for (const r of dealersFor(cut)) {
      const values: Record<string, string> = {};
      let complete = true;
      for (const d of cut.dims) {
        const v = r.dims[d];
        if (v === undefined) complete = false;
        else values[d] = v;
      }
      if (!complete) continue;
      const key = cut.dims.map((d) => `${d}=${values[d]}`).join(";");
      const g = groups.get(key) ?? { values, members: [] };
      g.members.push(r);
      groups.set(key, g);
    }

    cuts[cut.key] = [...groups.entries()]
      .map(([key, g]) => {
        const n = g.members.length;
        const suppressed = cut.suppressBelow !== null && n < cut.suppressBelow;
        const lowN = cut.lowNBelow !== null && n < cut.lowNBelow;
        const indicators: Record<string, Stat> = {};
        for (const ind of definition.indicators) {
          const vals = g.members
            .map((m) => m.indicators[ind.key])
            .filter((v): v is number => v !== null && v !== undefined);
          let breakdown: Record<string, number> | null = null;
          if (ind.rule.kind === "map" && vals.length > 0) {
            const q = ind.rule.question;
            breakdown = {};
            const answeredMembers = g.members.filter((m) => typeof m.answers[q] === "string");
            for (const option of Object.keys(ind.rule.scores)) {
              breakdown[option] =
                answeredMembers.filter((m) => m.answers[q] === option).length / answeredMembers.length;
            }
          }
          indicators[ind.key] = stat(vals, breakdown, cut, suppressed);
        }
        const compositeVals = g.members.map((m) => m.composite).filter((v): v is number => v !== null);
        return {
          key,
          values: g.values,
          n,
          lowN,
          suppressed,
          composite: stat(compositeVals, null, cut, suppressed),
          indicators,
        };
      })
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  const counted = [...best(weekStart).keys()].sort();
  return { weekStart, dealers: counted.length, counted, cuts };
}

/** The national group of a computed week (the cut with no dimensions), if any dealers counted. */
export function nationalOf(definition: SurveyDefinition, index: WeekIndex): GroupResult | null {
  const cut = definition.cuts.find((c) => c.dims.length === 0);
  return (cut && index.cuts[cut.key]?.[0]) ?? null;
}
