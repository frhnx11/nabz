import { describe, expect, it } from "vitest";
import { parseNewDealer } from "./new-dealer";
import { escapeLike, parseSearch } from "./search";

describe("parseSearch", () => {
  it("returns nothing for empty input", () => {
    expect(parseSearch("")).toEqual([]);
    expect(parseSearch("   ")).toEqual([]);
    expect(parseSearch(null)).toEqual([]);
  });

  it("splits into lower-cased words, each a separate criterion", () => {
    expect(parseSearch("TVS  Gorakhpur").map((t) => t.text)).toEqual(["tvs", "gorakhpur"]);
  });

  it("maps brand labels to codes, including multi-word labels", () => {
    expect(parseSearch("royal")[0]?.brandCodes).toEqual(["royal_enfield"]);
    expect(parseSearch("enfield")[0]?.brandCodes).toEqual(["royal_enfield"]);
    expect(parseSearch("maruti")[0]?.brandCodes).toEqual(["maruti"]);
    expect(parseSearch("ho")[0]?.brandCodes).toEqual(["honda"]);
  });

  it("maps segment words", () => {
    expect(parseSearch("car")[0]?.segmentCodes).toEqual(["car"]);
    expect(parseSearch("two-wheeler")[0]?.segmentCodes).toEqual(["two_wheeler"]);
  });

  it("recognises phone fragments and tiers", () => {
    expect(parseSearch("2345")[0]?.digits).toBe("2345");
    expect(parseSearch("+91")[0]?.digits).toBeNull(); // too short to be useful
    expect(parseSearch("90000-12345")[0]?.digits).toBe("9000012345");
    expect(parseSearch("tier2")[0]?.tier).toBe(2);
    expect(parseSearch("3")[0]?.tier).toBe(3);
    expect(parseSearch("4")[0]?.tier).toBeNull();
  });

  it("caps the number of words", () => {
    expect(parseSearch("a b c d e f g h")).toHaveLength(6);
  });

  it("escapes LIKE wildcards", () => {
    expect(escapeLike("100%_off\\")).toBe("100\\%\\_off\\\\");
  });
});

describe("parseNewDealer", () => {
  const valid = {
    businessName: "  Shree Balaji TVS ",
    contactName: "Ramesh K.",
    contactRole: "",
    phone: "090000 12345",
    brand: "tvs",
    cityCode: "up-gorakhpur",
    language: "hi",
    notes: "",
  };

  it("normalises and derives everything it can", () => {
    const result = parseNewDealer(valid);
    expect(result).toEqual({
      ok: true,
      dealer: {
        businessName: "Shree Balaji TVS",
        contactName: "Ramesh K.",
        contactRole: "Sales manager",
        phoneE164: "+919000012345",
        brand: "tvs",
        segment: "two_wheeler",
        cityCode: "up-gorakhpur",
        language: "hi",
        notes: null,
      },
    });
  });

  it("derives the segment from the brand", () => {
    const result = parseNewDealer({ ...valid, brand: "hyundai", cityCode: "tn-chennai" });
    expect(result.ok && result.dealer.segment).toBe("car");
  });

  it("keeps the chosen call language, even when the city's state usually speaks another", () => {
    const result = parseNewDealer({ ...valid, cityCode: "tn-chennai", language: "en" });
    expect(result.ok && result.dealer.language).toBe("en");
    expect(parseNewDealer({ ...valid, language: "or" }).ok).toBe(true);
  });

  it.each([
    [{ businessName: "" }, "businessName", /showroom's name/],
    [{ phone: "" }, "phone", /Enter a phone/],
    [{ phone: "12345" }, "phone", /valid Indian/],
    [{ brand: "tesla" }, "brand", /Choose a brand/],
    [{ cityCode: "xx-nowhere" }, "cityCode", /Choose a city/],
    [{ language: "" }, "language", /Choose a language/],
    [{ language: "ur" }, "language", /Choose a language/],
    [{ language: "klingon" }, "language", /Choose a language/],
    [{ notes: "x".repeat(501) }, "notes", /500/],
  ])("rejects %j", (patch, field, message) => {
    const result = parseNewDealer({ ...valid, ...patch });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[field as keyof typeof result.errors]).toMatch(message);
  });
});
