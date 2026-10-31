"use server";

import { refresh } from "next/cache";
import { bolnaFromEnv, dialerConfigFromEnv } from "@/lib/bolna/server";
import { advanceSet, stopSet } from "@/lib/bolna/set-dialer";
import { db } from "@/lib/db/client";
import { collectCalls, describeCollection } from "@/lib/db/collect";
import { correctAnswer, reviewCall } from "@/lib/db/queries/review";
import { type SetDetail, setDetail } from "@/lib/db/queries/sets";

/** The result of pressing Sync calls; `at` tells repeated results apart. */
export type SyncState = { status: "idle" } | { status: "done" | "error"; message: string; at: number };

/** Fetches every unfinished call from Bolna and stores the results (reads only: never dials). */
export async function syncCalls(_prev: SyncState): Promise<SyncState> {
  const bolna = bolnaFromEnv();
  if (!bolna) {
    return { status: "error", message: "Bolna's API key isn't set (BOLNA_API_KEY), so calls can't be synced.", at: Date.now() };
  }
  try {
    const summary = await collectCalls(db(), bolna);
    refresh();
    return { status: summary.errors.length ? "error" : "done", message: describeCollection(summary), at: Date.now() };
  } catch (error) {
    return { status: "error", message: `Sync failed: ${error instanceof Error ? error.message : String(error)}`, at: Date.now() };
  }
}

/** The result of a review action (approve / exclude, or a corrected answer); `at` tells results apart. */
export type ReviewState = { status: "idle" } | { status: "done" | "error"; message: string; at: number };

const field = (formData: FormData, name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
};

/** Approves or excludes a call (the note is optional). */
export async function reviewCallAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const decision = field(formData, "decision");
  const result = await reviewCall(db(), {
    callId: field(formData, "callId"),
    decision,
    note: field(formData, "note"),
    actor: "ops",
  });
  if (!result.ok) return { status: "error", message: result.error, at: Date.now() };
  refresh();
  const message = !result.changed
    ? "Nothing changed."
    : decision === "approved"
      ? "Approved: the call counts in the index."
      : "Excluded: the call won't count in the index.";
  return { status: "done", message, at: Date.now() };
}

/** Corrects one answer and re-checks the call. */
export async function correctAnswerAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const result = await correctAnswer(db(), {
    callId: field(formData, "callId"),
    questionKey: field(formData, "questionKey"),
    value: field(formData, "value"),
    reason: field(formData, "reason"),
    actor: "ops",
  });
  if (!result.ok) return { status: "error", message: result.error, at: Date.now() };
  refresh();
  return { status: "done", message: "Answer corrected and the call re-checked.", at: Date.now() };
}

/** One step of a live set: the current call's news, then the next row's call if nothing is ringing. */
export async function advanceSetAction(id: string): Promise<SetDetail | null> {
  const bolna = bolnaFromEnv();
  if (bolna) await advanceSet(db(), bolna, id, dialerConfigFromEnv());
  return setDetail(db(), id);
}

/** No further calls in this set. The call in progress finishes by itself. */
export async function stopSetAction(id: string): Promise<SetDetail | null> {
  await stopSet(db(), id, { actor: "ops" });
  return setDetail(db(), id);
}
