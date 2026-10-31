import { describe, expect, it } from "vitest";
import {
  addWeeks,
  istDate,
  weekBounds,
  weekLabel,
  weekStartFromLabel,
  weekStartOf,
} from "./week";

describe("environment", () => {
  it("runs tests in UTC so IST bugs can't hide behind the developer's timezone", () => {
    expect(new Date(0).getTimezoneOffset()).toBe(0);
  });
});

describe("weekStartOf", () => {
  it("puts Monday 00:00 IST in the new week", () => {
    // Monday 26 Oct 2026, 00:00 IST = Sunday 25 Oct, 18:30 UTC.
    expect(weekStartOf(new Date("2026-10-25T18:30:00Z"))).toBe("2026-10-26");
    expect(weekStartOf(new Date("2026-10-25T18:29:59.999Z"))).toBe("2026-10-19");
  });

  it("keeps Sunday 23:59 IST in the old week", () => {
    // Sunday 1 Nov 2026, 23:59:59 IST = 18:29:59 UTC.
    expect(weekStartOf(new Date("2026-11-01T18:29:59Z"))).toBe("2026-10-26");
    expect(weekStartOf(new Date("2026-11-01T18:30:00Z"))).toBe("2026-11-02");
  });

  it("uses the IST date, not the UTC date", () => {
    expect(istDate(new Date("2026-10-26T20:00:00Z"))).toBe("2026-10-27");
  });

  it("rejects invalid dates", () => {
    expect(() => weekStartOf(new Date("nope"))).toThrow();
  });
});

describe("week labels", () => {
  it("labels week 44 of 2026", () => {
    expect(weekLabel("2026-10-26")).toBe("2026-W44");
    expect(weekStartFromLabel("2026-W44")).toBe("2026-10-26");
  });

  it("handles 2026's 53rd week and the year boundary", () => {
    expect(weekLabel("2026-12-28")).toBe("2026-W53");
    expect(addWeeks("2026-12-28", 1)).toBe("2027-01-04");
    expect(weekLabel("2027-01-04")).toBe("2027-W01");
    expect(weekLabel(addWeeks(weekStartFromLabel("2027-W01"), -1))).toBe("2026-W53");
  });

  it("assigns early-January days to the previous ISO year when needed", () => {
    // Fri 1 Jan 2027 belongs to 2026-W53.
    expect(weekLabel(weekStartOf(new Date("2027-01-01T06:00:00Z")))).toBe("2026-W53");
  });

  it("rejects weeks that don't exist", () => {
    expect(() => weekStartFromLabel("2025-W53")).toThrow(/No such week/);
    expect(() => weekStartFromLabel("2026-W00")).toThrow(/No such week/);
    expect(() => weekStartFromLabel("2026-44")).toThrow(/Expected/);
  });

  it("round-trips every week of a decade", () => {
    let week = weekStartFromLabel("2025-W01");
    for (let i = 0; i < 520; i++) {
      expect(weekStartFromLabel(weekLabel(week))).toBe(week);
      week = addWeeks(week, 1);
    }
  });
});

describe("week starts", () => {
  it("validates Mondays and real dates", () => {
    expect(() => addWeeks("2026-10-27", 1)).toThrow(/Monday/);
  });

  it("bounds a week from Monday 00:00 IST to the next Monday", () => {
    const { start, end } = weekBounds("2026-10-26");
    expect(start.toISOString()).toBe("2026-10-25T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-11-01T18:30:00.000Z");
  });

  it("publishes the following Monday at 08:00 IST", () => {
  });
});
