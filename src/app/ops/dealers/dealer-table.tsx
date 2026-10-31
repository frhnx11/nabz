"use client";

import { useState } from "react";
import { Toast } from "@/components/dialog";
import { TableScroll, tableClass, tdClass, theadRowClass, thClass, trClass } from "@/components/ui";
import { EditDealer } from "./edit-dealer";

/** One dealer as the table shows it: display text only (the phone already masked). */
export type DealerRow = {
  id: string;
  businessName: string;
  contactName: string | null;
  brand: string;
  city: string;
  state: string;
  phone: string;
  language: string;
};

/** The dealers table: display only. Clicking a row opens the edit pop-up. */
export function DealerTable({ rows }: { rows: DealerRow[] }) {
  // A fresh key per opening, so each pop-up starts from the saved details.
  const [editing, setEditing] = useState<{ id: string; n: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  return (
    <>
      <TableScroll>
        <table className={`${tableClass} min-w-[880px]`}>
          <thead>
            <tr className={theadRowClass}>
              <th className={thClass}>Business</th>
              <th className={thClass}>Brand</th>
              <th className={thClass}>City</th>
              <th className={thClass}>State</th>
              <th className={thClass}>Phone</th>
              <th className={thClass}>Call language</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const open = () => setEditing((e) => ({ id: r.id, n: (e?.n ?? 0) + 1 }));
              return (
                <tr key={r.id} className={`${trClass} cursor-pointer hover:bg-accent-soft`} onClick={open}>
                  <td className={tdClass}>
                    {/* The row is the click target; the button makes it reachable by keyboard. */}
                    <button
                      type="button"
                      className="text-left font-medium hover:text-accent focus-visible:text-accent"
                    >
                      {r.businessName}
                    </button>
                    {r.contactName && <div className="text-xs text-faint">{r.contactName}</div>}
                  </td>
                  <td className={tdClass}>{r.brand}</td>
                  <td className={tdClass}>{r.city}</td>
                  <td className={tdClass}>{r.state}</td>
                  <td className={`${tdClass} num text-xs text-muted`}>{r.phone}</td>
                  <td className={tdClass}>{r.language}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>

      {editing && (
        <EditDealer
          key={editing.n}
          dealerId={editing.id}
          onDone={(savedName) => {
            setEditing(null);
            if (savedName) setToast(`Saved ${savedName}`);
          }}
        />
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}
