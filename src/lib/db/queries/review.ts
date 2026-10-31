import { eq, sql } from "drizzle-orm";
import { isUuid } from "../../domain/uuid";
import { correctable, parseCorrection, REVIEW_DECISIONS, type ReviewDecision, reviewable } from "../../calls/review";
import type { SurveyDefinition } from "../../surveys/schema";
import { answerOverrides, calls, surveys } from "../schema";
import { audit } from "./audit";
import { type DbConn, reinterpretCall } from "./ingest";

/**
 * Ops' review actions on one call (spec §5.4): approve or exclude it, or correct one answer. Each runs
 * in one transaction and is audited without personal data (the audit log is permanent): notes and
 * reasons stay with the call and the override, never in the log.
 */

export type ReviewResult = { ok: true; changed: boolean } | { ok: false; error: string };

const MAX_NOTE = 1000;
const MAX_REASON = 500;

export async function reviewCall(
  db: Pick<DbConn, "transaction">,
  input: { callId: string; decision: string; note: string; actor: string },
): Promise<ReviewResult> {
  if (!isUuid(input.callId)) return { ok: false, error: "Call not found." };
  if (!(REVIEW_DECISIONS as readonly string[]).includes(input.decision)) return { ok: false, error: "Unknown decision." };
  const decision = input.decision as ReviewDecision;
  const note = input.note.trim() || null;
  if (note && note.length > MAX_NOTE) return { ok: false, error: `Keep the note under ${MAX_NOTE} characters.` };

  return db.transaction(async (tx) => {
    const [call] = await tx
      .select({
        id: calls.id,
        derivedStatus: calls.derivedStatus,
        statusRank: calls.statusRank,
        qaState: calls.qaState,
        qaNote: calls.qaNote,
        qaReviewedAt: calls.qaReviewedAt,
      })
      .from(calls)
      .where(eq(calls.id, input.callId))
      .for("update");
    if (!call) return { ok: false, error: "Call not found." };
    if (!reviewable(call)) return { ok: false, error: "Only a finished call where the dealer talked can be reviewed." };
    if (call.qaReviewedAt && call.qaState === decision && call.qaNote === note) return { ok: true, changed: false };

    await tx
      .update(calls)
      .set({ qaState: decision, qaReviewedAt: new Date(), qaReviewedBy: input.actor, qaNote: note })
      .where(eq(calls.id, call.id));
    await audit(tx, {
      actor: input.actor,
      action: "call.review",
      entityType: "call",
      entityId: call.id,
      before: { qaState: call.qaState },
      after: { qaState: decision },
      meta: { hasNote: note !== null },
    });
    return { ok: true, changed: true };
  });
}

export async function correctAnswer(
  db: Pick<DbConn, "transaction">,
  input: {
    callId: string;
    questionKey: string;
    /** What ops typed or chose (`not_answered` removes the answer). */
    value: string;
    reason: string;
    actor: string;
  },
): Promise<ReviewResult> {
  if (!isUuid(input.callId)) return { ok: false, error: "Call not found." };
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "Say why the answer is being corrected." };
  if (reason.length > MAX_REASON) return { ok: false, error: `Keep the reason under ${MAX_REASON} characters.` };

  return db.transaction(async (tx) => {
    const [call] = await tx
      .select({
        id: calls.id,
        derivedStatus: calls.derivedStatus,
        statusRank: calls.statusRank,
        answers: calls.answers,
        hasRawExecution: sql<boolean>`${calls.rawExecution} is not null`,
        definition: surveys.definition,
      })
      .from(calls)
      .innerJoin(surveys, eq(surveys.id, calls.surveyId))
      .where(eq(calls.id, input.callId))
      .for("update", { of: calls });
    if (!call) return { ok: false, error: "Call not found." };
    if (!correctable(call)) {
      return { ok: false, error: "Only a finished call where the dealer talked can be corrected." };
    }
    const definition = call.definition as SurveyDefinition;
    const question = definition.questions.find((q) => q.key === input.questionKey);
    if (!question) return { ok: false, error: "Unknown question." };
    const parsed = parseCorrection(question, input.value);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const old = call.answers[question.key] ?? null;
    if (old === parsed.value) return { ok: false, error: "That's already the recorded answer." };

    const [override] = await tx
      .insert(answerOverrides)
      .values({
        callId: call.id,
          questionKey: question.key,
        oldValue: old,
        newValue: parsed.value,
        reason,
        createdBy: input.actor,
        // The wall clock, not the transaction's start: the latest correction per question wins.
        createdAt: sql`clock_timestamp()`,
      })
      .returning({ id: answerOverrides.id });
    await reinterpretCall(tx, call.id);
    await audit(tx, {
      actor: input.actor,
      action: "call.correct",
      entityType: "call",
      entityId: call.id,
      before: { [question.key]: old },
      after: { [question.key]: parsed.value },
      meta: { questionKey: question.key, overrideId: override!.id },
    });
    return { ok: true, changed: true };
  });
}
