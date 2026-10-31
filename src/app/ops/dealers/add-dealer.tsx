"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { dialogClass, PlusIcon, Toast } from "@/components/dialog";
import { Button } from "@/components/ui";
import { addDealer, type DealerFormState, type DealerFormValues } from "./actions";
import { DealerForm } from "./dealer-form";

/** "Add dealer" button plus the pop-up form. Saves a real dealer and refreshes the table. */
export function AddDealer() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<DealerFormState, FormData>(addDealer, { status: "idle" });
  const [formKey, setFormKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  // Errors belong to the current attempt; closing the pop-up discards them and the typed values.
  const [showResult, setShowResult] = useState(true);

  // After a successful save, start the next form empty and confirm briefly. Handled during render
  // (once per save) rather than in an effect, as React recommends for state derived from new props.
  const [handledSave, setHandledSave] = useState(0);
  if (state.status === "saved" && state.savedAt !== handledSave) {
    setHandledSave(state.savedAt);
    setFormKey((k) => k + 1);
    setToast(`Added ${state.name}`);
  }

  // Closing the native dialog is a DOM side effect, so it belongs in an effect.
  useEffect(() => {
    if (state.status === "saved") dialogRef.current?.close();
  }, [state]);

  const values: DealerFormValues = showResult && state.status === "error" ? state.values : {};
  const errors = showResult && state.status === "error" ? state.errors : {};

  return (
    <>
      <Button type="button" onClick={() => dialogRef.current?.showModal()}>
        <PlusIcon />
        Add dealer
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby="add-dealer-title"
        className={dialogClass("md")}
        onClick={(e) => {
          // Clicking the dimmed backdrop (the dialog element itself) closes it.
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        onClose={() => {
          setShowResult(false);
          setFormKey((k) => k + 1);
        }}
      >
        <DealerForm
          key={formKey}
          headingId="add-dealer-title"
          title="Add a dealer"
          description="Saved to the panel as a real dealer. Nothing is called."
          submitLabel="Add dealer"
          action={(formData) => {
            setShowResult(true);
            action(formData);
          }}
          pending={pending}
          values={values}
          errors={errors}
          onCancel={() => dialogRef.current?.close()}
        />
      </dialog>

      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}
