import { describe, expect, it } from "vitest";
import { maskPhone, normalisePhone } from "./phone";

describe("normalisePhone", () => {
  it.each([
    "+919000012345",
    "9000012345",
    "09000012345",
    "919000012345",
    "+91 90000 12345",
    "+91-90000-12345",
    "91-9000012345",
    "0091 9000012345",
    "(+91) 9000 012 345",
    "  9000012345  ",
  ])("normalises %j to the same mobile number", (input) => {
    expect(normalisePhone(input)).toEqual({ e164: "+919000012345", kind: "mobile" });
  });

  it("recognises landlines (STD code + number)", () => {
    expect(normalisePhone("0522-2345678")).toEqual({ e164: "+915222345678", kind: "landline" });
  });

  it.each([
    "",
    "12345",
    "+1 415 555 0100", // not Indian
    "+44 20 7946 0958",
    "+910123456789", // national number can't start with 0
    "+910000000001",
    "900001234", // 9 digits
    "90000123451", // 11 digits without leading 0
    "9000012345x",
    "+91+9000012345",
    "phone: 9000012345",
  ])("rejects %j", (input) => {
    expect(normalisePhone(input)).toBeNull();
  });

});

describe("maskPhone", () => {
  it("masks all but the country code and last four digits", () => {
    expect(maskPhone("+919000012345")).toBe("+91•••••2345");
  });
});
