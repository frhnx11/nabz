import { describe, expect, it } from "vitest";
import { answerStatus, parseMissingReason, surveyOutcome } from "./answer-status";

describe("answerStatus", () => {
  it("an effective answer always wins, whatever the extraction said", () => {
    expect(answerStatus({ stock_days: 30 }, {}, "stock_days")).toBe("answered");
    // An ops correction can fill a question the dealer didn't answer.
    expect(
      answerStatus(
        { loan_rejections: "high" },
        { loan_rejections: { raw: null, value: null, confidence: 0.9, valid: null, status: "dont_know" } },
        "loan_rejections",
      ),
    ).toBe("answered");
  });

  it("otherwise the stored reason", () => {
    const extracted = {
      loan_rejections: { raw: null, value: null, confidence: 0.9, valid: null, status: "dont_know" as const },
      discount_trend: { raw: null, value: null, confidence: 0.9, valid: null, status: "declined" as const },
    };
    expect(answerStatus({}, extracted, "loan_rejections")).toBe("dont_know");
    expect(answerStatus({}, extracted, "discount_trend")).toBe("declined");
  });

  it("falls back for calls stored before reasons: invalid reads as unclear, anything else as not asked", () => {
    expect(
      answerStatus({}, { stock_days: { raw: "?", value: null, confidence: 0.6, valid: false } }, "stock_days"),
    ).toBe("unclear");
    expect(answerStatus({}, {}, "stock_days")).toBe("not_asked");
    expect(answerStatus({ stock_days: "" }, {}, "stock_days")).toBe("not_asked");
    // A stale "answered" with no answer left (e.g. ops cleared it) isn't trusted.
    expect(
      answerStatus(
        {},
        { stock_days: { raw: "30", value: 30, confidence: 0.9, valid: true, status: "answered" } },
        "stock_days",
      ),
    ).toBe("not_asked");
  });
});

describe("parseMissingReason", () => {
  it("reads the platform reasons and nothing else", () => {
    expect(parseMissingReason("dont_know")).toBe("dont_know");
    expect(parseMissingReason(" Declined ")).toBe("declined");
    expect(parseMissingReason("not_asked")).toBe("not_asked");
    expect(parseMissingReason("not_answered")).toBeNull();
    expect(parseMissingReason("up")).toBeNull();
    expect(parseMissingReason(null)).toBeNull();
  });
});

describe("surveyOutcome", () => {
  it("didn't know and declined still complete a survey; a question never asked makes it partial", () => {
    expect(surveyOutcome(["answered", "answered", "answered", "answered", "dont_know"])).toBe("completed");
    expect(surveyOutcome(["answered", "declined", "unclear", "answered", "answered"])).toBe("completed");
    expect(surveyOutcome(["answered", "answered", "not_asked", "not_asked", "not_asked"])).toBe("partial");
  });
});
