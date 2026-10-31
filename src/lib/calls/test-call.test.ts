import { describe, expect, it } from "vitest";
import { TEST_CALL_ESTIMATE_CENTS, type TestCallFacts, testCallRefusal, testCallUserData } from "./test-call";

const OWNER = "+919000012345";

const ok: TestCallFacts = {
  callingEnabled: true,
  scope: { mode: "testing", allowedNumbers: [OWNER] },
  phoneE164: OWNER,
  hasAgent: true,
  language: "Kannada",
  spentCents: 0,
  capCents: 100,
};

const code = (patch: Partial<TestCallFacts>) => testCallRefusal({ ...ok, ...patch })?.code ?? null;

describe("testCallRefusal", () => {
  it("allows a dealer on an allowed number", () => {
    expect(testCallRefusal(ok)).toBeNull();
  });

  it("refuses each reason, and names it", () => {
    expect(code({ phoneE164: null })).toBe("no_dealer");
    expect(code({ callingEnabled: false })).toBe("calling_off");
    expect(code({ phoneE164: "+919876543210" })).toBe("number_not_permitted");
    expect(code({ hasAgent: false })).toBe("no_agent");
    expect(testCallRefusal({ ...ok, callingEnabled: false })?.detail).toMatch(/^Calling is switched off/);
  });

  it("in production, allows any valid number", () => {
    expect(code({ phoneE164: "+919876543210", scope: { mode: "production", allowedNumbers: [] } })).toBeNull();
  });

  it("checks calling first", () => {
    expect(code({ callingEnabled: false, hasAgent: false })).toBe("calling_off");
  });

  it("stops at the spend cap: exactly at it is allowed, past it isn't", () => {
    expect(code({ spentCents: 100 - TEST_CALL_ESTIMATE_CENTS })).toBeNull();
    expect(code({ spentCents: 100 - TEST_CALL_ESTIMATE_CENTS + 1 })).toBe("spend_cap");
  });
});

describe("testCallUserData", () => {
  it("fills the agent's prompt, and has no call reference to link back with", () => {
    const data = testCallUserData({ businessName: "Vinayaka Hero Motors", brand: "Hero", city: "Bengaluru" });
    expect(data).toEqual({ dealer_name: "Vinayaka Hero Motors", brand: "Hero", city: "Bengaluru", repeat_call: "no" });
    expect(data).not.toHaveProperty("nabz_call_ref");
    expect(data).not.toHaveProperty("nabz_dealer_id");
  });
});
