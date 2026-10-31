import { describe, expect, it } from "vitest";
import {
  formatChange,
  formatCost,
  formatDuration,
  formatIndex,
  formatIstDateTime,
  formatIstDay,
  formatWeekRange,
  formatWeekShort,
  formatWeekTitle,
} from "./format";

describe("formatDuration", () => {
  it.each([
    [0, "0:00"],
    [7, "0:07"],
    [78, "1:18"],
    [78.4, "1:18"],
    [600, "10:00"],
    [3723, "1:02:03"],
  ])("%s s → %s", (s, expected) => {
    expect(formatDuration(s)).toBe(expected);
  });

  it("shows a dash when unknown", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
  });
});

describe("formatCost", () => {
  it("converts US cents to rupees at the fixed rate and keeps the dollar amount", () => {
    expect(formatCost(8.04)).toEqual({ inr: "₹7.40", usd: "$0.0804" });
    expect(formatCost(150)).toEqual({ inr: "₹138.00", usd: "$1.50" });
    expect(formatCost(0)).toEqual({ inr: "₹0.00", usd: "$0.00" });
  });

  it("uses Indian digit grouping", () => {
    expect(formatCost(150_000).inr).toBe("₹1,38,000.00");
  });

  it("shows dashes when unknown", () => {
    expect(formatCost(null)).toEqual({ inr: "—", usd: "—" });
  });
});

describe("formatIstDateTime", () => {
  it("formats in IST regardless of the machine timezone (tests run in UTC)", () => {
    expect(formatIstDateTime(new Date("2026-11-02T06:12:00Z"))).toBe("2 Nov 2026, 11:42");
    // 20:00 UTC is already the next day in India.
    expect(formatIstDateTime(new Date("2026-11-01T20:00:00Z"))).toBe("2 Nov 2026, 01:30");
  });

  it("shows a dash for missing or invalid dates", () => {
    expect(formatIstDateTime(null)).toBe("—");
    expect(formatIstDateTime(new Date("nope"))).toBe("—");
  });
});

describe("index and week formatting", () => {
  it("formats index values and changes to one decimal, with a true minus sign", () => {
    expect(formatIndex(58.44)).toBe("58.4");
    expect(formatIndex(null)).toBe("—");
    expect(formatChange(4.25)).toBe("+4.3");
    expect(formatChange(-1.94)).toBe("−1.9");
    expect(formatChange(0.04)).toBe("0.0");
    expect(formatChange(-0.04)).toBe("0.0");
  });

  it("names weeks by their ISO week and Monday-to-Sunday dates", () => {
    expect(formatWeekTitle("2026-10-26")).toBe("Week 44, 2026");
    expect(formatWeekShort("2026-10-26")).toBe("W44");
    expect(formatWeekShort("2026-01-05")).toBe("W02");
    expect(formatWeekRange("2026-10-26")).toBe("26 Oct – 1 Nov");
    expect(formatWeekTitle("2026-12-28")).toBe("Week 53, 2026");
  });
});

describe("formatIstDay", () => {
  it("shows the IST calendar day", () => {
    expect(formatIstDay(new Date("2026-10-26T04:30:00Z"))).toBe("26 Oct");
    expect(formatIstDay(new Date("2026-10-26T20:00:00Z"))).toBe("27 Oct");
    expect(formatIstDay(null)).toBe("—");
  });
});
