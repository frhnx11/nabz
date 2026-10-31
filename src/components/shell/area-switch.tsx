"use client";

import type { Route } from "next";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { type Area, AREA_HOME, encodeRestore, storageKey, validLocation, validScroll } from "./area";
import { readSession, subscribeAreaMemory, writeSession } from "./area-store";

/** Where a segment should go: the remembered page for that area in this tab, else the area's home. */
function useAreaTarget(area: Area): string {
  return useSyncExternalStore(
    subscribeAreaMemory,
    () => validLocation(area, readSession(storageKey.last(area))) ?? AREA_HOME[area],
    // The server can't see this tab's memory; render the homes and let the client correct them.
    () => AREA_HOME[area],
  );
}

/** "Client | Ops" segmented switch. Each side resumes where you left it in this tab. */
export function AreaSwitch({ current }: { current: Area }) {
  const targets: Record<Area, string> = { client: useAreaTarget("client"), ops: useAreaTarget("ops") };
  const segments: { area: Area; label: string }[] = [
    { area: "client", label: "Client" },
    { area: "ops", label: "Ops" },
  ];

  return (
    <nav
      aria-label="Switch area"
      className="flex shrink-0 items-center gap-0.5 rounded-full bg-line-soft p-1"
    >
      {segments.map(({ area, label }) => {
        const active = area === current;
        return (
          <Link
            key={area}
            href={targets[area] as Route}
            scroll={false}
            onClick={() => {
              const to = targets[area];
              const y = validScroll(readSession(storageKey.scroll(to))) ?? 0;
              writeSession(storageKey.restore, encodeRestore({ to, y }));
            }}
            aria-current={active ? "page" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap transition ${
              active ? "bg-accent text-white" : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
