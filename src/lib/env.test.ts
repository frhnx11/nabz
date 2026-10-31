import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://nabz:pw@127.0.0.1:5432/nabz_dev",
};

describe("parseEnv", () => {
  it("defaults every safety setting to the safe value", () => {
    const env = parseEnv(base);
    expect(env.CALLING_ENABLED).toBe(false);
    expect(env.BOLNA_DAILY_SPEND_CAP_USD).toBe(10);
  });

  it("treats empty values as unset", () => {
    expect(parseEnv({ ...base, CALLING_ENABLED: "" }).CALLING_ENABLED).toBe(false);
  });

  it.each(["0", "1", "yes", "TRUE", "on"])("rejects CALLING_ENABLED=%j (only exact true/false)", (value) => {
    expect(() => parseEnv({ ...base, CALLING_ENABLED: value })).toThrow(/CALLING_ENABLED/);
  });

  it("caps batch size and spend", () => {
    expect(() => parseEnv({ ...base, BOLNA_DAILY_SPEND_CAP_USD: "11" })).toThrow(/BOLNA_DAILY_SPEND_CAP_USD/);
  });

  it("requires Bolna credentials only when calling is enabled", () => {
    expect(() => parseEnv({ ...base, CALLING_ENABLED: "true" })).toThrow(/BOLNA_API_KEY/);
    const env = parseEnv({
      ...base,
      CALLING_ENABLED: "true",
      BOLNA_API_KEY: "bn-test",
    });
    expect(env.CALLING_ENABLED).toBe(true);
  });

  it("requires a postgres URL", () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: "mysql://x" })).toThrow(/DATABASE_URL/);
  });
});

describe("NABZ_MODE and ALLOWED_NUMBERS", () => {
  it("defaults to testing, with nobody allowed", () => {
    expect(parseEnv(base)).toMatchObject({ NABZ_MODE: "testing", ALLOWED_NUMBERS: [] });
  });

  it("reads the mode and normalises the numbers", () => {
    expect(
      parseEnv({ ...base, NABZ_MODE: "production", ALLOWED_NUMBERS: "9000012345, +91 90000 54321" }),
    ).toMatchObject({ NABZ_MODE: "production", ALLOWED_NUMBERS: ["+919000012345", "+919000054321"] });
  });

  it("refuses to start on an unknown mode or a bad number", () => {
    expect(() => parseEnv({ ...base, NABZ_MODE: "staging" })).toThrow(/NABZ_MODE/);
    expect(() => parseEnv({ ...base, ALLOWED_NUMBERS: "9000012345,nope" })).toThrow(/ALLOWED_NUMBERS/);
  });

  it("caps daily spend at $10 by default", () => {
    expect(parseEnv(base).BOLNA_DAILY_SPEND_CAP_USD).toBe(10);
  });
});
