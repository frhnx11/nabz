import { describe, expect, it } from "vitest";
import { BATCH_NOT_ALLOWED, type CallingScope } from "../calling-policy";
import { CALL_BUDGET_CENTS, type PlanMember, planSet, type SetFacts } from "./set-plan";

const OWNER = "+919000012345";
const SCOPE: CallingScope = { mode: "testing", allowedNumbers: [OWNER] };
const agent = (label: string) => ({ agentVersionId: `v-${label}`, bolnaAgentId: `a-${label}`, label });

const facts: SetFacts = {
  callingEnabled: true,
  scope: SCOPE,
  agents: new Map([
    ["hi", agent("hi04")],
    ["kn", agent("kn01")],
  ]),
  spentCents: 0,
  capCents: 100,
  archived: false,
  anotherLive: false,
};

const member = (dealerId: string, patch: Partial<PlanMember> = {}): PlanMember => ({
  dealerId,
  phoneE164: OWNER,
  language: "hi",
  ...patch,
});

describe("planSet: testing and production", () => {
  const stranger = member("x", { phoneE164: "+919876543210" });

  it("in testing, refuses a batch with no allowed number, and says how to switch", () => {
    const plan = planSet([stranger], facts);
    expect(plan.refusal).toEqual({ code: "nobody", detail: BATCH_NOT_ALLOWED });
    expect(plan.refusal!.detail).toContain("NABZ_MODE=production");
  });

  it("in testing, calls the allowed rows of a mixed batch and skips the rest", () => {
    const plan = planSet([member("a"), stranger], facts);
    expect(plan.refusal).toBeNull();
    expect(plan.callCount).toBe(1);
  });

  it("in production, calls any number", () => {
    const plan = planSet([stranger], { ...facts, scope: { mode: "production", allowedNumbers: [] } });
    expect(plan.refusal).toBeNull();
    expect(plan.callCount).toBe(1);
  });
});

describe("planSet: a set calls every row, one at a time", () => {
  it("keeps rows that share a number, in order", () => {
    const plan = planSet([member("a"), member("b"), member("c", { language: "kn" })], facts);
    expect(plan.refusal).toBeNull();
    expect(plan.recipients).toEqual([
      { dealerId: "a", reason: null },
      { dealerId: "b", reason: null },
      { dealerId: "c", reason: null },
    ]);
    expect(plan.callCount).toBe(3);
    expect(plan.estimateCents).toBe(3 * CALL_BUDGET_CENTS);
  });

  it.each([
    ["not_permitted", member("x", { phoneE164: "+919876543210" })],
    ["no_agent", member("x", { language: "ml" })],
  ])("leaves out %s, with the reason", (reason, m) => {
    expect(planSet([m], facts).recipients[0]!.reason).toBe(reason);
  });

  it("counts who's left out", () => {
    const plan = planSet([member("a", { language: "ml" }), member("b", { language: "ml" }), member("c", { phoneE164: "+919876543210" }), member("d")], facts);
    expect(plan.excluded).toEqual([
      { reason: "no_agent", n: 2 },
      { reason: "not_permitted", n: 1 },
    ]);
    expect(plan.callCount).toBe(1);
  });

  it("says why it can't start", () => {
    const code = (patch: Partial<SetFacts>, members = [member("a")]) => planSet(members, { ...facts, ...patch }).refusal?.code ?? null;
    expect(code({ callingEnabled: false })).toBe("calling_off");
    expect(code({ archived: true })).toBe("archived");
    expect(code({ anotherLive: true })).toBe("open_set");
    expect(code({}, [])).toBe("nobody");
    expect(code({}, [member("a", { language: "ml" })])).toBe("nobody");
  });

  it("stops at the spend cap: exactly at it is allowed, past it isn't", () => {
    const code = (spentCents: number) => planSet([member("a")], { ...facts, spentCents }).refusal?.code ?? null;
    expect(code(100 - CALL_BUDGET_CENTS)).toBeNull();
    expect(code(100 - CALL_BUDGET_CENTS + 1)).toBe("spend_cap");
  });
});
