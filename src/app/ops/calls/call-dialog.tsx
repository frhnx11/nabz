"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";

/**
 * The pop-up shell for one call's data. It's driven by the URL (?call=…): it opens when rendered,
 * and closing it (×, Esc or clicking outside) goes back to the table without the parameter.
 */
export function CallDialog({
  closeHref,
  title,
  children,
}: {
  closeHref: string;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(calc(100%-2rem),46rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/30 backdrop:backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      onClose={() => router.replace(closeHref as Route, { scroll: false })}
    >
      <div className="relative">
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label="Close"
          className="absolute top-4 right-4 grid size-8 place-items-center rounded-full text-faint hover:bg-line-soft hover:text-ink"
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
        {children}
      </div>
    </dialog>
  );
}
