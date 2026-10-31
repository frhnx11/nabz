"use client";

import { useSyncExternalStore } from "react";
import { readSession } from "@/components/shell/area-store";

const noop = () => () => {};

/**
 * Review forms keep what ops typed in this tab (sessionStorage), so closing the pop-up or switching
 * areas loses nothing. Fields are uncontrolled: they start from the draft once the page is live in
 * the browser. `key` remounts them then, so the server-rendered (empty) fields never mismatch.
 */
export function useDraft(storageKey: string): { key: string; initial: string } {
  const live = useSyncExternalStore(noop, () => true, () => false);
  return { key: live ? "live" : "server", initial: live ? (readSession(storageKey) ?? "") : "" };
}
