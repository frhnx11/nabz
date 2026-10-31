import type { Answers } from "../index/score";
import { indexQuestionKeys, neutralValue } from "../surveys/helpers";
import type { SurveyDefinition } from "../surveys/schema";
import { ANSWER_STATUS_LABEL, answerStatus } from "./answer-status";
import type { StoredExtraction } from "./report";

/**
 * Automatic quality checks on one call, from the survey definition. Pure: ingestion (real calls) and
 * tests both use it, so every call is judged by the same rules.
 *
 * Severity decides what happens to the call: "exclude" → never counted; "hold" → held for ops review;
 * "warn"/"info" → counted, but visible in the call's data.
 */

export type QaFlag = {
  code: string;
  severity: "hold" | "warn" | "info" | "exclude";
  questionKey: string | null;
  detail: string | null;
};

export type QaInput = {
  derivedStatus: string;
  durationS: number | null;
  answers: Answers;
  extracted: Readonly<Record<string, StoredExtraction>>;
};

export type QaResult = {
  flags: QaFlag[];
  answeredCount: number;
  qaState: "auto_ok" | "needs_review" | "excluded";
};

/** Statuses where the dealer actually talked to the agent (only these carry answers to check). */
const CONVERSED = new Set(["completed", "partial", "refused", "callback", "wrong_number"]);

export function evaluateQa(definition: SurveyDefinition, input: QaInput, previous: Answers | null): QaResult {
  const flags: QaFlag[] = [];
  const indexKeys = indexQuestionKeys(definition);
  const questions = new Map(definition.questions.map((q) => [q.key, q]));
  const answered = (key: string) => input.answers[key] !== undefined && input.answers[key] !== "";
  const answeredCount = indexKeys.filter(answered).length;

  if (!CONVERSED.has(input.derivedStatus)) {
    return { flags, answeredCount: 0, qaState: "auto_ok" };
  }

  // Platform checks.
  if (input.derivedStatus === "completed" && answeredCount === 0) {
    flags.push({ code: "false_completed", severity: "exclude", questionKey: null, detail: null });
  }
  if (
    answeredCount >= definition.qa.minAnsweredForUsable &&
    input.durationS !== null &&
    input.durationS < definition.qa.minDurationSec
  ) {
    flags.push({
      code: "too_short",
      severity: "hold",
      questionKey: null,
      detail: `${Math.round(input.durationS)} s, under ${definition.qa.minDurationSec} s`,
    });
  }
  for (const key of indexKeys) {
    const ex = input.extracted[key];
    if (!ex) continue;
    if (ex.valid === false) {
      flags.push({ code: "invalid_answer", severity: "hold", questionKey: key, detail: null });
    } else if (ex.confidence !== null && ex.confidence < definition.qa.minConfidence) {
      flags.push({ code: "low_confidence", severity: "hold", questionKey: key, detail: null });
    }
  }
  for (const q of definition.questions) {
    const v = input.answers[q.key];
    if (q.type === "number" && typeof v === "number" && (v < q.min || v > q.max)) {
      flags.push({
        code: "out_of_range",
        severity: "hold",
        questionKey: q.key,
        detail: `${v} not in ${q.min}–${q.max}`,
      });
    }
  }
  if (answeredCount > 0 && answeredCount < indexKeys.length) {
    const why = indexKeys
      .filter((key) => !answered(key))
      .map((key) => {
        const label = questions.get(key)?.label.en ?? key;
        return `${label}: ${ANSWER_STATUS_LABEL[answerStatus(input.answers, input.extracted, key)].toLowerCase()}`;
      });
    flags.push({
      code: "missing_answers",
      severity: "info",
      questionKey: null,
      detail: `${indexKeys.length - answeredCount} of ${indexKeys.length} unanswered (${why.join("; ")})`,
    });
  }

  // Survey-specific rules.
  for (const rule of definition.qa.rules) {
    const base = { code: rule.code, severity: rule.severity, questionKey: null, detail: null } as const;
    switch (rule.kind) {
      case "combination":
        if (rule.when.every((w) => input.answers[w.question] === w.equals)) flags.push({ ...base });
        break;
      case "all_neutral":
        if (
          rule.questions.every((key) => {
            const q = questions.get(key);
            return q !== undefined && answered(key) && input.answers[key] === neutralValue(q);
          })
        ) {
          flags.push({ ...base });
        }
        break;
      case "trend_vs_number_change": {
        const trend = input.answers[rule.trend];
        const now = input.answers[rule.number];
        const prev = previous?.[rule.number];
        if (typeof now !== "number" || typeof prev !== "number") break;
        const change = 100 * (now - prev);
        const band = rule.tolerancePct * prev;
        // Only an outright contradiction counts: the trend says one way, the numbers moved the other.
        if ((trend === "up" && -change > band) || (trend === "down" && change > band)) {
          flags.push({ ...base, questionKey: rule.number, detail: `said ${trend}, but ${prev} → ${now}` });
        }
        break;
      }
      case "number_jump": {
        const now = input.answers[rule.question];
        const prev = previous?.[rule.question];
        if (typeof now !== "number" || typeof prev !== "number") break;
        const lo = Math.min(now, prev);
        const hi = Math.max(now, prev);
        if ((lo === 0 && hi > 0) || (lo > 0 && hi / lo > rule.factor)) {
          flags.push({ ...base, questionKey: rule.question, detail: `${prev} → ${now}` });
        }
        break;
      }
    }
  }

  const qaState = flags.some((f) => f.severity === "exclude")
    ? "excluded"
    : flags.some((f) => f.severity === "hold")
      ? "needs_review"
      : "auto_ok";
  return { flags, answeredCount, qaState };
}
