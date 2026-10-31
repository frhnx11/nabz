import type { Route } from "next";
import Link from "next/link";
import type { UrlObject } from "node:url";
import { buttonClass } from "@/components/ui";
import { addWeeks, weekLabel } from "@/lib/domain/week";
import { formatWeekShort } from "@/lib/format";

type Href = Route | (UrlObject & { pathname: Route });

/** Previous / next week, plus a jump back to the latest week. `hrefFor(null)` is the latest week. */
export function WeekNav({
  week,
  latestWeek,
  hasPrev,
  hasNext,
  hrefFor,
}: {
  week: string;
  latestWeek: string;
  hasPrev: boolean;
  hasNext: boolean;
  hrefFor: (weekLabel: string | null) => Href;
}) {
  const prev = addWeeks(week, -1);
  const next = addWeeks(week, 1);
  const pill = buttonClass({ variant: "secondary", size: "sm" });
  const off = `${pill} pointer-events-none opacity-40`;
  return (
    <nav aria-label="Survey week" className="flex items-center gap-1.5">
      {hasPrev ? (
        <Link href={hrefFor(weekLabel(prev))} className={pill} scroll={false}>
          ‹ {formatWeekShort(prev)}
        </Link>
      ) : (
        <span className={off}>‹ {formatWeekShort(prev)}</span>
      )}
      {hasNext ? (
        <Link href={hrefFor(next === latestWeek ? null : weekLabel(next))} className={pill} scroll={false}>
          {formatWeekShort(next)} ›
        </Link>
      ) : (
        <span className={off}>{formatWeekShort(next)} ›</span>
      )}
      {week !== latestWeek && (
        <Link href={hrefFor(null)} className={pill} scroll={false}>
          Latest
        </Link>
      )}
    </nav>
  );
}
