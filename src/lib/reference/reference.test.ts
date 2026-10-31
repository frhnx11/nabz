import { describe, expect, it } from "vitest";
import { getSector, SECTORS, validateSectors, vocabLabel } from "../sectors/registry";
import { BRANDS, VehicleAttributes } from "../sectors/vehicles";
import { CITIES, getCity, REGIONS, STATES } from "./geo";

describe("geography", () => {
  it("keeps the mockup's state order", () => {
    expect(STATES.map((s) => s.code)).toEqual(["UP", "BR", "MP", "RJ", "MH", "GJ", "TN", "KA", "WB"]);
  });

  it("assigns every state a known region and language", () => {
    const regions = new Set(REGIONS.map((r) => r.code));
    for (const s of STATES) {
      expect(regions.has(s.region)).toBe(true);
    }
  });

  it("has unique city codes, valid tiers, and at least 3 cities per state", () => {
    expect(new Set(CITIES.map((c) => c.code)).size).toBe(CITIES.length);
    for (const c of CITIES) {
      expect([1, 2, 3]).toContain(c.tier);
      expect(c.code.startsWith(`${c.state.toLowerCase()}-`)).toBe(true);
    }
    for (const s of STATES) expect(CITIES.filter((c) => c.state === s.code).length).toBeGreaterThanOrEqual(3);
  });

  it("matches the official HRA classes for spot checks", () => {
    expect(getCity("mh-mumbai").tier).toBe(1); // X
    expect(getCity("up-gorakhpur").tier).toBe(2); // Y
    expect(getCity("br-patna").tier).toBe(2); // Y
    expect(getCity("br-gaya").tier).toBe(3); // not listed → Z
    expect(() => getCity("xx-nowhere")).toThrow();
  });
});

describe("sectors", () => {
  it("are valid and ordered, with vehicles live and the rest planned", () => {
    expect(validateSectors()).toEqual([]);
    expect(SECTORS.map((s) => [s.slug, s.status])).toEqual([
      ["vehicles", "live"],
      ["kirana", "planned"],
      ["building_materials", "planned"],
      ["pharma", "planned"],
      ["farm_inputs", "planned"],
    ]);
  });

  it("validates vehicle attributes, including brand/segment pairs", () => {
    expect(VehicleAttributes.safeParse({ brand: "tvs", segment: "two_wheeler" }).success).toBe(true);
    expect(VehicleAttributes.safeParse({ brand: "tvs", segment: "car" }).success).toBe(false);
    expect(VehicleAttributes.safeParse({ brand: "tesla", segment: "car" }).success).toBe(false);
    expect(VehicleAttributes.safeParse({ brand: "tata", segment: "car", colour: "red" }).success).toBe(false);
  });

  it("keeps the mockup's brand order and labels", () => {
    expect(BRANDS.map((b) => b.label)).toEqual([
      "TVS",
      "Hero",
      "Bajaj",
      "Honda",
      "Royal Enfield",
      "Maruti",
      "Mahindra",
      "Tata",
      "Hyundai",
    ]);
    expect(vocabLabel(getSector("vehicles"), "brand", "royal_enfield")).toBe("Royal Enfield");
  });

  it("flags duplicate slugs and live sectors without a survey", () => {
    const vehicles = getSector("vehicles");
    expect(validateSectors([vehicles, vehicles]).join()).toMatch(/duplicate slug/);
    expect(validateSectors([{ ...vehicles, pulseSurvey: null }]).join()).toMatch(/need a pulse survey/);
  });
});
