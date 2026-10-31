"use client";

import { startTransition, useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { DialogHeader, dialogClass, Field, PlusIcon, Toast } from "@/components/dialog";
import { Button, inputClass, Pill } from "@/components/ui";
import { BATCH_NAME_MAX, BATCH_NOTES_MAX, cellBatchName } from "@/lib/batches/form";
import type { PickerDealer } from "@/lib/db/queries/batches";
import { getState, STATES } from "@/lib/reference/geo";
import { BRANDS } from "@/lib/sectors/vehicles";
import { getBatchPicker, type SaveBatchState, saveBatchAction } from "./actions";

type EditableBatch = { id: string; name: string; notes: string | null };

const brandLabel = new Map<string, string>(BRANDS.map((b) => [b.code, b.label]));

/**
 * "New batch" (or "Edit") button plus the pop-up form: name, notes and a checklist of dealers.
 * A dealer already in another batch is shown but can't be ticked.
 */
export function BatchEditor({ batch }: { batch?: EditableBatch }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [session, setSession] = useState(0);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const titleId = useId();

  return (
    <>
      {batch ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setSession((s) => s + 1);
            setOpen(true);
            dialogRef.current?.showModal();
          }}
        >
          Edit
        </Button>
      ) : (
        <Button
          type="button"
          onClick={() => {
            setSession((s) => s + 1);
            setOpen(true);
            dialogRef.current?.showModal();
          }}
        >
          <PlusIcon />
          New batch
        </Button>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className={dialogClass("lg")}
        onClick={(e) => {
          // Clicking the dimmed backdrop (the dialog element itself) closes it.
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        onClose={() => setOpen(false)}
      >
        {open && (
          <BatchForm
            key={session}
            titleId={titleId}
            batch={batch}
            onCancel={() => dialogRef.current?.close()}
            onSaved={(message) => {
              dialogRef.current?.close();
              setToast(message);
            }}
          />
        )}
      </dialog>

      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

function BatchForm({
  titleId,
  batch,
  onCancel,
  onSaved,
}: {
  titleId: string;
  batch?: EditableBatch;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const [state, dispatch, pending] = useActionState<SaveBatchState, FormData>(saveBatchAction, {
    status: "idle",
  });
  const [name, setName] = useState(batch?.name ?? "");
  const [loaded, setLoaded] = useState<PickerDealer[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);

  // Load the checklist (and, when editing, who is in the batch).
  useEffect(() => {
    let live = true;
    getBatchPicker(batch?.id ?? null).then(
      (r) => {
        if (!live) return;
        setLoaded(r.dealers);
        setSelected(new Set(r.memberIds));
      },
      () => live && setLoadFailed(true),
    );
    return () => {
      live = false;
    };
  }, [batch?.id]);

  // Close and confirm once per save (closing the native dialog is a DOM side effect).
  const handledSave = useRef(0);
  useEffect(() => {
    if (state.status !== "saved" || state.savedAt === handledSave.current) return;
    handledSave.current = state.savedAt;
    onSaved(`${state.created ? "Created" : "Saved"} ${state.name}`);
  }, [state, onSaved]);

  const loading = !loaded;
  const dealers = useMemo(() => loaded ?? [], [loaded]);
  const takenElsewhere = (d: PickerDealer) => d.batch !== null && d.batch.id !== batch?.id;

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return dealers.filter((d) => {
      if (brand && d.brand !== brand) return false;
      if (stateFilter && d.stateCode !== stateFilter) return false;
      if (onlySelected && !selected.has(d.id)) return false;
      const text =
        `${d.businessName} ${brandLabel.get(d.brand) ?? d.brand} ${d.city} ${d.state}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [dealers, query, brand, stateFilter, onlySelected, selected]);
  const selectable = shown.filter((d) => !takenElsewhere(d));
  const allShownSelected = selectable.length > 0 && selectable.every((d) => selected.has(d.id));

  // Company × state is the usual batch: offer its name when the selection (or the filter) is one cell.
  const cellName = (brandCode: string, stateCode: string) =>
    cellBatchName(brandLabel.get(brandCode) ?? brandCode, getState(stateCode).name);
  const chosen = dealers.filter((d) => selected.has(d.id));
  const first = chosen[0];
  const suggestedName =
    first && chosen.every((d) => d.brand === first.brand && d.stateCode === first.stateCode)
      ? cellName(first.brand, first.stateCode)
      : null;
  const filterCell = brand && stateFilter ? cellName(brand, stateFilter) : null;

  const errors = state.status === "error" ? state.errors : {};
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form
      // Submitted by hand (see CLAUDE.md): the checklist and filters are controlled state.
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        if (batch) formData.set("batchId", batch.id);
        formData.delete("memberIds");
        for (const id of selected) formData.append("memberIds", id);
        startTransition(() => dispatch(formData));
      }}
      className="grid gap-5 p-6"
      noValidate
    >
      <DialogHeader
        id={titleId}
        title={batch ? `Edit ${batch.name}` : "New batch"}
        description="A saved group of dealers. Each dealer can be in one batch. Nothing is called."
        onClose={onCancel}
      />

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Field label="Name" name="name" error={errors.name}>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={BATCH_NAME_MAX}
            placeholder="e.g. Hero · Karnataka"
            className={inputClass}
          />
        </Field>
        <Field label="Notes" name="notes" error={errors.notes} optional>
          <input
            name="notes"
            defaultValue={batch?.notes ?? ""}
            maxLength={BATCH_NOTES_MAX}
            className={inputClass}
          />
        </Field>
        {suggestedName && name.trim() !== suggestedName && (
          <button
            type="button"
            onClick={() => setName(suggestedName)}
            className="-mt-2 justify-self-start text-xs font-medium text-accent hover:underline sm:col-span-2"
          >
            Name it “{suggestedName}”
          </button>
        )}
      </div>

      <div className="grid gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-muted">Dealers</span>
          <span className="text-xs text-muted">
            <span className="font-semibold text-ink">{selected.size}</span> selected
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, city, brand…"
            aria-label="Search dealers"
            className={inputClass}
          />
          <select
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            aria-label="Brand"
            className={inputClass}
          >
            <option value="">All brands</option>
            {BRANDS.map((b) => (
              <option key={b.code} value={b.code}>
                {b.label}
              </option>
            ))}
          </select>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            aria-label="State"
            className={inputClass}
          >
            <option value="">All states</option>
            {STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={allShownSelected}
              disabled={selectable.length === 0}
              onChange={() => {
                setSelected((s) => {
                  const next = new Set(s);
                  for (const d of selectable) {
                    if (allShownSelected) next.delete(d.id);
                    else next.add(d.id);
                  }
                  return next;
                });
                // Filling a whole company × state cell names an unnamed batch after it.
                if (!allShownSelected && filterCell && name.trim() === "") setName(filterCell);
              }}
              className="size-4 accent-accent"
            />
            {filterCell
              ? `Select all ${filterCell} dealers (${selectable.length})`
              : `Select all shown (${selectable.length})`}
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlySelected}
              onChange={(e) => setOnlySelected(e.target.checked)}
              className="size-4 accent-accent"
            />
            Only selected
          </label>
        </div>

        {errors.memberIds && <p className="text-xs text-bad">{errors.memberIds}</p>}

        <div className="max-h-80 overflow-y-auto rounded-xl border border-line">
          {loadFailed ? (
            <p className="px-4 py-10 text-center text-sm text-bad">
              Couldn&apos;t load dealers. Close and try again.
            </p>
          ) : loading ? (
            <p className="px-4 py-10 text-center text-sm text-faint">Loading dealers…</p>
          ) : shown.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-faint">
              {dealers.length === 0 ? "No dealers yet. Add them on the Dealers tab." : "No dealers match."}
            </p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {shown.map((d) => {
                const taken = takenElsewhere(d);
                return (
                  <li key={d.id}>
                    <label
                      className={`flex items-center gap-3 px-3.5 py-2.5 ${taken ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:bg-bg"}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(d.id)}
                        disabled={taken}
                        onChange={() => toggle(d.id)}
                        className="size-4 shrink-0 accent-accent"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.businessName}</span>
                        <span className="block truncate text-xs text-muted">
                          {brandLabel.get(d.brand) ?? d.brand} · {d.city}, {d.state}
                        </span>
                      </span>
                      {taken && <span className="shrink-0 text-xs text-faint">in {d.batch!.name}</span>}
                      {!taken && d.notPermitted && (
                        <span className="shrink-0" title="Stays in the batch but is skipped when it's called">
                          <Pill tone="warn">Not allowed in testing mode</Pill>
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || loading}>
          {pending ? "Saving…" : batch ? "Save batch" : "Create batch"}
        </Button>
      </div>
    </form>
  );
}
