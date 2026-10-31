"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { DialogHeader, dialogClass } from "@/components/dialog";
import { Button } from "@/components/ui";
import type { SetPreview } from "@/lib/bolna/set-dialer";
import { EXCLUSION_LABEL } from "@/lib/calls/set-plan";
import { formatCost } from "@/lib/format";
import { previewSetAction, startSetAction } from "./actions";

/**
 * "Call" on a batch: how many rows, who's skipped and the cost, then a second press starts a set
 * and opens its live page, where the rows are called one at a time.
 */
export function CallBatch({ id, name }: { id: string; name: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const router = useRouter();
  const [preview, setPreview] = useState<SetPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    setPreview(null);
    setMessage(null);
    dialogRef.current?.showModal();
    startTransition(async () => {
      const loaded = await previewSetAction(id);
      setPreview(loaded);
      if (!loaded) setMessage("This batch no longer exists.");
    });
  }

  const plan = preview?.plan;
  const close = () => dialogRef.current?.close();

  return (
    <>
      <Button type="button" size="sm" onClick={open}>
        Call
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className={dialogClass("sm")}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="grid gap-4 p-6">
          <DialogHeader
            id={titleId}
            title={`Call “${name}”`}
            description="Real calls that use Bolna credits, one at a time. Their answers count in the index."
            onClose={close}
          />
          {!plan && !message && <p className="text-sm text-muted">Checking…</p>}
          {plan && (
            <div className="grid gap-2 text-sm">
              <p>
                <span className="num font-medium">{plan.callCount}</span> {plan.callCount === 1 ? "call" : "calls"}, up to{" "}
                {formatCost(plan.estimateCents).inr}.
              </p>
              {plan.excluded.map((e) => (
                <p key={e.reason} className="text-muted">
                  Skipped, {EXCLUSION_LABEL[e.reason].toLowerCase()}: <span className="num">{e.n}</span>
                </p>
              ))}
              {plan.refusal && <p className="text-bad">{plan.refusal.detail}</p>}
            </div>
          )}
          {message && <p className="text-sm text-bad">{message}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              Cancel
            </Button>
            {plan && !plan.refusal && (
              <Button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await startSetAction(id);
                    if (result.status === "started") router.push(`/ops/calls/sets?set=${result.setId}`);
                    else setMessage(result.message);
                  })
                }
              >
                {pending ? "Starting…" : "Start calling"}
              </Button>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
