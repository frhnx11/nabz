"use client";

import { useEffect, useState, useTransition } from "react";
import { DialogHeader } from "@/components/dialog";
import { Button, Pill } from "@/components/ui";
import type { TestCallPreview, TestCallResult } from "@/lib/bolna/dialer";
import { formatCost } from "@/lib/format";
import { previewTestCall, startTestCall } from "./actions";

/**
 * The confirm step of a test call, inside the Edit dealer pop-up: who would be called, with which
 * agent and at what cost, or why it can't be called. Calling is always a second, deliberate press.
 */
export function TestCallPanel({
  dealerId,
  headingId,
  onBack,
  onClose,
}: {
  dealerId: string;
  headingId: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<TestCallPreview | null>(null);
  const [result, setResult] = useState<TestCallResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void previewTestCall(dealerId).then((loaded) => {
      if (live) setPreview(loaded);
    });
    return () => {
      live = false;
    };
  }, [dealerId]);

  function call() {
    startTransition(async () => {
      setResult(await startTestCall(dealerId));
    });
  }

  const placed = result?.status === "placed";

  return (
    <div className="grid gap-5 p-6">
      <DialogHeader
        id={headingId}
        title="Test call"
        description="A real call that uses Bolna credits. It saves nothing: no call record, nothing in the index."
        onClose={onClose}
      />

      {!preview ? (
        <p className="text-sm text-muted">Checking…</p>
      ) : (
        <div className="grid gap-2 text-sm">
          {preview.phone && (
            <p>
              Calls <span className="num font-medium">{preview.phone}</span> in{" "}
              <span className="font-medium">{preview.language}</span>
              {preview.agentLabel && (
                <>
                  {" "}
                  with <span className="num font-medium">{preview.agentLabel}</span>{" "}
                  <Pill tone={preview.tested ? "good" : "neutral"}>{preview.tested ? "Tested" : "Draft"}</Pill>
                </>
              )}
              . About {formatCost(preview.estimateCents).inr}.
            </p>
          )}
          <p className="text-xs text-muted">Uses the saved details: save any edits first.</p>
          {preview.refusal && !result && <p className="text-bad">{preview.refusal}</p>}
        </div>
      )}

      {result?.status === "placed" && (
        <p className="text-sm">
          Calling now. Bolna&apos;s execution id: <span className="num text-xs">{result.executionId}</span>
        </p>
      )}
      {result && result.status !== "placed" && <p className="text-sm text-bad">{result.message}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onBack} disabled={pending}>
          Back
        </Button>
        {preview && !preview.refusal && !placed && result?.status !== "unknown" && (
          <Button type="button" onClick={call} disabled={pending}>
            {pending ? "Calling…" : "Call"}
          </Button>
        )}
      </div>
    </div>
  );
}
