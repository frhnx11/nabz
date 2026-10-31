import { describe, expect, it } from "vitest";
import { areaOf, decodeRestore, encodeRestore, shouldRemember, validLocation, validScroll } from "./area";

describe("areaOf", () => {
  it.each([
    ["/pulse", "client"],
    ["/pulse/preview", "client"],
    ["/heatmap", "client"],
    ["/ops", "ops"],
    ["/ops/dealers", "ops"],
    ["/ops/system", "ops"],
  ])("%s → %s", (path, area) => {
    expect(areaOf(path)).toBe(area);
  });

  it.each(["/", "/opsx", "/pulsed", "/api/ops/x", "/unknown"])("%s → null", (path) => {
    expect(areaOf(path)).toBeNull();
  });
});

describe("shouldRemember", () => {
  it("remembers real pages, not the bare /ops redirect", () => {
    expect(shouldRemember("/ops/dealers")).toBe(true);
    expect(shouldRemember("/heatmap")).toBe(true);
    expect(shouldRemember("/ops")).toBe(false);
    expect(shouldRemember("/")).toBe(false);
  });
});

describe("validLocation", () => {
  it("accepts in-area paths with their query", () => {
    expect(validLocation("ops", "/ops/dealers?q=hero&page=3")).toBe(
      "/ops/dealers?q=hero&page=3",
    );
    expect(validLocation("client", "/heatmap?week=2026-W44")).toBe("/heatmap?week=2026-W44");
  });

  it.each([
    ["ops", null],
    ["ops", ""],
    ["ops", "//evil.com/ops"],
    ["ops", "https://evil.com/ops"],
    ["ops", "/ops\\evil"],
    ["ops", "/ops/ system"],
    ["ops", "/pulse"], // other area
    ["client", "/ops/system"], // other area
    ["ops", "/ops"], // only a redirect
    ["client", "/unknown"],
    ["client", `/pulse?${"x".repeat(3000)}`],
  ] as const)("rejects %s %j", (area, value) => {
    expect(validLocation(area, value)).toBeNull();
  });
});

describe("validScroll", () => {
  it("accepts sane positions and rejects junk", () => {
    expect(validScroll("640")).toBe(640);
    expect(validScroll("12.7")).toBe(13);
    expect(validScroll("0")).toBe(0);
    for (const bad of [null, "", "-5", "NaN", "Infinity", "1e12", "abc"]) expect(validScroll(bad)).toBeNull();
  });
});

describe("restore requests", () => {
  it("round-trips a valid request", () => {
    const req = { to: "/ops/dealers?q=hero&page=3", y: 1240 };
    expect(decodeRestore(encodeRestore(req))).toEqual(req);
  });

  it.each([
    null,
    "",
    "not json",
    "[]",
    JSON.stringify({ to: "/ops/system" }),
    JSON.stringify({ to: "//evil.com", y: 0 }),
    JSON.stringify({ to: "/ops", y: 0 }),
    JSON.stringify({ to: "/ops/system", y: -10 }),
    JSON.stringify({ to: "/ops/system", y: "100" }),
  ])("rejects %j", (raw) => {
    expect(decodeRestore(raw)).toBeNull();
  });
});
