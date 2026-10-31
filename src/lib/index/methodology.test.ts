import { describe, expect, it } from "vitest";
import { latestSurvey } from "../surveys/registry";
import { questionRows, scoringRows } from "./methodology";

const def = latestSurvey("vehicle_pulse");

describe("questionRows", () => {
  it("lists every question, with what it feeds", () => {
    const rows = questionRows(def);
    expect(rows.map((r) => r.key)).toEqual(def.questions.map((q) => q.key));
    expect(rows.every((r) => r.en)).toBe(true);
    expect(rows.find((r) => r.key === "enquiries_trend")).toMatchObject({ feeds: ["Enquiries"], checks: null });
    expect(rows.find((r) => r.key === "stock_days")).toMatchObject({ feeds: ["Stock momentum"], checks: null });
  });

  it("says the bookings count isn't scored, and what it checks", () => {
    expect(questionRows(def).find((r) => r.key === "bookings_week")).toMatchObject({
      feeds: [],
      checks: "Bookings vs last week",
    });
  });
});

describe("scoringRows", () => {
  const rows = scoringRows(def);

  it("has every sub-index, and weights that add up to 100", () => {
    expect(rows.map((r) => r.key)).toEqual(def.indicators.map((i) => i.key));
    expect(rows.reduce((sum, r) => sum + (r.weightPct ?? 0), 0)).toBe(100);
  });

  it("writes out each scoring rule", () => {
    expect(rows.find((r) => r.key === "enquiries")?.scoring).toBe("Up 100 · Same 50 · Down 0");
    expect(rows.find((r) => r.key === "credit_stress")?.scoring).toBe("High 100 · Normal 50 · Low 0");
    expect(rows.find((r) => r.key === "stock")?.scoring).toBe("Fell over 5%: 100 · Within 5%: 50 · Rose over 5%: 0");
  });

  it("marks the sub-indices flipped inside the composite", () => {
    expect(rows.filter((r) => r.inverted).map((r) => r.key)).toEqual(["discount_pressure", "credit_stress"]);
  });
});
