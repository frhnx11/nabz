"use client";

import { useId, useRef, useState, useTransition } from "react";
import { DialogHeader, dialogClass } from "@/components/dialog";
import { Button } from "@/components/ui";
import { removeBatchAction } from "./actions";

/**
 * Delete (never called) or Archive (has sets) with a confirmation. Archiving keeps the batch's set
 * history and frees its dealers to join another batch.
 */
export function RemoveBatch({ id, name, hasSets }: { id: string; name: string; hasSets: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const verb = hasSets ? "Archive" : "Delete";

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          setError(null);
          dialogRef.current?.showModal();
        }}
      >
        {verb}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className={dialogClass("sm")}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="grid gap-5 p-6">
          <DialogHeader
            id={titleId}
            title={`${verb} “${name}”?`}
            description={
              hasSets
                ? "It has been called before, so it's archived rather than deleted: its sets and calls stay on record, and its dealers are freed to join another batch."
                : "It has never been called, so it's removed completely. Its dealers are freed to join another batch."
            }
            onClose={() => dialogRef.current?.close()}
          />
          {error && <p className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await removeBatchAction(id);
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  // The card moves to Archived (or disappears) as the page refreshes.
                  dialogRef.current?.close();
                })
              }
            >
              {pending ? `${verb.slice(0, -1)}ing…` : verb}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
