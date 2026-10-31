import type { Metadata } from "next";
import { io } from "next/cache";
import { type ReactNode, Suspense } from "react";
import { KeyValues, LoadingCards, PageHeader, Panel, TableScroll, theadRowClass, trClass } from "@/components/ui";
import { questionRows, scoringRows } from "@/lib/index/methodology";
import { latestSurvey } from "@/lib/surveys/registry";
import { BoxHeader } from "../_lib/box-header";
import { loadDealerCounts, SECTOR } from "../_lib/pulse-data";

export const metadata: Metadata = { title: "Methodology" };

const DEFINITION = latestSurvey(SECTOR.pulseSurvey!);
const { composite } = DEFINITION;
const COMPOSITE = composite.label.en;

/** Bigger than the shared table classes, like the rest of the client pages. */
const tableClass = "w-full text-base [font-variant-numeric:tabular-nums]";
const thClass = "px-6 py-3 text-left text-sm font-medium whitespace-nowrap text-muted";
const tdClass = "px-6 py-5 align-top";

/** A card with a heading and a table running edge to edge. */
function TableCard({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <Panel flush>
      <div className="px-6 pt-8 pb-5">
        <BoxHeader title={title} description={description} />
      </div>
      <TableScroll>{children}</TableScroll>
    </Panel>
  );
}

function TextCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel className="grid content-start gap-5 py-8">
      <BoxHeader title={title} />
      <div className="grid gap-3 text-base leading-relaxed text-ink-2">{children}</div>
    </Panel>
  );
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="grid list-disc gap-3 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export default function MethodologyPage() {
  return (
    <>
      <PageHeader title="Methodology" />

      <QuestionsCard />
      <ScoringCard />

      <TextCard title={`The ${COMPOSITE}`}>
        <Bullets
          items={[
            <>
              <strong className="font-medium text-ink">For each {SECTOR.nouns.one}:</strong> the weighted average of the
              sub-indices they have a score for, using the weights above. Inverted sub-indices are flipped first (100 minus
              the score), and the weights are rescaled when some are missing. A {SECTOR.nouns.one} needs at least{" "}
              {composite.minComponents} sub-indices to get a score.
            </>,
            <>
              <strong className="font-medium text-ink">For a group:</strong> the plain average of its {SECTOR.nouns.other}
              &apos; scores. No {SECTOR.nouns.one} counts more than another.
            </>,
            <>
              <strong className="font-medium text-ink">Margin of error:</strong> the ± is a 95% margin, 1.96 × standard
              deviation ÷ √n. It&apos;s shown from 2 {SECTOR.nouns.other} up.
            </>,
          ]}
        />
      </TextCard>

      <Suspense fallback={<LoadingCards cards={2} rows={6} />}>
        <DealerCounts />
      </Suspense>
    </>
  );
}

function QuestionsCard() {
  return (
    <TableCard title="What dealers are asked" description="The questions, and what each answer feeds.">
      <table className={`${tableClass} min-w-[560px]`}>
        <thead>
          <tr className={`${theadRowClass} border-t`}>
            <th className={thClass}>English</th>
            <th className={thClass}>Feeds</th>
          </tr>
        </thead>
        <tbody>
          {questionRows(DEFINITION).map((q) => (
            <tr key={q.key} className={trClass}>
              <td className={tdClass}>{q.en}</td>
              <td className={tdClass}>
                {q.feeds.length > 0 ? (
                  q.feeds.join(", ")
                ) : (
                  <span className="text-muted">Not scored{q.checks ? `: only used to check “${q.checks}”` : ""}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

function ScoringCard() {
  return (
    <TableCard
      title="How answers are scored"
      description={`Each sub-index runs from 0 to 100, and 50 means no change. Weight is its share of the ${COMPOSITE}.`}
    >
      <table className={`${tableClass} min-w-[860px]`}>
        <thead>
          <tr className={`${theadRowClass} border-t`}>
            <th className={thClass}>Sub-index</th>
            <th className={thClass}>From</th>
            <th className={thClass}>Score</th>
            <th className={`${thClass} text-right`}>Weight</th>
          </tr>
        </thead>
        <tbody>
          {scoringRows(DEFINITION).map((r) => (
            <tr key={r.key} className={trClass}>
              <td className={`${tdClass} max-w-sm`}>
                <div className="font-medium">{r.label}</div>
                <div className="mt-1 text-sm text-muted">{r.description}</div>
              </td>
              <td className={tdClass}>{r.question}</td>
              <td className={tdClass}>{r.scoring}</td>
              <td className={`${tdClass} num text-right whitespace-nowrap`}>
                {r.weightPct === null ? "–" : `${r.weightPct}%`}
                {r.inverted && <div className="mt-1 text-sm text-muted">inverted</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

function CountsCard({ title, rows }: { title: string; rows: { label: string; n: number }[] }) {
  return (
    <Panel className="grid content-start gap-6 py-8">
      <BoxHeader title={title} />
      <KeyValues large rows={rows.map((r) => [r.label, r.n.toLocaleString("en-IN")])} />
    </Panel>
  );
}

async function DealerCounts() {
  await io();
  const counts = await loadDealerCounts();
  if (!counts) return null;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <CountsCard title="Dealers by brand" rows={counts.byBrand} />
      <CountsCard title="Dealers by state" rows={counts.byState} />
    </div>
  );
}
