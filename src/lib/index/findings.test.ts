import { describe, expect, it } from "vitest";
import { getSector } from "../sectors/registry";
import { vehiclePulseV1 as def } from "../surveys/definitions/vehicle-pulse.v1";
import { computeWeekIndex, type EngineCall } from "./engine";
import { keyFindings } from "./findings";
import { dimensionValueLabel } from "./labels";

const W = "2026-10-26";
const PREV = "2026-10-19";
const sector = getSector("vehicles");

let seq = 0;
function call(
  brand: string,
  state: string,
  answers: EngineCall["answers"],
  weekStart = W,
  dealerId = `r${++seq}`,
): EngineCall {
  return {
    dealerId,
    weekStart,
    at: `${weekStart}T06:00:00Z`,
    derivedStatus: "completed",
    qaState: "auto_ok",
    answeredCount: 4,
    answers,
    dims: {
      brand,
      segment: brand === "maruti" ? "car" : "two_wheeler",
      state,
      region: "north",
      city_tier: "2",
    },
  };
}

const up = { enquiries_trend: "up", bookings_trend: "up", discount_trend: "down", loan_rejections: "normal" };
const flat = {
  enquiries_trend: "same",
  bookings_trend: "same",
  discount_trend: "same",
  loan_rejections: "normal",
};

function input(calls: EngineCall[]) {
  return {
    definition: def,
    current: computeWeekIndex(def, W, calls),
    previous: computeWeekIndex(def, PREV, calls),
    label: (d: string, c: string) => dimensionValueLabel(def, sector, d, c),
    nouns: sector.nouns,
    spreadDimension: "brand",
    moverDimension: "state",
  };
}

describe("keyFindings", () => {
  it("states the clearest signal, the brand spread and the biggest state move", () => {
    const calls = [
      // 5 TVS dealers in UP, all up this week (demand (25·100 + 25·100 + 15·100 + 15·50) / 80 = 90.625;
      // no stock answer), flat last week.
      ...Array.from({ length: 5 }, (_, i) => call("tvs", "UP", up, W, `t${i}`)),
      ...Array.from({ length: 5 }, (_, i) => call("tvs", "UP", flat, PREV, `t${i}`)),
      // 5 Maruti dealers in MH, flat both weeks.
      ...Array.from({ length: 5 }, (_, i) => call("maruti", "MH", flat, W, `m${i}`)),
      ...Array.from({ length: 5 }, (_, i) => call("maruti", "MH", flat, PREV, `m${i}`)),
    ];
    expect(keyFindings(input(calls))).toEqual([
      "Enquiries: up at 50% of dealers, down at 0%.",
      "Demand index is strongest among TVS dealers (90.6) and weakest among Maruti dealers (50.0).",
      "The biggest move since last week was in Uttar Pradesh: the demand index rose 40.6 points to 90.6.",
    ]);
  });

  it("leaves out groups with a low-n warning, and findings it can't support", () => {
    const calls = [call("tvs", "UP", up), call("maruti", "MH", flat)];
    // Only the national signal: both brands are under 5 dealers, and there is no previous week.
    expect(keyFindings(input(calls))).toEqual(["Enquiries: up at 50% of dealers, down at 0%."]);
  });

  it("returns nothing for an empty week", () => {
    expect(keyFindings(input([]))).toEqual([]);
  });
});
