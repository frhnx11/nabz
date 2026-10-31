import { describe, expect, it } from "vitest";
import { vehiclePulseV1 } from "../surveys/definitions/vehicle-pulse.v1";
import { evaluateQa, type QaInput } from "./qa";

const clean = {
  enquiries_trend: "up",
  bookings_trend: "up",
  bookings_week: 40,
  stock_days: 18,
  discount_trend: "same",
  loan_rejections: "normal",
};

function input(patch: Partial<QaInput> = {}): QaInput {
  return { derivedStatus: "completed", durationS: 85, answers: clean, extracted: {}, ...patch };
}

const codes = (r: ReturnType<typeof evaluateQa>) => r.flags.map((f) => f.code);

describe("evaluateQa", () => {
  it("passes a clean completed call", () => {
    const r = evaluateQa(vehiclePulseV1, input(), { bookings_week: 36, stock_days: 20 });
    expect(r).toEqual({ flags: [], answeredCount: 5, qaState: "auto_ok" });
  });

  it("does nothing for calls nobody answered", () => {
    expect(evaluateQa(vehiclePulseV1, input({ derivedStatus: "no_answer", answers: {} }), null)).toEqual({
      flags: [],
      answeredCount: 0,
      qaState: "auto_ok",
    });
  });

  it("excludes a 'completed' call with no answers", () => {
    const r = evaluateQa(vehiclePulseV1, input({ answers: {} }), null);
    expect(codes(r)).toContain("false_completed");
    expect(r.qaState).toBe("excluded");
  });

  it("holds too-short calls and uncertain or invalid answers", () => {
    expect(evaluateQa(vehiclePulseV1, input({ durationS: 31 }), null).qaState).toBe("needs_review");
    const r = evaluateQa(
      vehiclePulseV1,
      input({
        extracted: {
          stock_days: { raw: "do mahine", value: 60, confidence: 0.4, valid: true },
          discount_trend: { raw: "?", value: null, confidence: 0.9, valid: false },
        },
      }),
      null,
    );
    expect(r.flags).toEqual([
      { code: "low_confidence", severity: "hold", questionKey: "stock_days", detail: null },
      { code: "invalid_answer", severity: "hold", questionKey: "discount_trend", detail: null },
    ]);
  });

  it("holds out-of-range numbers and notes missing answers", () => {
    const r = evaluateQa(vehiclePulseV1, input({ answers: { ...clean, stock_days: 600 } }), null);
    expect(codes(r)).toContain("out_of_range");
    const partial = evaluateQa(
      vehiclePulseV1,
      input({
        derivedStatus: "partial",
        answers: { enquiries_trend: "up", loan_rejections: "low" },
        extracted: {
          bookings_trend: { raw: null, value: null, confidence: 0.9, valid: null, status: "dont_know" },
          stock_days: { raw: "kabhi kam kabhi zyada", value: null, confidence: 0.8, valid: false },
        },
      }),
      null,
    );
    expect(partial.answeredCount).toBe(2);
    expect(partial.flags).toContainEqual({
      code: "missing_answers",
      severity: "info",
      questionKey: null,
      detail:
        "3 of 5 unanswered (Bookings vs last week: didn't know; Days of stock: unclear; Discounts and offers: not asked)",
    });
    // Missing answers alone are only noted; the unparseable stock answer is what holds it.
    expect(partial.flags.find((f) => f.code === "missing_answers")?.severity).toBe("info");
    expect(partial.qaState).toBe("needs_review");
  });

  it("applies the survey's own rules", () => {
    expect(
      codes(evaluateQa(vehiclePulseV1, input({ answers: { ...clean, enquiries_trend: "down" } }), null)),
    ).toContain("contradiction");
    const neutral = {
      ...clean,
      enquiries_trend: "same",
      bookings_trend: "same",
      discount_trend: "same",
      loan_rejections: "normal",
    };
    expect(codes(evaluateQa(vehiclePulseV1, input({ answers: neutral }), null))).toContain("straightlining");
    // Said bookings up, but the count fell from 40 to 20.
    expect(
      codes(
        evaluateQa(vehiclePulseV1, input({ answers: { ...clean, bookings_week: 20 } }), {
          bookings_week: 40,
        }),
      ),
    ).toContain("bookings_mismatch");
    // Within ±5% is not a contradiction.
    expect(
      codes(
        evaluateQa(vehiclePulseV1, input({ answers: { ...clean, bookings_week: 39 } }), {
          bookings_week: 40,
        }),
      ),
    ).not.toContain("bookings_mismatch");
    expect(
      codes(evaluateQa(vehiclePulseV1, input({ answers: { ...clean, stock_days: 70 } }), { stock_days: 18 })),
    ).toContain("stock_jump");
    // Warnings don't hold the call.
    expect(evaluateQa(vehiclePulseV1, input({ answers: neutral }), null).qaState).toBe("auto_ok");
  });
});
