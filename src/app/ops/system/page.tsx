import type { Metadata } from "next";
import { io } from "next/cache";
import { type ReactNode, Suspense } from "react";
import {
  CardHeader,
  KeyValues,
  LoadingCards,
  PageHeader,
  Panel,
  Pill,
  TableScroll,
  tableClass,
  tdClass,
  theadRowClass,
  thClass,
  trClass,
} from "@/components/ui";
import { AGENTS } from "@/lib/calls/agents";
import { db } from "@/lib/db/client";
import { listAgents } from "@/lib/db/queries/agents";
import { dataTotals } from "@/lib/db/queries/ops";
import { maskPhone } from "@/lib/domain/phone";
import { callingScope, env } from "@/lib/env";
import { formatIstDateTime } from "@/lib/format";
import { CALL_LANGUAGES } from "@/lib/reference/languages";

export const metadata: Metadata = { title: "System" };

/** A table card: header with padding, then a table running edge to edge. */
function TableCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel flush>
      <div className="px-5 pt-5 pb-4">
        <CardHeader title={title} />
      </div>
      <TableScroll>{children}</TableScroll>
    </Panel>
  );
}

export default function SystemPage() {
  return (
    <>
      <PageHeader title="System" />
      <Suspense fallback={<LoadingCards rows={7} />}>
        <SystemTables />
      </Suspense>
    </>
  );
}

async function SystemTables() {
  await io();
  const config = env();
  const scope = callingScope();
  const database = db();
  const [totals, agents] = await Promise.all([dataTotals(database), listAgents(database)]);

  return (
    <>
      <div className="grid gap-6 md:grid-cols-2">
        <Panel className="grid content-start gap-4">
          <CardHeader title="Calling safety" />
          <KeyValues
            roomy
            rows={[
              [
                "Calling",
                config.CALLING_ENABLED ? (
                  <Pill tone="warn" dot>
                    Enabled
                  </Pill>
                ) : (
                  <Pill tone="good" dot>
                    Off
                  </Pill>
                ),
              ],
              ["Mode", scope.mode === "production" ? <Pill tone="warn">Production</Pill> : <Pill tone="accent">Testing</Pill>],
              [
                "Allowed numbers",
                scope.mode === "production" ? "Any number" : scope.allowedNumbers.map(maskPhone).join(", ") || "None",
              ],
              ["Daily spend cap", `$${config.BOLNA_DAILY_SPEND_CAP_USD.toFixed(2)}`],
              ["Bolna API key", config.BOLNA_API_KEY ? <Pill tone="accent">Set</Pill> : <Pill>Not set</Pill>],
            ]}
          />
        </Panel>

        <Panel className="grid content-start gap-4">
          <CardHeader title="Data" />
          <KeyValues
            roomy
            rows={[
              ["Dealers", totals.dealers.toLocaleString("en-IN")],
              ["Batches", totals.batches.toLocaleString("en-IN")],
              ["Sets", totals.sets.toLocaleString("en-IN")],
              ["Calls", totals.calls.toLocaleString("en-IN")],
            ]}
          />
        </Panel>
      </div>

      <AgentsCard agents={agents} />
    </>
  );
}

/**
 * Each call language's agent: the registry in code (src/lib/calls/agents.ts) next to what
 * `pnpm agents:sync` last stored, whose id may be from this account's own `pnpm agents:create`. A registry
 * entry the database doesn't have yet shows as not synced.
 */
function AgentsCard({ agents }: { agents: Awaited<ReturnType<typeof listAgents>> }) {
  const rows = AGENTS.map((entry) => {
    const stored = agents.find(
      (a) =>
        a.surveySlug === entry.survey.slug &&
        a.surveyVersion === entry.survey.version &&
        a.language === entry.language,
    );
    const language = CALL_LANGUAGES.find((l) => l.code === entry.language);
    return { entry, language, stored: stored?.label === entry.label ? stored : null };
  });
  return (
    <TableCard title="Call agents">
      <table className={`${tableClass} min-w-[720px]`}>
        <thead>
          <tr className={`${theadRowClass} border-t`}>
            <th className={thClass}>Language</th>
            <th className={thClass}>Lab version</th>
            <th className={thClass}>Bolna agent</th>
            <th className={thClass}>Synced</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ entry, language, stored }) => (
            <tr key={`${entry.survey.slug}-${entry.survey.version}-${entry.language}`} className={trClass}>
              <td className={tdClass}>
                <div className="font-medium">{language?.name ?? entry.language}</div>
                {language && language.label !== language.name && (
                  <div className="text-xs text-faint">{language.label}</div>
                )}
              </td>
              <td className={`${tdClass} num text-xs`}>{entry.label}</td>
              <td className={`${tdClass} num text-xs text-muted`} title={stored?.bolnaAgentId ?? entry.bolnaAgentId}>
                {(stored?.bolnaAgentId ?? entry.bolnaAgentId).slice(0, 8)}…
              </td>
              <td className={`${tdClass} text-xs`}>
                {stored ? (
                  <>
                    <div>{formatIstDateTime(stored.syncedAt)}</div>
                    <div className="num text-faint">version {stored.version}</div>
                  </>
                ) : (
                  <Pill tone="warn">Not synced</Pill>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}
