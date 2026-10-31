"use client";

import { type FormEvent, startTransition, useActionState, useEffect, useState } from "react";
import { Toast } from "@/components/dialog";
import { removeSession, writeSession } from "@/components/shell/area-store";
import { Button, inputClass, labelClass } from "@/components/ui";
import { type QaState, reviewDecisions } from "@/lib/calls/review";
import { type ReviewState, reviewCallAction } from "./actions";
import { useDraft } from "./draft";

const COUNTS_ALREADY = "This call already counts in the index. Exclude it only if you know it's bad.";

const HINT: Record<QaState, string> = {
  pending: "",
  auto_ok: COUNTS_ALREADY,
  approved: COUNTS_ALREADY,
  needs_review: "Held back: it counts only if you approve it.",
  excluded: "This call doesn't count in the index. Approve it to put it back.",
};

/** Approve or exclude a call, with an optional note. Changing a decision later is allowed (and audited). */
export function ReviewPanel({ callId, qaState }: { callId: string; qaState: QaState }) {
  const decisions = reviewDecisions(qaState);
  const [state, dispatch, pending] = useActionState<ReviewState, FormData>(reviewCallAction, { status: "idle" });
  const draftKey = `nabz:review-note:${callId}`;
  const draft = useDraft(draftKey);
  const [formKey, setFormKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  // One toast per result; after a decision, start the next note empty. Set during render, once per result.
  const [handled, setHandled] = useState(0);
  if (state.status !== "idle" && state.at !== handled) {
    setHandled(state.at);
    setToast(state.message);
    if (state.status === "done") setFormKey((k) => k + 1);
  }
  useEffect(() => {
    if (state.status === "done") removeSession(draftKey);
  }, [state, draftKey]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    // Submitted by hand so a refused decision doesn't reset the note (React resets forms after actions).
    e.preventDefault();
    const formData = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => dispatch(formData));
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 rounded-xl border border-line p-4">
      <input type="hidden" name="callId" value={callId} />
      <label className="grid gap-1.5">
        <span className={labelClass}>Note (optional)</span>
        <textarea
          key={`${draft.key}-${formKey}`}
          name="note"
          rows={2}
          maxLength={1000}
          defaultValue={formKey === 0 ? draft.initial : ""}
          onChange={(e) => writeSession(draftKey, e.target.value)}
          placeholder="Why, for whoever looks at this call next"
          className={inputClass}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {decisions.includes("approved") && (
          <Button type="submit" name="decision" value="approved" disabled={pending}>
            Approve
          </Button>
        )}
        {decisions.includes("excluded") && (
          <Button type="submit" name="decision" value="excluded" variant="secondary" disabled={pending}>
            Exclude
          </Button>
        )}
        <span className="text-xs text-muted">{HINT[qaState]}</span>
      </div>
      {state.status === "error" && state.at === handled && <p className="text-sm text-bad">{state.message}</p>}
      <Toast message={toast} onDone={() => setToast(null)} />
    </form>
  );
}
