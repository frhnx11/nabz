"use client";

import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";

export type ChartPoint = {
  /** Axis label, e.g. "W44". */
  short: string;
  /** Tooltip / table label, e.g. "Week 44, 2026". */
  title: string;
  value: number | null;
  margin: number | null;
  n: number;
};

const HEIGHT = 340;
const PAD = { top: 24, right: 88, bottom: 34, left: 36 };

const fmt = (v: number) => v.toFixed(1);

/**
 * One series over time: the line, its 95% margin as a light band, and a reference line at 50
 * (no change). Hover or arrow keys show a readout for the nearest week; a table view sits below.
 */
export function TrendChart({ points, label, noun }: { points: ChartPoint[]; label: string; noun: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const known = points.flatMap((p) =>
    p.value === null ? [] : [p.value - (p.margin ?? 0), p.value + (p.margin ?? 0)],
  );
  const lo = Math.max(0, Math.floor((Math.min(50, ...known) - 2) / 10) * 10);
  const hi = Math.min(100, Math.ceil((Math.max(50, ...known) + 2) / 10) * 10);
  const step = hi - lo > 50 ? 20 : 10;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);

  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? plotW / 2 : (i * plotW) / (points.length - 1));
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * plotH;

  // Runs of consecutive weeks with a value (a week without answers breaks the line).
  const sets: number[][] = [];
  points.forEach((p, i) => {
    if (p.value === null) return;
    const last = sets.at(-1);
    if (last && last.at(-1) === i - 1) last.push(i);
    else sets.push([i]);
  });
  const line = (run: number[]) =>
    run.map((i, k) => `${k ? "L" : "M"}${x(i)} ${y(points[i]!.value!)}`).join("");
  const band = (run: number[]) => {
    const upper = run.map(
      (i, k) => `${k ? "L" : "M"}${x(i)} ${y(Math.min(100, points[i]!.value! + (points[i]!.margin ?? 0)))}`,
    );
    const lower = run
      .toReversed()
      .map((i) => `L${x(i)} ${y(Math.max(0, points[i]!.value! - (points[i]!.margin ?? 0)))}`);
    return `${upper.join("")}${lower.join("")}Z`;
  };

  const lastIndex = points.findLastIndex((p) => p.value !== null);
  const shown = active;

  function onMove(e: PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * plotW;
    const i = Math.round((px / plotW) * (points.length - 1));
    setActive(Math.max(0, Math.min(points.length - 1, i)));
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const from = active ?? lastIndex;
    setActive(Math.max(0, Math.min(points.length - 1, from + (e.key === "ArrowRight" ? 1 : -1))));
  }

  const tip = shown === null ? null : points[shown]!;

  return (
    <div className="grid gap-3">
      <div
        ref={box}
        className="relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent-bright/40"
        tabIndex={0}
        role="img"
        aria-label={`${label}, ${points.length} weeks. Use the arrow keys to read each week.`}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block h-auto w-full overflow-visible"
          aria-hidden="true"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                className={t === 50 ? "stroke-faint" : "stroke-line-soft"}
                strokeWidth={1}
              />
              <text x={PAD.left - 8} y={y(t) + 5} textAnchor="end" className="num fill-faint text-sm">
                {t}
              </text>
            </g>
          ))}
          <text x={width - PAD.right + 8} y={y(50) + 5} className="fill-faint text-sm">
            no change
          </text>

          {sets.map((run) => (
            <path key={`b${run[0]}`} d={band(run)} className="fill-accent" fillOpacity={0.1} />
          ))}
          {sets.map((run) => (
            <path
              key={`l${run[0]}`}
              d={line(run)}
              fill="none"
              className="stroke-accent"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {shown !== null && (
            <line
              x1={x(shown)}
              x2={x(shown)}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              className="stroke-line-strong"
              strokeWidth={1}
            />
          )}

          {points.map((p, i) =>
            p.value === null ? null : (
              <circle
                key={i}
                cx={x(i)}
                cy={y(p.value)}
                r={i === lastIndex || i === shown ? 4.5 : 3}
                className="fill-accent stroke-surface"
                strokeWidth={2}
              />
            ),
          )}
          {lastIndex >= 0 && shown === null && (
            <text
              x={x(lastIndex) + 8}
              y={y(points[lastIndex]!.value!) - 10}
              className="num fill-ink text-base font-medium"
            >
              {fmt(points[lastIndex]!.value!)}
            </text>
          )}

          {points.map((p, i) => (
            <text
              key={i}
              x={x(i)}
              y={HEIGHT - 8}
              textAnchor="middle"
              className={`num text-sm ${i === shown ? "fill-ink" : "fill-faint"}`}
            >
              {p.short}
            </text>
          ))}

          <rect
            x={PAD.left}
            y={0}
            width={plotW}
            height={HEIGHT}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>

        {tip && shown !== null && (
          <div
            className="pointer-events-none absolute top-1 z-10 grid min-w-36 gap-0.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-md"
            style={x(shown) > width / 2 ? { right: width - x(shown) + 10 } : { left: x(shown) + 10 }}
          >
            {tip.value === null ? (
              <span className="text-muted">No answers</span>
            ) : (
              <span className="text-base font-semibold text-ink">
                {fmt(tip.value)}
                {tip.margin !== null && <span className="font-normal text-muted"> ±{fmt(tip.margin)}</span>}
              </span>
            )}
            <span className="text-muted">{tip.title}</span>
            <span className="text-muted">
              n = {tip.n} {noun}
            </span>
          </div>
        )}
      </div>

      <details className="text-base">
        <summary className="cursor-pointer text-sm font-medium text-muted hover:text-ink">
          Show as table
        </summary>
        <table className="mt-2 w-full text-sm [font-variant-numeric:tabular-nums]">
          <thead>
            <tr className="text-left text-faint">
              <th className="py-1 font-medium">Week</th>
              <th className="py-1 text-right font-medium">{label}</th>
              <th className="py-1 text-right font-medium">Margin</th>
              <th className="py-1 text-right font-medium">n</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.title} className="border-t border-line-soft">
                <td className="py-1">{p.title}</td>
                <td className="py-1 text-right">{p.value === null ? "—" : fmt(p.value)}</td>
                <td className="py-1 text-right">{p.margin === null ? "—" : `±${fmt(p.margin)}`}</td>
                <td className="py-1 text-right">{p.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
