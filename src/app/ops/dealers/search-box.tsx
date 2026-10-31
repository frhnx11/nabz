"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { inputClass } from "@/components/ui";

const DEBOUNCE_MS = 250;

/**
 * Searches every field of the dealers table. The query lives in the URL (?q=…), so a search
 * survives reloads and the Client | Ops switch. Typing updates the results after a short pause.
 */
export function SearchBox({ initialQuery, total }: { initialQuery: string; total: number }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [pending, startTransition] = useTransition();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const q = query.trim();
      const href = (q ? `/ops/dealers?q=${encodeURIComponent(q)}` : "/ops/dealers") as Route;
      startTransition(() => router.replace(href, { scroll: false }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, router]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full max-w-md">
        <svg
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          placeholder="Search name, brand, city, state, phone, tier…"
          aria-label="Search dealers"
          className={`${inputClass} rounded-full pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden`}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-faint hover:bg-line-soft hover:text-ink"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <span className="text-sm text-muted" aria-live="polite">
        {pending
          ? "Searching…"
          : `${total.toLocaleString("en-IN")} ${total === 1 ? "dealer" : "dealers"}`}
      </span>
    </div>
  );
}
