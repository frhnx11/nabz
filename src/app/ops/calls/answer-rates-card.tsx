import { io } from "next/cache";
import {
  CardHeader,
  Panel,
  Pill,
  TableScroll,
  tableClass,
  tdClass,
  theadRowClass,
  thClass,
  trClass,
} from "@/components/ui";
import { answerRates, NEEDS_WORK_SHARE } from "@/lib/calls/answer-rates";
import { ANSWER_STATUS_LABEL } from "@/lib/calls/answer-status";
import { db } from "@/lib/db/client";
import { answerRateInputs } from "@/lib/db/queries/calls";
import { weekLabel } from "@/lib/domain/week";
import { getSector } from "@/lib/sectors/registry";

/** Columns, as shares of the dealers asked ("not asked" is a share of all surveyed calls). */
const COLUMNS = ["answered", "dont_know", "declined", "unclear", "not_asked"] as const;

const pct = (share: number) => `${Math.round(share * 100)}%`;

/**
 * "Answers by question": for each question, how the dealers who were asked it responded. A
 * question many can't or won't answer needs rewording (or a different person to ask).
 */
export async function AnswerRatesCard() {
  await io();
  const survey = getSector("vehicles").pulseSurvey;
  if (!survey) return null;
  const inputs = await answerRateInputs(db(), { surveySlug: survey });
  if (!inputs) return null;
  const rates = answerRates(inputs.definition, inputs.calls);
  const { fromWeek, toWeek } = inputs;

  return (
    <Panel flush>
      <div className="p-6 pb-4">
        <CardHeader
          title="Answers by question"
          description={`Of the dealers asked each question, how many answered. Only real answers count in the index; the rest are recorded with the reason. A question where ${pct(NEEDS_WORK_SHARE)} or more didn't know or declined needs rewording.`}
        />
      </div>
      <div className="border-t border-line">
        <div className="px-5 pt-4 pb-2 text-xs text-faint">
          {fromWeek === toWeek ? weekLabel(toWeek) : `${weekLabel(fromWeek)} to ${weekLabel(toWeek)}`} ·{" "}
          <span className="num">{rates[0]?.calls ?? 0}</span> surveyed calls
        </div>
        <TableScroll>
          <table className={`${tableClass} min-w-[720px]`}>
            <thead>
              <tr className={theadRowClass}>
                <th className={thClass}>Question</th>
                <th className={`${thClass} text-right`}>Asked</th>
                {COLUMNS.map((s) => (
                  <th key={s} className={`${thClass} text-right`}>
                    {ANSWER_STATUS_LABEL[s]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.key} className={trClass}>
                  <td className={tdClass}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.label}</span>
                      {r.needsWork && <Pill tone="warn">Needs rewording</Pill>}
                    </div>
                    {!r.index && <div className="text-xs text-faint">Not in the index</div>}
                  </td>
                  <td className={`${tdClass} num text-right`}>{r.asked}</td>
                  {COLUMNS.map((s) => (
                    <td
                      key={s}
                      className={`${tdClass} num text-right ${r.counts[s] === 0 ? "text-faint" : s === "answered" ? "font-medium" : ""}`}
                      title={`${r.counts[s]} of ${s === "not_asked" ? r.calls : r.asked}`}
                    >
                      {r.counts[s] === 0 ? "—" : pct(r.share[s])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </Panel>
  );
}
