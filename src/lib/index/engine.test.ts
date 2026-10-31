import { describe, expect, it } from "vitest";
import { vehiclePulseV1 as def } from "../surveys/definitions/vehicle-pulse.v1";
import { computeWeekIndex, type EngineCall, nationalOf } from "./engine";

const W = "2026-10-26";
const PREV = "2026-10-19";

let seq = 0;
function call(
  dealerId: string,
  answers: EngineCall["answers"],
  patch: Partial<EngineCall> = {},
): EngineCall {
  seq++;
  return {
    dealerId,
    weekStart: W,
    at: `2026-10-27T05:${String(seq % 60).padStart(2, "0")}:00Z`,
    derivedStatus: "completed",
    qaState: "auto_ok",
    answeredCount: Object.keys(answers).filter((k) => k !== "bookings_week").length,
    answers,
    dims: { brand: "hero", segment: "two_wheeler", state: "KA", region: "south", city_tier: "1" },
    ...patch,
  };
}

const up = { enquiries_trend: "up", bookings_trend: "up", discount_trend: "down", loan_rejections: "low" }; // Demand 100
const down = {
  enquiries_trend: "down",
  bookings_trend: "down",
  discount_trend: "up",
  loan_rejections: "high",
}; // Demand 0

const group = (idx: ReturnType<typeof computeWeekIndex>, cut: string, key: string) =>
  idx.cuts[cut]?.find((g) => g.key === key);

describe("computeWeekIndex", () => {
  it("averages dealers and computes a 95% margin (hand-computed)", () => {
    // Demand scores 100, 100, 0 → mean 66.67; SD = sqrt(((33.3²)·2 + 66.7²)/2) = 57.735; margin = 1.96·57.735/√3 = 65.33
    const idx = computeWeekIndex(def, W, [call("a", up), call("b", up), call("c", down)]);
    const nat = nationalOf(def, idx)!;
    expect(nat.n).toBe(3);
    expect(nat.composite.value).toBeCloseTo(66.667, 3);
    expect(nat.composite.margin).toBeCloseTo(65.333, 2);
    expect(nat.indicators.enquiries?.value).toBeCloseTo(66.667, 3);
    expect(nat.indicators.enquiries?.breakdown).toEqual({ up: 2 / 3, same: 0, down: 1 / 3 });
    // Discount pressure is published as pressure (not inverted): down, down, up → 0, 0, 100.
    expect(nat.indicators.discount_pressure?.value).toBeCloseTo(33.333, 3);
  });

  it("counts one call per dealer: the newest usable one replaces the old, even with fewer answers", () => {
    const idx = computeWeekIndex(def, W, [
      call("a", up, { at: "2026-10-27T05:00:00Z" }),
      call("a", { enquiries_trend: "down", bookings_trend: "down", stock_days: 30 }, { derivedStatus: "partial", at: "2026-10-28T05:00:00Z" }),
      call("b", up, { at: "2026-10-28T05:00:00Z" }),
      call("b", down, { at: "2026-10-27T05:00:00Z" }), // older, whatever order it arrives in
    ]);
    const nat = nationalOf(def, idx)!;
    expect(nat.n).toBe(2);
    expect(nat.indicators.enquiries?.breakdown).toEqual({ up: 1 / 2, same: 0, down: 1 / 2 });
  });

  it("a newer call that can't count replaces nothing", () => {
    const idx = computeWeekIndex(def, W, [
      call("a", up, { at: "2026-10-27T05:00:00Z" }),
      call("a", down, { at: "2026-10-28T05:00:00Z", qaState: "needs_review" }),
      call("a", down, { at: "2026-10-29T05:00:00Z", qaState: "excluded" }),
      call("a", { enquiries_trend: "down" }, { at: "2026-10-30T05:00:00Z" }),
    ]);
    const nat = nationalOf(def, idx)!;
    expect(nat.n).toBe(1);
    expect(nat.composite.value).toBe(100);
  });

  it("ignores unusable calls: held for review, excluded, or too few answers", () => {
    const idx = computeWeekIndex(def, W, [
      call("a", up),
      call("b", down, { qaState: "needs_review" }),
      call("c", down, { qaState: "excluded" }),
      call("d", { enquiries_trend: "down" }),
      call("e", down, { qaState: "approved" }),
    ]);
    expect(idx.dealers).toBe(2);
    expect(nationalOf(def, idx)!.composite.value).toBe(50);
  });

  it("uses the dealer's previous week for stock momentum", () => {
    const idx = computeWeekIndex(def, W, [
      call("a", { ...up, stock_days: 30 }, { weekStart: PREV }),
      call("a", { ...up, stock_days: 20 }), // stock clearing → 100
      call("b", { ...up, stock_days: 20 }), // no previous week → no stock score
    ]);
    const nat = nationalOf(def, idx)!;
    expect(nat.indicators.stock).toMatchObject({ value: 100, n: 1 });
  });

  it("hides brand × state cells under 3 dealers and pools two weeks for them", () => {
    const calls = [
      call("a", up),
      call("b", up),
      call("c", down, { weekStart: PREV }), // last week only: counts in the pooled cell, not in this week's brand cut
    ];
    const idx = computeWeekIndex(def, W, calls);
    const cell = group(idx, "brand_state", "brand=hero;state=KA")!;
    expect(cell).toMatchObject({ n: 3, suppressed: false, lowN: true });
    expect(cell.composite.value).toBeCloseTo(66.667, 3);
    const brand = group(idx, "brand", "brand=hero")!;
    expect(brand).toMatchObject({ n: 2, lowN: true, suppressed: false });

    const thin = computeWeekIndex(def, W, [call("a", up), call("b", up)]);
    const hidden = group(thin, "brand_state", "brand=hero;state=KA")!;
    expect(hidden).toMatchObject({ n: 2, suppressed: true });
    expect(hidden.composite.value).toBeNull();
    expect(hidden.indicators.enquiries?.value).toBeNull();
  });

  it("holds every indicator to the cell minimum on its own n", () => {
    // Five dealers in the cell, but only one of them answered loans: that one answer must not show.
    const noLoans = { enquiries_trend: "up", bookings_trend: "up", discount_trend: "down" };
    const idx = computeWeekIndex(def, W, [
      call("a", up),
      call("b", noLoans),
      call("c", noLoans),
      call("d", noLoans),
      call("e", noLoans),
    ]);
    const cell = group(idx, "brand_state", "brand=hero;state=KA")!;
    expect(cell).toMatchObject({ n: 5, suppressed: false, lowN: false });
    expect(cell.indicators.credit_stress).toEqual({
      value: null,
      margin: null,
      n: 1,
      breakdown: null,
      lowN: true,
      suppressed: true,
    });
    expect(cell.indicators.enquiries).toMatchObject({ value: 100, n: 5, lowN: false, suppressed: false });
    expect(cell.composite).toMatchObject({ value: 100, n: 5, suppressed: false });

    // Three answered: shown, with its own low-n warning; cuts without thresholds never hide it.
    const three = computeWeekIndex(def, W, [call("a", up), call("b", up), call("c", up), call("d", noLoans), call("e", noLoans)]);
    expect(group(three, "brand_state", "brand=hero;state=KA")!.indicators.credit_stress).toMatchObject({
      value: 0,
      n: 3,
      lowN: true,
      suppressed: false,
    });
    expect(nationalOf(def, idx)!.indicators.credit_stress).toMatchObject({ value: 0, n: 1, lowN: false, suppressed: false });

    // Nobody answered is "no value", not "hidden".
    expect(group(idx, "brand_state", "brand=hero;state=KA")!.indicators.stock).toMatchObject({
      value: null,
      n: 0,
      suppressed: false,
    });
  });

  it("pooled cells use each dealer's latest week, once", () => {
    const idx = computeWeekIndex(def, W, [
      call("a", down, { weekStart: PREV }),
      call("a", up), // this week replaces last week for the same dealer
      call("b", up),
      call("c", up),
    ]);
    expect(group(idx, "brand_state", "brand=hero;state=KA")).toMatchObject({ n: 3 });
    expect(group(idx, "brand_state", "brand=hero;state=KA")!.composite.value).toBe(100);
  });

  it("groups by every dimension, keyed canonically", () => {
    const idx = computeWeekIndex(def, W, [
      call("a", up),
      call("b", down, {
        dims: { brand: "maruti", segment: "car", state: "MH", region: "west", city_tier: "1" },
      }),
    ]);
    expect(idx.cuts.brand?.map((g) => g.key)).toEqual(["brand=hero", "brand=maruti"]);
    expect(idx.cuts.segment?.map((g) => g.key)).toEqual(["segment=car", "segment=two_wheeler"]);
    expect(idx.cuts.region?.map((g) => g.values.region)).toEqual(["south", "west"]);
    expect(group(idx, "segment", "segment=car")!.composite.value).toBe(0);
  });

  it("returns empty cuts for a week with no calls", () => {
    const idx = computeWeekIndex(def, W, []);
    expect(idx.dealers).toBe(0);
    expect(nationalOf(def, idx)).toBeNull();
  });
});
