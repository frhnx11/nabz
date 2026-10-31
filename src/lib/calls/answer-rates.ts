import { ANSWER_STATUSES, type AnswerStatus } from "../domain/constants";
import type { Answers } from "../index/score";
import { indexQuestionKeys } from "../surveys/helpers";
import type { SurveyDefinition } from "../surveys/schema";
import { answerStatus } from "./answer-status";
import type { StoredExtraction } from "./report";

/**
 * How each question fares across calls: of the dealers who were asked it, how many answered, didn't
 * know, declined, and so on. A question many dealers can't or won't answer is a wording (or
 * respondent) problem, not a data problem; this is where ops sees it.
 */

/** Didn't know + declined at or above this share of the dealers asked marks a question for rewording. */
export const NEEDS_WORK_SHARE = 0.2;

/** Calls where the dealer went through (some of) the survey: only these say anything about questions. */
const SURVEYED = new Set(["completed", "partial"]);

export type AnswerRateCall = {
  derivedStatus: string;
  answers: Answers;
  extracted: Readonly<Record<string, StoredExtraction>>;
};

export type QuestionRate = {
  key: string;
  label: string;
  /** Feeds an index indicator. */
  index: boolean;
  /** Surveyed calls (completed or partial). */
  calls: number;
  /** Calls where the question was put to the dealer (everything except "not asked"). */
  asked: number;
  counts: Record<AnswerStatus, number>;
  /** Share of `asked` per status ("not asked" is a share of `calls`). */
  share: Record<AnswerStatus, number>;
  needsWork: boolean;
};

export function answerRates(definition: SurveyDefinition, calls: readonly AnswerRateCall[]): QuestionRate[] {
  const surveyed = calls.filter((c) => SURVEYED.has(c.derivedStatus));
  const indexKeys = new Set(indexQuestionKeys(definition));
  return definition.questions.map((q) => {
    const counts = Object.fromEntries(ANSWER_STATUSES.map((s) => [s, 0])) as Record<AnswerStatus, number>;
    for (const c of surveyed) counts[answerStatus(c.answers, c.extracted, q.key)] += 1;
    const asked = surveyed.length - counts.not_asked;
    const share = Object.fromEntries(
      ANSWER_STATUSES.map((s) => {
        const base = s === "not_asked" ? surveyed.length : asked;
        return [s, base > 0 ? counts[s] / base : 0];
      }),
    ) as Record<AnswerStatus, number>;
    return {
      key: q.key,
      label: q.label.en,
      index: indexKeys.has(q.key),
      calls: surveyed.length,
      asked,
      counts,
      share,
      needsWork: asked > 0 && share.dont_know + share.declined >= NEEDS_WORK_SHARE,
    };
  });
}
