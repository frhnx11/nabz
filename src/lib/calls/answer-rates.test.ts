import { describe, expect, it } from "vitest";
import { vehiclePulseV1 as def } from "../surveys/definitions/vehicle-pulse.v1";
import { type AnswerRateCall, answerRates } from "./answer-rates";

const all = {
  enquiries_trend: "up",
  bookings_trend: "same",
  bookings_week: 30,
  stock_days: 20,
  discount_trend: "same",
  loan_rejections: "normal",
};
const { loan_rejections: _loans, ...noLoans } = all;
const dontKnowLoans = {
  loan_rejections: { raw: null, value: null, confidence: 0.9, valid: null, status: "dont_know" as const },
};

const call = (patch: Partial<AnswerRateCall>): AnswerRateCall => ({
  derivedStatus: "completed",
  answers: all,
  extracted: {},
  ...patch,
});

describe("answerRates", () => {
  const rates = answerRates(def, [
    call({}),
    call({ answers: noLoans, extracted: dontKnowLoans }),
    call({ answers: noLoans, extracted: dontKnowLoans }),
    call({ answers: noLoans, extracted: dontKnowLoans }),
    // Partial: ended after two questions, so the rest were never asked.
    call({ derivedStatus: "partial", answers: { enquiries_trend: "down", bookings_trend: "down" } }),
    // Not surveyed: says nothing about questions.
    call({ derivedStatus: "no_answer", answers: {} }),
    call({ derivedStatus: "callback", answers: {} }),
  ]);
  const of = (key: string) => rates.find((r) => r.key === key)!;

  it("counts only surveyed calls, and shares are of the dealers asked", () => {
    const loans = of("loan_rejections");
    expect(loans).toMatchObject({ index: true, calls: 5, asked: 4 });
    expect(loans.counts).toEqual({ answered: 1, dont_know: 3, declined: 0, not_asked: 1, unclear: 0 });
    expect(loans.share.answered).toBe(0.25);
    expect(loans.share.dont_know).toBe(0.75);
    expect(loans.share.not_asked).toBe(0.2); // of all surveyed calls
  });

  it("marks a question many can't answer for rewording, and not one that's simply answered", () => {
    expect(of("loan_rejections").needsWork).toBe(true);
    expect(of("enquiries_trend")).toMatchObject({ asked: 5, needsWork: false });
    expect(of("enquiries_trend").share.answered).toBe(1);
  });

  it("covers every question, flagging the ones outside the index", () => {
    expect(rates.map((r) => r.key)).toEqual(def.questions.map((q) => q.key));
    expect(of("bookings_week").index).toBe(false);
  });

  it("is empty-safe", () => {
    const none = answerRates(def, []);
    expect(none[0]).toMatchObject({ calls: 0, asked: 0, needsWork: false });
    expect(none[0]!.share.answered).toBe(0);
  });
});
