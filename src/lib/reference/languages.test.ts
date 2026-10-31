import { describe, expect, it } from "vitest";
import {
  CALL_LANGUAGE_CODES,
  CALL_LANGUAGES,
  languageName,
} from "./languages";

describe("call languages", () => {
  it("lists each language once, as a BCP 47 code", () => {
    expect(new Set(CALL_LANGUAGE_CODES).size).toBe(CALL_LANGUAGES.length);
    for (const code of CALL_LANGUAGE_CODES) expect(code).toMatch(/^[a-z]{2}$/);
  });

  it("names languages, falling back to the code", () => {
    expect(languageName("kn")).toBe("Kannada");
    expect(languageName("xx")).toBe("xx");
  });
});
