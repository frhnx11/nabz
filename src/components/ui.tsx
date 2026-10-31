import type { ComponentProps, ReactNode } from "react";

/**
 * Shared building blocks. Minimal white-and-blue: white rounded cards on a slate-50 page, one blue
 * accent, pastel status pills. Pages compose these instead of styling from scratch.
 */

/** A white card. `flush` removes the padding (for tables that run edge to edge). */
export function Panel({
  children,
  className = "",
  flush = false,
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section
      className={`min-w-0 rounded-2xl border border-line bg-surface shadow-sm ${flush ? "overflow-hidden" : "p-6"} ${className}`}
    >
      {children}
    </section>
  );
}

/** Title row for a card, with an optional description and an action on the right. */
export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

type Tone = "neutral" | "good" | "warn" | "bad" | "accent";

const PILL_TONE: Record<Tone, { pill: string; dot: string }> = {
  neutral: { pill: "bg-line-soft text-subtle ring-line", dot: "bg-faint" },
  good: { pill: "bg-good-soft text-good ring-good-ring", dot: "bg-good-dot" },
  warn: { pill: "bg-warn-soft text-warn ring-warn-ring", dot: "bg-warn-dot" },
  bad: { pill: "bg-bad-soft text-bad ring-bad-ring", dot: "bg-bad-dot" },
  accent: { pill: "bg-accent-soft text-accent ring-accent-ring", dot: "bg-accent" },
};

/** Status pill: pastel fill, matching ring, optional dot. */
export function Pill({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  const t = PILL_TONE[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ${t.pill}`}
    >
      {dot && <span className={`size-1.5 rounded-full ${t.dot}`} />}
      {children}
    </span>
  );
}

const BUTTON = {
  primary:
    "bg-accent text-white shadow-sm hover:bg-accent-hover active:scale-[.98] disabled:opacity-40 disabled:active:scale-100",
  secondary:
    "border border-line-strong bg-surface text-subtle hover:border-accent-bright hover:text-accent disabled:opacity-40",
} as const;
const BUTTON_SIZE = { sm: "px-3 py-1 text-sm", md: "px-5 py-2 text-sm" } as const;

type ButtonStyle = { variant?: keyof typeof BUTTON; size?: keyof typeof BUTTON_SIZE };

export function buttonClass({ variant = "primary", size = "md" }: ButtonStyle = {}) {
  return `inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition ${BUTTON[variant]} ${BUTTON_SIZE[size]}`;
}

export function Button({ variant, size, className = "", ...props }: ComponentProps<"button"> & ButtonStyle) {
  return <button className={`${buttonClass({ variant, size })} ${className}`} {...props} />;
}

/** A filter pill: the active choice is solid blue. */
export function filterPillClass(active: boolean, size: "sm" | "md" = "sm") {
  return `rounded-full font-medium whitespace-nowrap transition ${size === "md" ? "px-4 py-1.5 text-base" : "px-3 py-1 text-sm"} ${
    active ? "bg-accent text-white shadow-sm" : "text-subtle ring-1 ring-line hover:text-ink"
  }`;
}

/** Text link in the accent colour. */
export const linkClass = "text-accent font-medium hover:underline";

/** Form controls. */
export const labelClass = "text-muted text-xs font-medium";
export const inputClass =
  "border-line-strong bg-surface text-ink placeholder:text-faint focus:border-accent-bright focus:ring-accent-bright/25 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none";

export function PageHeader({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {children && <div className="mt-1 max-w-2xl text-sm text-muted">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Panel className="grid place-items-center gap-3 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-accent-soft text-accent ring-4 ring-accent-tint">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
          <path
            d="M3 17.5h7l2.5-7.5 5 13.5 3.5-10 2 3.5H29"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <div className="grid gap-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      </div>
    </Panel>
  );
}

/**
 * Tables: a header band with small uppercase labels, quiet row dividers, hover highlight, tabular numbers.
 * Put the table in a `<Panel flush>` with `<TableScroll>` so it scrolls inside the card on small screens.
 */
export const tableClass = "w-full text-sm [font-variant-numeric:tabular-nums]";
export const theadRowClass = "border-line bg-bg/60 border-b";
export const thClass =
  "text-faint px-5 py-3 text-left text-xs font-medium tracking-wider whitespace-nowrap uppercase";
export const trClass = "border-line-soft hover:bg-bg border-b transition last:border-0";
export const tdClass = "px-5 py-3.5 align-top";

export function TableScroll({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

/** Label / value pairs. */
export function KeyValues({
  rows,
  roomy = false,
}: {
  rows: [ReactNode, ReactNode][];
  roomy?: boolean;
}) {
  return (
    <dl className={`grid grid-cols-[auto_1fr] items-center gap-x-4 text-sm ${roomy ? "gap-y-4" : "gap-y-2"}`}>
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="num text-right text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Placeholder block shown while data streams in. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-line-soft ${className}`} />;
}

/** Loading placeholder: `cards` side-by-side cards, or one table card with `rows` rows. */
export function LoadingCards({ cards = 1, rows = 4 }: { cards?: number; rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`grid gap-6 ${cards === 2 ? "md:grid-cols-2" : cards >= 3 ? "md:grid-cols-3" : ""}`}
    >
      {Array.from({ length: cards }, (_, c) => (
        <Panel key={c} className="grid content-start gap-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-3/4" />
          {Array.from({ length: rows }, (_, r) => (
            <Skeleton key={r} className="h-4 w-full" />
          ))}
        </Panel>
      ))}
    </div>
  );
}
