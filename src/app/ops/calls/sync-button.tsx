"use client";

import { useActionState, useState } from "react";
import { Toast } from "@/components/dialog";
import { Button } from "@/components/ui";
import { type SyncState, syncCalls } from "./actions";

/** "Sync calls": asks Bolna how unfinished calls went, then says what changed. */
export function SyncButton() {
  const [state, action, pending] = useActionState<SyncState, FormData>(syncCalls, { status: "idle" });
  const [toast, setToast] = useState<string | null>(null);

  // One toast per result, set during render (once per result) rather than in an effect.
  const [shown, setShown] = useState(0);
  if (state.status !== "idle" && state.at !== shown) {
    setShown(state.at);
    setToast(state.message);
  }

  return (
    <form action={action}>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Syncing…" : "Sync calls"}
      </Button>
      <Toast message={toast} onDone={() => setToast(null)} />
    </form>
  );
}
