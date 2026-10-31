import { describe, expect, it } from "vitest";
import { vehiclePulseV1 } from "../surveys/definitions/vehicle-pulse.v1";
import { SurveyDefinition } from "../surveys/schema";
import { scoreDealer } from "./score";

const def = vehiclePulseV1;
const scoreOf = (r: ReturnType<typeof scoreDealer>, key: string) =>
  r.indicators.find((i) => i.key === key);

describe("scoreDealer (Vehicle Pulse v1)", () => {
  it("weights all five components (hand-computed)", () => {
    // enquiries up 100, bookings same 50, stock fell (clearing) 100, discounts up 100 → inverted 0,
    // credit normal 50 → inverted 50. Demand = (25·100 + 25·50 + 20·100 + 15·0 + 15·50) / 100 = 65.
    const r = scoreDealer(
      def,
      {
        enquiries_trend: "up",
        bookings_trend: "same",
        stock_days: 20,
        discount_trend: "up",
        loan_rejections: "normal",
      },
      { stock_days: 30 },
    );
    expect(r.composite.value).toBe(65);
    expect(r.composite.usedWeightPct).toBe(100);
    expect(scoreOf(r, "discount_pressure")?.score).toBe(100); // published as pressure, not inverted
    expect(r.composite.components.find((c) => c.indicator === "discount_pressure")?.contribution).toBe(0);
  });

  it("renormalises over the components present (week 1 has no stock momentum)", () => {
    // 25·100 + 25·100 + 15·(100−50) + 15·(100−0) = 2500 + 2500 + 750 + 1500 = 7250 over 80 → 90.625
    const r = scoreDealer(def, {
      enquiries_trend: "up",
      bookings_trend: "up",
      stock_days: 20,
      discount_trend: "same",
      loan_rejections: "low",
    });
    expect(scoreOf(r, "stock")).toMatchObject({ score: null, missing: "needs_previous_week" });
    expect(r.composite.usedWeightPct).toBe(80);
    expect(r.composite.value).toBe(90.625);
  });

  it("needs at least two components for a Demand score", () => {
    const r = scoreDealer(def, { enquiries_trend: "down" });
    expect(r.composite).toMatchObject({ value: null, missing: "too_few_components" });
    expect(scoreDealer(def, { enquiries_trend: "down", bookings_trend: "down" }).composite.value).toBe(0);
  });

  it("treats unknown option values as not answered", () => {
    const r = scoreDealer(def, { enquiries_trend: "sideways", bookings_trend: 12 as unknown as string });
    expect(scoreOf(r, "enquiries")?.missing).toBe("not_answered");
    expect(scoreOf(r, "bookings")?.missing).toBe("not_answered");
    // Values that happen to be built-in object keys never score.
    expect(scoreOf(scoreDealer(def, { enquiries_trend: "constructor" }), "enquiries")?.score).toBeNull();
  });

  it.each([
    // [previous, now, expected stock score]: fell = clearing = 100, within = 50, rose = piling up = 0
    [100, 105, 50], // exactly +5% is within tolerance
    [100, 106, 0],
    [100, 95, 50], // exactly −5%
    [100, 94, 100],
    [0, 0, 50],
    [0, 5, 0],
    [5, 0, 100],
    [20, 20, 50],
  ])("stock momentum %d → %d scores %d", (prev, now, expected) => {
    const r = scoreDealer(def, { stock_days: now }, { stock_days: prev });
    expect(scoreOf(r, "stock")?.score).toBe(expected);
  });

  it("is sector-generic: scores any valid definition", () => {
    const text = (s: string) => ({ en: s, hinglish: s });
    const extraction = { instruction: "Capture the answer as said. Leave empty if not answered." };
    const kirana = SurveyDefinition.parse({
      schemaVersion: 1,
      slug: "kirana_pulse",
      version: 1,
      sector: "kirana_test",
      kind: "pulse",
      cadence: "weekly",
      title: text("Kirana"),
      questions: [
        { key: "footfall_trend", type: "trend", label: text("F"), ask: text("F?"), extraction },
        { key: "customer_credit", type: "level", label: text("C"), ask: text("C?"), extraction },
      ],
      operational: { outcome: { extraction }, callbackTime: { extraction } },
      indicators: [
        {
          key: "footfall",
          label: text("F"),
          description: text("F"),
          rule: { kind: "map", question: "footfall_trend", scores: { up: 100, same: 50, down: 0 } },
          goodWhen: "high",
        },
        {
          key: "credit",
          label: text("C"),
          description: text("C"),
          rule: { kind: "map", question: "customer_credit", scores: { high: 100, normal: 50, low: 0 } },
          goodWhen: "low",
        },
      ],
      composite: {
        key: "activity",
        label: text("A"),
        minComponents: 1,
        components: [
          { indicator: "footfall", weightPct: 70, invert: false },
          { indicator: "credit", weightPct: 30, invert: true },
        ],
      },
      dimensions: [],
      cuts: [
        { key: "national", label: text("All"), dims: [], poolWeeks: 1, lowNBelow: null, suppressBelow: null },
      ],
      qa: { minDurationSec: 30, minConfidence: 0.5, minAnsweredForUsable: 1, rules: [] },
    });
    // 70·100 + 30·(100 − 100) = 7000 / 100 = 70
    expect(
      scoreDealer(kirana, { footfall_trend: "up", customer_credit: "high" }).composite,
    ).toMatchObject({
      key: "activity",
      value: 70,
    });
  });
});
