import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SECTORS } from "../sectors/registry";
import type { SectorConfig } from "../sectors/schema";
import { vehiclePulseV1 } from "./definitions/vehicle-pulse.v1";
import { vehiclePulseV2 } from "./definitions/vehicle-pulse.v2";
import { indexQuestionKeys } from "./helpers";
import { definitionHash, latestSurvey, SURVEYS, validateSurveys } from "./registry";
import { SurveyDefinition, type SurveyDefinitionInput } from "./schema";

/** A deep copy of Vehicle Pulse v1 as plain input, for mutation tests. */
function v1(): SurveyDefinitionInput {
  return structuredClone(vehiclePulseV1) as SurveyDefinitionInput;
}

function errorsOf(input: unknown): string {
  const result = SurveyDefinition.safeParse(input);
  return result.success ? "" : z.prettifyError(result.error);
}

describe("Vehicle Pulse v1", () => {
  it("parses and has the agreed shape", () => {
    expect(vehiclePulseV1.questions.map((q) => q.key)).toEqual([
      "enquiries_trend",
      "bookings_trend",
      "bookings_week",
      "stock_days",
      "discount_trend",
      "loan_rejections",
    ]);
    expect(vehiclePulseV1.composite.components.map((c) => [c.indicator, c.weightPct, c.invert])).toEqual([
      ["enquiries", 25, false],
      ["bookings", 25, false],
      ["stock", 20, false],
      ["discount_pressure", 15, true],
      ["credit_stress", 15, true],
    ]);
    expect(indexQuestionKeys(vehiclePulseV1)).toEqual([
      "enquiries_trend",
      "bookings_trend",
      "stock_days",
      "discount_trend",
      "loan_rejections",
    ]);
    const brandState = vehiclePulseV1.cuts.find((c) => c.key === "brand_state");
    expect(brandState).toMatchObject({
      dims: ["brand", "state"],
      poolWeeks: 2,
      suppressBelow: 3,
      lowNBelow: 5,
    });
  });

  it("is pinned: any edit must be a deliberate new version", () => {
    // If this fails you changed v1. Once v1 has been used by a call it is frozen in the database and
    // cannot change: add vehicle-pulse.v2.ts instead. Before first use, update the hash consciously.
    expect(definitionHash(vehiclePulseV1)).toMatchInlineSnapshot(
      `"b8d745c64d6c28ac0a069b0a6a3d0c1b5eece89117440aedb37f5eb0baa59a59"`,
    );
  });

  it("is registered and consistent with its sector", () => {
    expect(validateSurveys()).toEqual([]);
  });
});

/**
 * Everything that must stay the same between v1 and v2 so answers remain comparable: v2 changes only
 * what is asked (the questions' wording, labels and extraction text) and credit stress's description.
 */
function comparablePart(def: typeof vehiclePulseV1) {
  const copy = structuredClone(def) as Record<string, unknown> & typeof def;
  const { version: _version, ...rest } = copy;
  return {
    ...rest,
    questions: copy.questions.map((q) => {
      const { ask: _ask, label: _label, extraction: _extraction, askedWith: _askedWith, ...shape } = q;
      return shape;
    }),
    indicators: copy.indicators.map((i) => (i.key === "credit_stress" ? { ...i, description: null } : i)),
  };
}

describe("Vehicle Pulse v2", () => {
  it("asks the new script's six questions with v1's keys, values and scoring", () => {
    expect(vehiclePulseV2.version).toBe(2);
    expect(vehiclePulseV2.questions.map((q) => q.key)).toEqual(vehiclePulseV1.questions.map((q) => q.key));
    expect(indexQuestionKeys(vehiclePulseV2)).toEqual(indexQuestionKeys(vehiclePulseV1));
    expect(comparablePart(vehiclePulseV2)).toEqual(comparablePart(vehiclePulseV1));
  });

  it("asks bookings as two questions and loans against last month", () => {
    const q = (key: string) => vehiclePulseV2.questions.find((x) => x.key === key)!;
    expect(q("bookings_week").askedWith).toBeUndefined();
    expect(q("bookings_week").ask.en).toBe("Roughly how many bookings this week?");
    expect(q("stock_days").ask.en).toMatch(/today's selling pace/);
    expect(q("discount_trend").ask.en).toMatch(/compared with last week/);
    expect(q("loan_rejections").ask.en).toMatch(/compared with last month/);
    expect(q("loan_rejections").label.en).toBe("Loan rejections vs last month");
  });

  it("is pinned: any edit must be a deliberate new version", () => {
    // Once v2 has been used by a real call it is frozen in the database: add vehicle-pulse.v3.ts instead.
    expect(definitionHash(vehiclePulseV2)).toMatchInlineSnapshot(
      `"6881a0d0f90041480eebc51b3a85cff0611e07c7d30d74687af20afe7ce4f44b"`,
    );
  });

  it("is the latest version: new sets use it", () => {
    expect(latestSurvey("vehicle_pulse")).toBe(vehiclePulseV2);
    expect(SURVEYS.filter((d) => d.slug === "vehicle_pulse").map((d) => d.version)).toEqual([1, 2]);
  });
});

describe("survey invariants (each mutation must be rejected)", () => {
  const cases: [string, (d: SurveyDefinitionInput) => void, RegExp][] = [
    [
      "duplicate question key",
      (d) => d.questions.push(structuredClone(d.questions[0]!)),
      /duplicate question key/,
    ],
    ["reserved question key", (d) => (d.questions[0]!.key = "outcome"), /reserved/],
    ["askedWith pointing nowhere", (d) => (d.questions[2]!.askedWith = "nope"), /askedWith/],
    [
      "number min ≥ max",
      (d) => {
        const q = d.questions[3]!;
        if (q.type === "number") q.min = 400;
      },
      /min must be below max/,
    ],
    [
      "option hint for a non-option",
      (d) => (d.questions[0]!.extraction.optionHints = { sideways: "x" }),
      /"sideways" is not an option/,
    ],
    [
      "map rule on a number question",
      (d) => (d.indicators[0]!.rule.question = "stock_days"),
      /map rules need/,
    ],
    [
      "map rule missing an option",
      (d) => {
        const r = d.indicators[0]!.rule;
        if (r.kind === "map") delete r.scores.same;
      },
      /cover exactly the options/,
    ],
    [
      "momentum rule on a trend question",
      (d) => (d.indicators[2]!.rule.question = "enquiries_trend"),
      /momentum rules need a number/,
    ],
    ["unknown indicator question", (d) => (d.indicators[0]!.rule.question = "nope"), /unknown question/],
    ["weights not summing to 100", (d) => (d.composite.components[0]!.weightPct = 30), /sum to 100, got 105/],
    [
      "unknown composite component",
      (d) => (d.composite.components[0]!.indicator = "nope"),
      /unknown indicator/,
    ],
    [
      "inversion that contradicts goodWhen",
      (d) => (d.composite.components[3]!.invert = false),
      /invert must be true/,
    ],
    ["minComponents above component count", (d) => (d.composite.minComponents = 6), /minComponents/],
    ["composite key colliding with an indicator", (d) => (d.composite.key = "enquiries"), /collides/],
    ["unknown cut dimension", (d) => (d.cuts[1]!.dims = ["colour"]), /unknown dimension/],
    ["two national cuts", (d) => (d.cuts[1]!.dims = []), /exactly one cut/],
    [
      "suppression above the low-n threshold",
      (d) => {
        d.cuts[6]!.suppressBelow = 6;
      },
      /suppressBelow cannot exceed lowNBelow/,
    ],
    ["QA rule using a platform code", (d) => (d.qa.rules[0]!.code = "too_short"), /platform QA code/],
    [
      "combination with an impossible answer",
      (d) => {
        const r = d.qa.rules[0]!;
        if (r.kind === "combination") r.when[0]!.equals = "sideways";
      },
      /not an option/,
    ],
    [
      "all-neutral over a number question",
      (d) => {
        const r = d.qa.rules[1]!;
        if (r.kind === "all_neutral") r.questions.push("stock_days");
      },
      /has no neutral answer/,
    ],
    [
      "trend-vs-number with swapped types",
      (d) => {
        const r = d.qa.rules[2]!;
        if (r.kind === "trend_vs_number_change") r.trend = "bookings_week";
      },
      /must be a trend question/,
    ],
    ["minAnsweredForUsable above index questions", (d) => (d.qa.minAnsweredForUsable = 6), /index questions/],
    [
      "outcome hint for a value the platform doesn't have",
      (d) => (d.operational.outcome.extraction.optionHints = { maybe: "x" }),
      /not a platform outcome/,
    ],
    ["unknown top-level field", (d) => Object.assign(d, { colour: "teal" }), /colour/],
    ["bad key format", (d) => (d.questions[0]!.key = "Enquiries"), /lower_snake_case/],
    ["fractional weight", (d) => (d.composite.components[0]!.weightPct = 25.5), /int/i],
  ];

  it.each(cases)("rejects: %s", (_, mutate, expected) => {
    const d = v1();
    mutate(d);
    expect(errorsOf(d)).toMatch(expected);
  });
});

describe("sector-genericity", () => {
  // A toy survey for a different sector, with different question types, proves nothing in the
  // definition model is vehicle-specific.
  const kiranaSector: SectorConfig = {
    slug: "kirana_test",
    name: "Kirana (test)",
    status: "live",
    sortOrder: 99,
    nouns: { one: "store", other: "stores" },
    attributes: z.strictObject({ store_size: z.enum(["small", "large"]) }),
    vocab: {
      store_size: [
        { code: "small", label: "Small" },
        { code: "large", label: "Large" },
      ],
    },
    pulseSurvey: "kirana_pulse",
  };

  const text = (s: string) => ({ en: s, hinglish: s });
  const extraction = { instruction: "Capture the answer as said. Leave empty if not answered." };

  const kirana = {
    schemaVersion: 1,
    slug: "kirana_pulse",
    version: 1,
    sector: "kirana_test",
    kind: "pulse",
    cadence: "weekly",
    title: text("Kirana Pulse"),
    questions: [
      { key: "footfall_trend", type: "trend", label: text("Footfall"), ask: text("Footfall?"), extraction },
      {
        key: "top_category",
        type: "choice",
        label: text("Top category"),
        ask: text("What sold most?"),
        extraction,
        options: [
          { value: "staples", label: text("Staples") },
          { value: "snacks", label: text("Snacks") },
          { value: "personal_care", label: text("Personal care") },
        ],
      },
      { key: "customer_credit", type: "level", label: text("Credit"), ask: text("Credit?"), extraction },
      {
        key: "stockout_days",
        type: "number",
        label: text("Stock-outs"),
        ask: text("Days out of stock?"),
        extraction,
        min: 0,
        max: 7,
        integer: true,
        unit: "days",
      },
      { key: "why", type: "text", label: text("Why"), ask: text("Why?"), extraction, maxLength: 300 },
    ],
    operational: { outcome: { extraction }, callbackTime: { extraction } },
    indicators: [
      {
        key: "footfall",
        label: text("Footfall"),
        description: text("Footfall"),
        rule: { kind: "map", question: "footfall_trend", scores: { up: 100, same: 50, down: 0 } },
        goodWhen: "high",
      },
      {
        key: "credit",
        label: text("Credit"),
        description: text("Credit"),
        rule: { kind: "map", question: "customer_credit", scores: { high: 100, normal: 50, low: 0 } },
        goodWhen: "low",
      },
      {
        key: "stockouts",
        label: text("Stock-outs"),
        description: text("Stock-outs"),
        rule: {
          kind: "momentum",
          question: "stockout_days",
          tolerancePct: 0,
          score: { rose: 0, within: 50, fell: 100 },
        },
        goodWhen: "high",
      },
    ],
    composite: {
      key: "activity",
      label: text("Activity"),
      minComponents: 1,
      components: [
        { indicator: "footfall", weightPct: 60, invert: false },
        { indicator: "credit", weightPct: 20, invert: true },
        { indicator: "stockouts", weightPct: 20, invert: false },
      ],
    },
    dimensions: [
      { key: "size", label: text("Size"), source: { kind: "attribute", attribute: "store_size" } },
      { key: "state", label: text("State"), source: { kind: "geo", field: "state" } },
    ],
    cuts: [
      { key: "national", label: text("All"), dims: [], poolWeeks: 1, lowNBelow: null, suppressBelow: null },
      {
        key: "size_state",
        label: text("Size × state"),
        dims: ["size", "state"],
        poolWeeks: 2,
        lowNBelow: 5,
        suppressBelow: 3,
      },
    ],
    qa: { minDurationSec: 30, minConfidence: 0.5, minAnsweredForUsable: 1, rules: [] },
  } satisfies SurveyDefinitionInput;

  it("accepts a kirana survey with choice, text and different scoring", () => {
    const def = SurveyDefinition.parse(kirana);
    expect(validateSurveys([def], [kiranaSector])).toEqual([]);
  });

  it("catches a dimension on an attribute the sector doesn't have", () => {
    const def = SurveyDefinition.parse(kirana);
    const sector = { ...kiranaSector, vocab: {} };
    expect(validateSurveys([def], [sector]).join()).toMatch(/doesn't define/);
  });

  it("every registered survey belongs to a live sector", () => {
    for (const s of SURVEYS) expect(SECTORS.find((x) => x.slug === s.sector)?.status).toBe("live");
  });
});
