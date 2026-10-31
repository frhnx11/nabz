"use client";

import { type FormEvent, startTransition, useActionState, useEffect, useState } from "react";
import { Toast } from "@/components/dialog";
import { removeSession, writeSession } from "@/components/shell/area-store";
import { Button, inputClass, labelClass } from "@/components/ui";
import { NOT_ANSWERED_INPUT } from "@/lib/calls/review";
import { type ReviewState, correctAnswerAction } from "./actions";
import { useDraft } from "./draft";

export type FixableQuestion = {
  key: string;
  label: string;
  /** Choices to pick from, or null for a number / free text. */
  options: { value: string; label: string }[] | null;
  /** For numbers: the allowed range, shown as a hint. */
  range: { min: number; max: number } | null;
};

/**
 * "Fix" on one answer: ops enter the right value (or "not answered") and why. The original stays on
 * record; the call is re-checked with the correction.
 */
export function FixAnswer({ callId, question, current }: { callId: string; question: FixableQuestion; current: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, dispatch, pending] = useActionState<ReviewState, FormData>(correctAnswerAction, { status: "idle" });
  const valueKey = `nabz:fix:${callId}:${question.key}:value`;
  const reasonKey = `nabz:fix:${callId}:${question.key}:reason`;
  const valueDraft = useDraft(valueKey);
  const reasonDraft = useDraft(reasonKey);
  const [toast, setToast] = useState<string | null>(null);

  // One toast per result; a saved correction closes the form. Set during render, once per result.
  const [handled, setHandled] = useState(0);
  if (state.status !== "idle" && state.at !== handled) {
    setHandled(state.at);
    if (state.status === "done") {
      setToast(state.message);
      setOpen(false);
    }
  }
  useEffect(() => {
    if (state.status === "done") {
      removeSession(valueKey);
      removeSession(reasonKey);
    }
  }, [state, valueKey, reasonKey]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    // Submitted by hand so a refused correction keeps what was typed (React resets forms after actions).
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    if (formData.get("notAnswered") === "on") formData.set("value", NOT_ANSWERED_INPUT);
    startTransition(() => dispatch(formData));
  }

  const initialValue = valueDraft.initial || current || "";
  const error = state.status === "error" && state.at === handled ? state.message : null;

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1 text-xs font-medium text-accent hover:underline"
          aria-label={`Fix the answer to ${question.label}`}
        >
          Fix
        </button>
      ) : (
        <form onSubmit={onSubmit} className="mt-2 grid min-w-56 gap-2 rounded-lg border border-line bg-bg/60 p-3 font-normal">
          <input type="hidden" name="callId" value={callId} />
          <input type="hidden" name="questionKey" value={question.key} />
          <label className="grid gap-1">
            <span className={labelClass}>Correct answer</span>
            {question.options ? (
              <select
                key={valueDraft.key}
                name="value"
                defaultValue={initialValue}
                onChange={(e) => writeSession(valueKey, e.target.value)}
                className={inputClass}
              >
                {question.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                <option value={NOT_ANSWERED_INPUT}>Not answered</option>
              </select>
            ) : (
              <input
                key={valueDraft.key}
                name="value"
                inputMode={question.range ? "decimal" : undefined}
                defaultValue={initialValue === NOT_ANSWERED_INPUT ? "" : initialValue}
                onChange={(e) => writeSession(valueKey, e.target.value)}
                placeholder={question.range ? `${question.range.min}–${question.range.max}` : undefined}
                className={inputClass}
              />
            )}
          </label>
          {!question.options && (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" name="notAnswered" />
              Not answered
            </label>
          )}
          <label className="grid gap-1">
            <span className={labelClass}>Why</span>
            <input
              key={reasonDraft.key}
              name="reason"
              required
              maxLength={500}
              defaultValue={reasonDraft.initial}
              onChange={(e) => writeSession(reasonKey, e.target.value)}
              placeholder="e.g. the recording says 21"
              className={inputClass}
            />
          </label>
          {error && <p className="text-xs text-bad">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}
