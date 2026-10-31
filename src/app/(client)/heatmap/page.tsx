import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { type GoodWhen, heatStyle, SignalLegend } from "@/components/index/signal";
import { WeekNav } from "@/components/index/week-nav";
import { filterPillClass, EmptyState, LoadingCards, PageHeader, Panel, Pill } from "@/components/ui";
import { addWeeks, weekLabel } from "@/lib/domain/week";
import { type GroupResult, nationalOf, type Stat } from "@/lib/index/engine";
import { dimensionValueLabel, dimensionValues } from "@/lib/index/labels";
import { formatIndex, formatWeekShort, formatWeekTitle } from "@/lib/format";
import type { SurveyDefinition } from "@/lib/surveys/schema";
import { BoxHeader } from "../_lib/box-header";
import { type LoadedPulse, loadPulse, SECTOR } from "../_lib/pulse-data";

export const metadata: Metadata = { title: "Brand × state" };

export default function HeatmapPage({ searchParams }: PageProps<"/heatmap">) {
  return (
    <>
      <PageHeader title="Demand by brand × state" />
      <Suspense fallback={<LoadingCards rows={9} />}>
        <Heatmap searchParams={searchParams} />
      </Suspense>
    </>
  );
}

type Metric = { key: string; label: string; goodWhen: GoodWhen; description: string };

function metricsOf(definition: SurveyDefinition): Metric[] {
  return [
    {
      key: definition.composite.key,
      label: definition.composite.label.en,
      goodWhen: "high",
      description: "The weighted composite of the sub-indices. 50 means no change.",
    },
    ...definition.indicators.map((i) => ({
      key: i.key,
      label: i.label.en,
      goodWhen: i.goodWhen,
      description: i.description.en,
    })),
  ];
}

function statOf(definition: SurveyDefinition, group: GroupResult | undefined, metric: string): Stat | null {
  if (!group) return null;
  return metric === definition.composite.key ? group.composite : (group.indicators[metric] ?? null);
}

const BRAND_STATE = "brand_state";

async function Heatmap({ searchParams }: { searchParams: PageProps<"/heatmap">["searchParams"] }) {
  await io();
  const params = await searchParams;
  const pulse = await loadPulse(params.week);
  if (!pulse) {
    return (
      <EmptyState title="No answers yet">
        The brand × state view fills in as soon as dealers start answering this week&apos;s calls.
      </EmptyState>
    );
  }
  const { definition } = pulse;
  const cut = definition.cuts.find((c) => c.key === BRAND_STATE);
  if (!cut || cut.dims.length !== 2) return null;
  const [rowDim, colDim] = cut.dims as [string, string];

  const metrics = metricsOf(definition);
  const metric = metrics.find((m) => m.key === params.indicator) ?? metrics[0]!;
  const groups = new Map(
    (pulse.index.cuts[cut.key] ?? []).map((g) => [`${g.values[rowDim]}.${g.values[colDim]}`, g]),
  );
  const rows = dimensionValues(definition, SECTOR, rowDim);
  const cols = dimensionValues(definition, SECTOR, colDim);
  const visible = (g: GroupResult | undefined) =>
    !!g && !g.suppressed && (statOf(definition, g, metric.key)?.value ?? null) !== null;

  // The selected cell: from the URL, else the one with the most dealers.
  const requested = typeof params.cell === "string" && groups.has(params.cell) ? params.cell : null;
  const selected =
    requested ??
    [...groups.entries()]
      .filter(([, g]) => visible(g))
      .toSorted(([ka, a], [kb, b]) => b.n - a.n || (ka < kb ? -1 : 1))[0]?.[0] ??
    null;

  const base = (extra: Record<string, string>) => {
    const q: Record<string, string> = {};
    if (pulse.week !== pulse.latestWeek) q.week = weekLabel(pulse.week);
    if (metric.key !== metrics[0]!.key) q.indicator = metric.key;
    return { ...q, ...extra };
  };
  const pooled =
    cut.poolWeeks === 2
      ? `${formatWeekTitle(pulse.week)}, pooled with ${formatWeekShort(addWeeks(pulse.week, -1))}`
      : formatWeekTitle(pulse.week);

  return (
    <>
      <Panel className="grid gap-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">{pooled}</h2>
              {pulse.inProgress && (
                <Pill tone="accent" dot>
                  Live
                </Pill>
              )}
            </div>
            <p className="text-base text-muted">
              Cells need {cut.suppressBelow ?? 1}+ {SECTOR.nouns.other}. Pick a cell for detail.
            </p>
          </div>
          <WeekNav
            week={pulse.week}
            latestWeek={pulse.latestWeek}
            hasPrev={pulse.hasPrevWeek}
            hasNext={pulse.hasNextWeek}
            hrefFor={(w) => {
              const q = base(selected ? { cell: selected } : {});
              delete q.week;
              return { pathname: "/heatmap", query: w ? { ...q, week: w } : q };
            }}
          />
        </div>

        <nav aria-label="Indicator" className="flex flex-wrap gap-1.5">
          {metrics.map((m) => {
            const active = m.key === metric.key;
            const q = base(selected ? { cell: selected } : {});
            if (m.key === metrics[0]!.key) delete q.indicator;
            else q.indicator = m.key;
            return (
              <Link
                key={m.key}
                href={{ pathname: "/heatmap", query: q }}
                scroll={false}
                aria-current={active ? "true" : undefined}
                title={m.description}
                className={filterPillClass(active, "md")}
              >
                {m.label}
              </Link>
            );
          })}
        </nav>

        <SignalLegend hiddenNote={`fewer than ${cut.suppressBelow ?? 1} ${SECTOR.nouns.other}`} />

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-0.5 text-base [font-variant-numeric:tabular-nums]">
            <thead>
              <tr>
                <th className="px-2 py-2 text-left text-sm font-medium text-muted">
                  {definition.dimensions.find((d) => d.key === rowDim)?.label.en}
                </th>
                {cols.map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className="px-1 py-2 text-center text-sm font-medium whitespace-nowrap text-muted"
                  >
                    {dimensionValueLabel(definition, SECTOR, colDim, c, "short")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rowLabel = dimensionValueLabel(definition, SECTOR, rowDim, r);
                return (
                  <tr key={r}>
                    <th scope="row" className="px-2 py-1 text-left font-medium whitespace-nowrap">
                      {rowLabel}
                    </th>
                    {cols.map((c) => {
                      const key = `${r}.${c}`;
                      const g = groups.get(key);
                      const s = statOf(definition, g, metric.key);
                      const value = s?.value ?? null;
                      const colLabel = dimensionValueLabel(definition, SECTOR, colDim, c);
                      const isSelected = key === selected;
                      if (!g || g.suppressed || value === null) {
                        // Hidden because the cell is too small, because too few answered this
                        // indicator, or because there is nothing to show yet.
                        const why =
                          g?.suppressed
                            ? `fewer than ${cut.suppressBelow} ${SECTOR.nouns.other}`
                            : s?.suppressed
                              ? `fewer than ${cut.suppressBelow} answered ${metric.label}`
                              : `no ${metric.label} value yet`;
                        return (
                          <td key={c} className="p-0">
                            {g ? (
                              <Link
                                href={{ pathname: "/heatmap", query: base({ cell: key }) }}
                                scroll={false}
                                aria-label={`${rowLabel}, ${colLabel}: ${why}`}
                                title={`${rowLabel} · ${colLabel}: ${why}`}
                                className={`block rounded-md bg-line-soft/60 py-3.5 text-center text-faint ${isSelected ? "ring-2 ring-ink ring-inset" : "hover:bg-line-soft"}`}
                              >
                                —
                              </Link>
                            ) : (
                              <span
                                className="block rounded-md py-3.5 text-center text-line-strong"
                                aria-label={`${rowLabel}, ${colLabel}: no answers yet`}
                              >
                                ·
                              </span>
                            )}
                          </td>
                        );
                      }
                      return (
                        <td key={c} className="p-0">
                          <Link
                            href={{ pathname: "/heatmap", query: base({ cell: key }) }}
                            scroll={false}
                            aria-current={isSelected ? "true" : undefined}
                            aria-label={`${rowLabel}, ${colLabel}: ${formatIndex(value)}, ${s!.n} ${SECTOR.nouns.other}`}
                            title={`${rowLabel} · ${colLabel}: ${formatIndex(value)} (n = ${s!.n})`}
                            style={heatStyle(value, metric.goodWhen)}
                            className={`num block rounded-md py-3.5 text-center font-medium transition hover:brightness-95 ${isSelected ? "ring-2 ring-ink ring-offset-1 ring-offset-surface" : ""}`}
                          >
                            {value.toFixed(0)}
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {selected && (
        <CellDetail
          pulse={pulse}
          group={groups.get(selected)!}
          rowDim={rowDim}
          colDim={colDim}
          suppressBelow={cut.suppressBelow}
          pooledWeeks={cut.poolWeeks}
          metrics={metrics}
        />
      )}
    </>
  );
}

function CellDetail({
  pulse,
  group,
  rowDim,
  colDim,
  suppressBelow,
  pooledWeeks,
  metrics,
}: {
  pulse: LoadedPulse;
  group: GroupResult;
  rowDim: string;
  colDim: string;
  suppressBelow: number | null;
  pooledWeeks: number;
  metrics: Metric[];
}) {
  const { definition } = pulse;
  const rowLabel = dimensionValueLabel(definition, SECTOR, rowDim, group.values[rowDim]!);
  const colLabel = dimensionValueLabel(definition, SECTOR, colDim, group.values[colDim]!);
  const nat = nationalOf(definition, pulse.index);
  const weeks =
    pooledWeeks === 2
      ? `${formatWeekShort(addWeeks(pulse.week, -1))}–${formatWeekShort(pulse.week)}`
      : formatWeekShort(pulse.week);

  return (
    <Panel className="grid gap-6 py-8">
      <BoxHeader
        title={`${rowLabel} ${SECTOR.nouns.other} in ${colLabel}`}
        description={`Answers from ${weeks}, each ${SECTOR.nouns.one}'s latest week counted once.`}
        action={
          group.suppressed ? (
            <Pill>Hidden</Pill>
          ) : (
            <div className="flex flex-wrap justify-end gap-1.5">
              <Pill tone="accent">
                {group.n} {SECTOR.nouns.other}
                {group.composite.margin !== null && ` · ±${formatIndex(group.composite.margin)}`}
              </Pill>
              {group.lowN && <Pill tone="warn">Low n: read with care</Pill>}
            </div>
          )
        }
      />
      {group.suppressed ? (
        <p className="max-w-3xl text-base leading-relaxed text-muted">
          Fewer than {suppressBelow} {SECTOR.nouns.other} answered for this cell in {weeks}, so it stays
          hidden: a number from so few {SECTOR.nouns.other} wouldn&apos;t be reliable, and could point to who
          said it. It appears once {suppressBelow} have answered.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {metrics.map((m) => {
            const s = statOf(definition, group, m.key);
            const national = statOf(definition, nat ?? undefined, m.key)?.value ?? null;
            const ind = definition.indicators.find((i) => i.key === m.key);
            return (
              <div
                key={m.key}
                className="grid content-start gap-3 rounded-xl border border-line px-4 py-6"
                title={m.description}
              >
                <span className="min-h-12 text-base leading-6 text-muted">{m.label}</span>
                <span className="text-4xl font-semibold tracking-tight">{formatIndex(s?.value)}</span>
                <span className="grid gap-1 text-sm text-muted">
                  {s?.suppressed && (
                    <span>
                      Fewer than {suppressBelow} {SECTOR.nouns.other} answered this
                    </span>
                  )}
                  {s && s.value === null && s.n === 0 && (
                    <span>{ind?.rule.kind === "momentum" ? "Needs a second week of answers" : "No answers yet"}</span>
                  )}
                  {s && s.value !== null && s.lowN && !group.lowN && <span>Only {s.n} answered: read with care</span>}
                  <span>All India {formatIndex(national)}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
