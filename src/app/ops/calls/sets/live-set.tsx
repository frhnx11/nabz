"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button, linkClass, Panel, Pill, TableScroll, tableClass, tdClass, theadRowClass, thClass } from "@/components/ui";
import { setStatusLabel } from "@/lib/calls/set-status";
import type { SetDetail } from "@/lib/db/queries/sets";
import { formatCost, formatIstDateTime, formatWeekShort } from "@/lib/format";
import { advanceSetAction, stopSetAction } from "../actions";

const STEP_EVERY_MS = 5000;

/**
 * One set, row by row. While the set is live this page is what moves it on: every few seconds it asks
 * for the next step, so the highlighted row is the one being called. Closing the page pauses the set,
 * and reopening it carries on.
 */
export function LiveSet({ id, initial }: { id: string; initial: SetDetail }) {
  const [detail, setDetail] = useState(initial);
  const [stopping, startStop] = useTransition();
  const busy = useRef(false);
  const live = detail.live;

  useEffect(() => {
    if (!live) return;
    let alive = true;
    const step = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const next = await advanceSetAction(id);
        if (alive && next) setDetail(next);
      } catch {
        // A failed step is retried on the next tick.
      } finally {
        busy.current = false;
      }
    };
    void step();
    const timer = setInterval(() => void step(), STEP_EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, live]);

  const { set, rows } = detail;
  const status = setStatusLabel(set.status);

  return (
    <Panel flush>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">{set.batchName ?? "No batch"}</h2>
            <Pill tone={status.tone} dot>
              {status.label}
            </Pill>
          </div>
          <p className="text-xs text-muted">
            {formatWeekShort(set.weekStart)} · started {formatIstDateTime(set.at)} ·{" "}
            <span className="num">
              {detail.finished} of {detail.counted}
            </span>{" "}
            done · {formatCost(detail.costCents).inr}
          </p>
          {set.stopReason && <p className="text-sm text-bad">{set.stopReason}</p>}
        </div>
        <div className="flex items-center gap-3">
          <Link href={{ pathname: "/ops/calls", query: { set: id } }} className={`${linkClass} text-sm`}>
            See these calls
          </Link>
          {live && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={stopping}
              onClick={() =>
                startStop(async () => {
                  const next = await stopSetAction(id);
                  if (next) setDetail(next);
                })
              }
            >
              {stopping ? "Stopping…" : "Stop"}
            </Button>
          )}
        </div>
      </div>
      <TableScroll>
        <table className={`${tableClass} min-w-[560px]`}>
          <thead>
            <tr className={`${theadRowClass} border-t`}>
              <th className={thClass}>Dealer</th>
              <th className={thClass}>City</th>
              <th className={thClass}>Language</th>
              <th className={thClass}>Call</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const calling = r.state === "calling";
              return (
                <tr
                  key={r.recipientId}
                  aria-current={calling ? "true" : undefined}
                  className={`border-b border-line-soft transition last:border-0 ${calling ? "bg-accent-tint font-medium" : ""}`}
                >
                  <td className={tdClass}>{r.name}</td>
                  <td className={`${tdClass} text-muted`}>{r.city}</td>
                  <td className={`${tdClass} text-muted`}>{r.language}</td>
                  <td className={tdClass}>
                    {r.callId && !calling ? (
                      <Link href={{ pathname: "/ops/calls", query: { set: id, call: r.callId } }} scroll={false}>
                        <Pill tone={r.tone} dot>
                          {r.label}
                        </Pill>
                      </Link>
                    ) : (
                      <Pill tone={r.tone} dot={calling}>
                        {r.label}
                      </Pill>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </Panel>
  );
}
