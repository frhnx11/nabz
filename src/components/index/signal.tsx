import type { CSSProperties } from "react";
import { formatChange } from "@/lib/format";

/**
 * Index display pieces. Every index is 0–100 with 50 = no change. Colour says whether the reading is
 * good or bad news for demand (so high discount pressure is red), on the blue ↔ red `index-*` scale.
 */

export type GoodWhen = "high" | "low";

/** How far the reading is from 50 in the good direction (positive = stronger demand signal). */
export function signalOf(value: number, goodWhen: GoodWhen): number {
  return goodWhen === "high" ? value - 50 : 50 - value;
}

/** Background for a heat cell: slate at 50, deepening to blue (stronger) or red (weaker). */
export function heatStyle(value: number, goodWhen: GoodWhen): CSSProperties {
  const s = signalOf(value, goodWhen);
  const t = Math.min(1, Math.abs(s) / 35);
  const pct = Math.round(10 + t * 72);
  const pole = s >= 0 ? "var(--index-up)" : "var(--index-down)";
  return {
    background: `color-mix(in oklab, ${pole} ${pct}%, var(--index-flat))`,
    color: pct >= 58 ? "var(--surface)" : "var(--ink)",
  };
}

/** A track with a midline at 50 and a fill from 50 to the value. */
export function Bar50({
  value,
  goodWhen,
  className = "",
}: {
  value: number | null;
  goodWhen: GoodWhen;
  className?: string;
}) {
  const v = value === null ? 50 : Math.max(0, Math.min(100, value));
  const s = signalOf(v, goodWhen);
  return (
    <div aria-hidden="true" className={`relative h-1.5 rounded-full bg-index-flat ${className}`}>
      {value !== null && Math.abs(v - 50) >= 0.05 && (
        <span
          className={`absolute inset-y-0 ${s >= 0 ? "bg-index-up" : "bg-index-down"} ${v >= 50 ? "rounded-r-full" : "rounded-l-full"}`}
          style={{ left: `${Math.min(v, 50)}%`, width: `${Math.abs(v - 50)}%` }}
        />
      )}
      <span className="absolute -inset-y-0.5 left-1/2 w-px bg-faint" />
    </div>
  );
}

/** "▲ +4.2" vs a previous reading. The arrow carries the colour; the number stays ink. */
export function Change({
  delta,
  goodWhen,
  suffix,
}: {
  delta: number | null;
  goodWhen: GoodWhen;
  suffix?: string;
}) {
  if (delta === null) return <span className="text-faint">No earlier week</span>;
  const r = Math.round(delta * 10) / 10;
  const good = goodWhen === "high" ? r > 0 : r < 0;
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      {r !== 0 && (
        <span aria-hidden="true" className={`text-[0.8em] ${good ? "text-index-up" : "text-index-down"}`}>
          {r > 0 ? "▲" : "▼"}
        </span>
      )}
      <span className="num">{formatChange(delta)}</span>
      {suffix && <span className="text-muted">{suffix}</span>}
    </span>
  );
}

const LEGEND: [string, number][] = [
  ["Weaker demand signal", 15],
  ["About the same", 50],
  ["Stronger", 85],
];

/** Legend for the index colour scale, with a note for hidden cells. */
export function SignalLegend({ hiddenNote }: { hiddenNote?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
      {LEGEND.map(([label, value]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm" style={{ background: heatStyle(value, "high").background }} />
          {label}
        </span>
      ))}
      {hiddenNote && <span>— = {hiddenNote}</span>}
    </div>
  );
}
