import type { Metadata } from "next";
import { io } from "next/cache";
import { type ReactNode, Suspense } from "react";
import { Bar50, Change, type GoodWhen } from "@/components/index/signal";
import { type ChartPoint, TrendChart } from "@/components/index/trend-chart";
import { WeekNav } from "@/components/index/week-nav";
import { EmptyState, LoadingCards, PageHeader, Panel, Pill } from "@/components/ui";
import type { GroupResult, WeekIndex } from "@/lib/index/engine";
import { nationalOf } from "@/lib/index/engine";
import { keyFindings } from "@/lib/index/findings";
import {
  dimensionValueLabel,
  geoDimension,
  primaryAttributeDimension,
} from "@/lib/index/labels";
import { extremeNote } from "@/lib/index/trend";
import { formatIndex, formatWeekRange, formatWeekShort, formatWeekTitle } from "@/lib/format";
import type { SurveyDefinition } from "@/lib/surveys/schema";
import { BoxHeader } from "../_lib/box-header";
import { type LoadedPulse, loadPulse, SECTOR } from "../_lib/pulse-data";

export const metadata: Metadata = { title: "Weekly Pulse" };

export default function PulsePage({ searchParams }: PageProps<"/pulse">) {
  return (
    <>
      <PageHeader title="Weekly Pulse" />
      <Suspense fallback={<LoadingCards rows={5} />}>
        <Pulse searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Pulse({ searchParams }: { searchParams: PageProps<"/pulse">["searchParams"] }) {
  await io();
  const { week } = await searchParams;
  const pulse = await loadPulse(week);
  if (!pulse) {
    return (
      <EmptyState title="No answers yet">
        The Pulse fills in as soon as dealers start answering this week&apos;s calls.
      </EmptyState>
    );
  }
  return (
    <>
      <Headline pulse={pulse} />
      <SubIndices pulse={pulse} />
      <Panel className="grid content-start gap-6 py-8">
        <BoxHeader
          title={`${pulse.definition.composite.label.en}, last ${pulse.points.length} weeks`}
          description="50 means no change. The shaded band is the margin of error."
        />
        <TrendChart
          points={pulse.points.map((p): ChartPoint => ({
            short: formatWeekShort(p.weekStart),
            title: formatWeekTitle(p.weekStart),
            value: p.value,
            margin: p.margin,
            n: p.n,
          }))}
          label={pulse.definition.composite.label.en}
          noun={SECTOR.nouns.other}
        />
      </Panel>
      <div className="grid gap-6 md:grid-cols-2">
        <Ranking pulse={pulse} dimension={primaryAttributeDimension(pulse.definition)} title="By brand" />
        <Ranking pulse={pulse} dimension={geoDimension(pulse.definition, "state")} title="By state" />
      </div>
    </>
  );
}

/** The composite is built so that higher always means stronger demand. */
const COMPOSITE: GoodWhen = "high";

function groupsOf(definition: SurveyDefinition, index: WeekIndex | null, dimension: string): GroupResult[] {
  const cut = definition.cuts.find(
    (c) => c.dims.length === 1 && c.dims[0] === dimension && c.poolWeeks === 1,
  );
  return (cut && index?.cuts[cut.key]) ?? [];
}

function Headline({ pulse }: { pulse: LoadedPulse }) {
  const { definition, index, previous, points, coverage } = pulse;
  const nat = nationalOf(definition, index);
  const prevNat = previous ? nationalOf(definition, previous) : null;
  const value = nat?.composite.value ?? null;
  const prevValue = prevNat?.composite.value ?? null;
  const note = extremeNote(points);
  const findings = keyFindings({
    definition,
    current: index,
    previous,
    label: (dim, code) => dimensionValueLabel(definition, SECTOR, dim, code),
    nouns: SECTOR.nouns,
    spreadDimension: primaryAttributeDimension(definition),
    moverDimension: geoDimension(definition, "state"),
  });

  return (
    <Panel className="grid gap-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">{formatWeekTitle(pulse.week)}</h2>
            {pulse.inProgress ? (
              <Pill tone="accent" dot>
                Live
              </Pill>
            ) : (
              <Pill>Week closed</Pill>
            )}
          </div>
          <p className="text-base text-muted">
            {formatWeekRange(pulse.week)} · {coverage.dealers} {SECTOR.nouns.other} · {coverage.states}{" "}
            {coverage.states === 1 ? "state" : "states"} · {coverage.cities} {coverage.cities === 1 ? "city" : "cities"}
          </p>
        </div>
        <WeekNav
          week={pulse.week}
          latestWeek={pulse.latestWeek}
          hasPrev={pulse.hasPrevWeek}
          hasNext={pulse.hasNextWeek}
          hrefFor={(w) => ({ pathname: "/pulse", query: w ? { week: w } : {} })}
        />
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="mb-2 text-sm font-medium tracking-wide text-muted uppercase">{definition.composite.label.en}</p>
          <p className="flex items-baseline gap-2">
            <span className="text-7xl leading-none font-semibold tracking-tight text-accent">{formatIndex(value)}</span>
            {nat && nat.composite.margin !== null && (
              <span className="num text-lg text-muted">±{formatIndex(nat.composite.margin)}</span>
            )}
          </p>
        </div>
        <div className="grid gap-1.5 pb-1">
          <span className="text-xl">
            <Change
              delta={value !== null && prevValue !== null ? value - prevValue : null}
              goodWhen={COMPOSITE}
              suffix={prevValue !== null ? "from last week" : undefined}
            />
          </span>
          {note && <span className="text-base text-muted">{note}</span>}
        </div>
      </div>

      {findings.length > 0 && (
        <ul className="grid max-w-3xl list-disc gap-3 border-t border-line pt-6 pl-5 text-base leading-relaxed text-ink-2">
          {findings.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SubIndices({ pulse }: { pulse: LoadedPulse }) {
  const { definition, index, previous } = pulse;
  const nat = nationalOf(definition, index);
  const prevNat = previous ? nationalOf(definition, previous) : null;
  return (
    <Panel className="grid gap-6 py-8">
      <BoxHeader title="Sub-indices" description="Out of 100, where 50 means no change. Arrows show the change from last week." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {definition.indicators.map((ind) => {
          const s = nat?.indicators[ind.key];
          const prev = prevNat?.indicators[ind.key]?.value ?? null;
          return (
            <div
              key={ind.key}
              className="grid content-start gap-3 rounded-xl border border-line px-4 py-6"
              title={ind.description.en}
            >
              <span className="min-h-12 text-base leading-6 text-muted">{ind.label.en}</span>
              <span className="text-4xl font-semibold tracking-tight">{formatIndex(s?.value)}</span>
              <span className="text-base">
                <Change delta={s && s.value !== null && prev !== null ? s.value - prev : null} goodWhen={ind.goodWhen} />
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function SplitRow({
  label,
  group,
  goodWhen,
  extra,
}: {
  label: string;
  group: GroupResult | undefined;
  goodWhen: GoodWhen;
  extra?: ReactNode;
}) {
  const value = group?.composite.value ?? null;
  return (
    <div
      className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_3.5rem] items-center gap-3 text-base"
      title={
        group
          ? `n = ${group.n} ${SECTOR.nouns.other}${group.composite.margin !== null ? ` · ±${formatIndex(group.composite.margin)} margin` : ""}`
          : "No answers"
      }
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{label}</span>
        {group?.lowN && <span className="shrink-0 text-xs font-medium text-warn">low n</span>}
      </span>
      <Bar50 value={value} goodWhen={goodWhen} />
      <span className="num text-right">{extra ?? formatIndex(value)}</span>
    </div>
  );
}

function Ranking({
  pulse,
  dimension,
  title,
}: {
  pulse: LoadedPulse;
  dimension: string | null;
  title: string;
}) {
  if (!dimension) return null;
  const { definition, index, previous } = pulse;
  const prev = new Map(groupsOf(definition, previous, dimension).map((g) => [g.key, g.composite.value]));
  const groups = groupsOf(definition, index, dimension)
    .filter((g) => g.composite.value !== null)
    .toSorted((a, b) => b.composite.value! - a.composite.value!);
  return (
    <Panel className="grid content-start gap-6 py-8">
      <BoxHeader title={title} description={`${definition.composite.label.en}, highest first`} />
      {groups.length === 0 ? (
        <p className="text-base text-faint">No answers this week.</p>
      ) : (
        <div className="grid gap-4">
          {groups.map((g) => {
            const before = prev.get(g.key) ?? null;
            return (
              <div key={g.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <SplitRow
                  label={dimensionValueLabel(definition, SECTOR, dimension, g.values[dimension]!)}
                  group={g}
                  goodWhen={COMPOSITE}
                />
                <span className="w-20 text-right text-base text-muted">
                  {before !== null ? (
                    <Change delta={g.composite.value! - before} goodWhen={COMPOSITE} />
                  ) : (
                    "new"
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
