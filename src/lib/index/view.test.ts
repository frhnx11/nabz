import { describe, expect, it } from "vitest";
import { addWeeks, weekBounds } from "../domain/week";
import { getSector } from "../sectors/registry";
import { latestSurvey } from "../surveys/registry";
import { dealerDims } from "./dims";
import type { EngineCall } from "./engine";
import { dimensionValueLabel, dimensionValues, geoDimension, primaryAttributeDimension } from "./labels";
import { buildPulseView, HISTORY_WEEKS, parseWeekParam } from "./view";

const NOW = new Date("2026-10-27T12:00:00Z"); // Tuesday of 2026-W44
const sector = getSector("vehicles");
const def = latestSurvey("vehicle_pulse");

/** Four dealers in two states and three cities, answering each of the 8 weeks up to NOW's. */
function inputs() {
  const dealers = [
    { id: "d1", city: "ka-bengaluru", state: "KA", brand: "hero" },
    { id: "d2", city: "ka-mysuru", state: "KA", brand: "hero" },
    { id: "d3", city: "mh-pune", state: "MH", brand: "tvs" },
    { id: "d4", city: "mh-pune", state: "MH", brand: "hero" },
  ];
  const calls: EngineCall[] = dealers.flatMap((d) =>
    Array.from({ length: 8 }, (_, i): EngineCall => {
      const weekStart = addWeeks("2026-10-26", -i);
      return {
        dealerId: d.id,
        weekStart,
        at: weekBounds(weekStart).start.toISOString(),
        derivedStatus: "completed",
        qaState: "auto_ok",
        answeredCount: 5,
        answers: {
          enquiries_trend: "up",
          bookings_trend: "same",
          bookings_week: 20 + i,
          stock_days: 25,
          discount_trend: "same",
          loan_rejections: "normal",
        },
        dims: dealerDims(def, { brand: d.brand, segment: "two_wheeler" }, { state: d.state, region: "south", cityTier: 1 }),
      };
    }),
  );
  return { definition: def, calls, cityOf: new Map(dealers.map((d) => [d.id, d.city])) };
}

describe("dealerDims", () => {
  it("reads attribute and geo dimensions from the survey definition", () => {
    expect(
      dealerDims(
        def,
        { brand: "hero", segment: "two_wheeler" },
        { state: "KA", region: "south", cityTier: 1 },
      ),
    ).toEqual({
      brand: "hero",
      segment: "two_wheeler",
      state: "KA",
      region: "south",
      city_tier: "1",
    });
    expect(dealerDims(def, {}, { state: "KA", region: "south", cityTier: 1 })).not.toHaveProperty(
      "brand",
    );
  });
});

describe("labels", () => {
  it("labels dimension values in their natural order", () => {
    expect(dimensionValueLabel(def, sector, "brand", "royal_enfield")).toBe("Royal Enfield");
    expect(dimensionValueLabel(def, sector, "state", "WB")).toBe("West Bengal");
    expect(dimensionValueLabel(def, sector, "state", "WB", "short")).toBe("W Bengal");
    expect(dimensionValueLabel(def, sector, "city_tier", "3")).toBe("Tier 3 towns");
    expect(dimensionValueLabel(def, sector, "region", "north")).toBe("North");
    expect(dimensionValues(def, sector, "brand")[0]).toBe("tvs");
    expect(dimensionValues(def, sector, "city_tier")).toEqual(["1", "2", "3"]);
    expect(primaryAttributeDimension(def)).toBe("brand");
    expect(geoDimension(def, "state")).toBe("state");
  });
});

describe("parseWeekParam", () => {
  const current = "2026-10-26";
  it("accepts a week label inside the kept history", () => {
    expect(parseWeekParam("2026-W40", current)).toBe("2026-09-28");
    expect(parseWeekParam("2026-W44", current)).toBe(current);
  });
  it("rejects future weeks, too-old weeks and junk", () => {
    expect(parseWeekParam("2026-W45", current)).toBeNull();
    expect(parseWeekParam(`2026-W${44 - HISTORY_WEEKS}`, current)).toBeNull();
    expect(parseWeekParam("garbage", current)).toBeNull();
    expect(parseWeekParam(["2026-W40"], current)).toBeNull();
    expect(parseWeekParam(undefined, current)).toBeNull();
  });
});

describe("buildPulseView", () => {
  const data = inputs();

  it("defaults to the running week, with an 8-week trend and coverage", () => {
    const v = buildPulseView(data, { now: NOW })!;
    expect(v).toMatchObject({
      week: "2026-10-26",
      latestWeek: "2026-10-26",
      inProgress: true,
      hasNextWeek: false,
    });
    expect(v.hasPrevWeek).toBe(true);
    expect(v.points).toHaveLength(8);
    expect(v.points.every((p) => p.value !== null)).toBe(true);
    expect(v.coverage.dealers).toBe(v.index.dealers);
    expect(v.coverage.states).toBe(2);
    expect(v.coverage.cities).toBe(3);
  });

  it("shows an earlier week, closed, with a next week to go to", () => {
    const v = buildPulseView(data, { now: NOW, week: "2026-09-28" })!;
    expect(v).toMatchObject({ week: "2026-09-28", inProgress: false, hasNextWeek: true });
    expect(v.points.at(-1)!.weekStart).toBe("2026-09-28");
  });

  it("falls back to the latest week with answers, and is null with no answers at all", () => {
    const lastWeekOnly = { ...data, calls: data.calls.filter((c) => c.weekStart < "2026-10-26") };
    expect(buildPulseView(lastWeekOnly, { now: NOW })).toMatchObject({
      week: "2026-10-19",
      inProgress: false,
    });
    expect(buildPulseView({ ...data, calls: [] }, { now: NOW })).toBeNull();
  });
});
