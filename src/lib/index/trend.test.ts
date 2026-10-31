import { describe, expect, it } from "vitest";
import { extremeNote, type TrendPoint, trendAverage, weekWindow } from "./trend";

const weeks = weekWindow("2026-10-26", 8);
const pts = (values: (number | null)[]): TrendPoint[] =>
  values.map((value, i) => ({ weekStart: weeks[i]!, value, margin: null, n: value === null ? 0 : 50 }));

describe("weekWindow", () => {
  it("lists the weeks ending at the given one, oldest first", () => {
    expect(weekWindow("2026-10-26", 3)).toEqual(["2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(weeks).toHaveLength(8);
    expect(weeks[0]).toBe("2026-09-07");
  });
});

describe("trendAverage", () => {
  it("averages the weeks that have a value", () => {
    expect(trendAverage(pts([40, null, 60, null, null, null, null, 50]))).toEqual({ value: 50, weeks: 3 });
    expect(trendAverage(pts([null]))).toBeNull();
  });
});

describe("extremeNote", () => {
  it("says highest in N weeks when the last point beats every earlier one", () => {
    expect(extremeNote(pts([48, 50, 52, 51, 55, 57, 56, 60]))).toBe("Highest in 8 weeks");
  });

  it("names the week it is the highest since", () => {
    // 2026-W38 (2026-09-14) was 70; everything after it was lower than 60.
    expect(extremeNote(pts([48, 70, 52, 51, 55, 57, 56, 60]))).toBe("Highest since 2026-W38");
  });

  it("works for lows too, and skips weeks without answers", () => {
    expect(extremeNote(pts([60, 58, null, 57, 55, 56, 54, 40]))).toBe("Lowest in 7 weeks");
  });

  it("says nothing unless the last point beats at least the two weeks before it", () => {
    expect(extremeNote(pts([48, 50, 52, 51, 55, 57, 60, 58]))).toBeNull();
    expect(extremeNote(pts([null, null, null, null, null, null, 50, 60]))).toBeNull();
  });
});
