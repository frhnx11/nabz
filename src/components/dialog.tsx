"use client";

import { cloneElement, type ReactElement, type ReactNode, useEffect, useId, useRef } from "react";
import { labelClass } from "@/components/ui";

/**
 * Pieces shared by the ops pop-up forms (native `<dialog>`): the dialog frame, its header with a
 * close button, labelled fields with errors, and a short confirmation toast.
 */

const DIALOG_BASE =
  "m-auto rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/30 backdrop:backdrop-blur-[2px]";
// Written out in full so Tailwind sees each class.
const DIALOG_WIDTH = {
  sm: "w-[min(calc(100%-2rem),26rem)]",
  md: "w-[min(calc(100%-2rem),34rem)]",
  lg: "w-[min(calc(100%-2rem),46rem)]",
} as const;

/** Classes for a centred native `<dialog>` with a dimmed backdrop. */
export function dialogClass(size: keyof typeof DIALOG_WIDTH = "md") {
  return `${DIALOG_BASE} ${DIALOG_WIDTH[size]}`;
}

export function DialogHeader({
  id,
  title,
  description,
  onClose,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 id={id} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="-mt-1 -mr-2 grid size-8 place-items-center rounded-full text-faint hover:bg-line-soft hover:text-ink"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function Field({
  label,
  name,
  error,
  optional = false,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  optional?: boolean;
  children: ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={`${id}-${name}`} className={labelClass}>
        {label}
        {optional && <span className="font-normal text-faint"> · optional</span>}
      </label>
      {cloneElement(children, {
        id: `${id}-${name}`,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? errorId : undefined,
      })}
      {error && (
        <p id={errorId} className="text-xs text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

/** A short confirmation at the bottom of the screen; clears itself after 4 seconds. */
export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  // The latest callback, so a parent re-render doesn't restart the timer.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => done.current(), 4000);
    return () => clearTimeout(timer);
  }, [message]);
  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-surface shadow-lg"
    >
      {message}
    </div>
  );
}

export function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}
