"use client";

import { type ReactNode, startTransition, useState } from "react";
import { DialogHeader, Field } from "@/components/dialog";
import { Button, inputClass } from "@/components/ui";
import { CITIES, getState, STATES } from "@/lib/reference/geo";
import { CALL_LANGUAGES } from "@/lib/reference/languages";
import { BRANDS, SEGMENTS } from "@/lib/sectors/vehicles";
import type { DealerFormValues } from "./actions";

/**
 * The dealer form shared by "Add dealer" and "Edit dealer": every field ops can set, Cancel and the
 * submit button at the bottom. Validation is server-side (parseNewDealer), shown per field.
 */
export function DealerForm({
  headingId,
  title,
  description,
  submitLabel,
  action,
  pending,
  values,
  errors,
  hidden = {},
  onCancel,
  footerStart,
}: {
  headingId: string;
  title: string;
  description: string;
  submitLabel: string;
  action: (formData: FormData) => void;
  pending: boolean;
  values: DealerFormValues;
  errors: Partial<Record<keyof DealerFormValues, string>>;
  /** Extra fields sent with the form (the dealer's id when editing). */
  hidden?: Record<string, string>;
  onCancel: () => void;
  /** Shown at the left of the buttons (the edit pop-up's Test call). */
  footerStart?: ReactNode;
}) {
  const [brand, setBrand] = useState(values.brand ?? "");
  const [cityCode, setCityCode] = useState(values.cityCode ?? "");
  const [language, setLanguage] = useState(values.language ?? "");
  const segment = SEGMENTS.find((s) => s.code === BRANDS.find((b) => b.code === brand)?.segment);
  const city = CITIES.find((c) => c.code === cityCode);
  const derived = [segment?.label, city && getState(city.state).name, city && `Tier ${city.tier}`].filter(
    Boolean,
  );

  return (
    <form
      // Submitted by hand rather than with `action={…}`: React resets a form after an action runs,
      // which would knock the brand and city dropdowns out of sync with what was chosen.
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(() => action(formData));
      }}
      className="grid gap-5 p-6"
      noValidate
    >
      <DialogHeader id={headingId} title={title} description={description} onClose={onCancel} />
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <Field label="Showroom name" name="businessName" error={errors.businessName}>
        <input
          name="businessName"
          defaultValue={values.businessName}
          required
          maxLength={120}
          autoComplete="organization"
          placeholder="e.g. Shree Balaji TVS"
          className={inputClass}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact person" name="contactName" error={errors.contactName} optional>
          <input name="contactName" defaultValue={values.contactName} maxLength={80} className={inputClass} />
        </Field>
        <Field label="Role" name="contactRole" error={errors.contactRole} optional>
          <input
            name="contactRole"
            defaultValue={values.contactRole}
            maxLength={60}
            placeholder="Sales manager"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Phone" name="phone" error={errors.phone}>
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          defaultValue={values.phone}
          required
          autoComplete="tel"
          placeholder="98765 43210"
          className={`${inputClass} num`}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Brand" name="brand" error={errors.brand}>
          <select
            name="brand"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            required
            className={inputClass}
          >
            <option value="" disabled>
              Choose a brand
            </option>
            {SEGMENTS.map((s) => (
              <optgroup key={s.code} label={s.label}>
                {BRANDS.filter((b) => b.segment === s.code).map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="City" name="cityCode" error={errors.cityCode}>
          <select
            name="cityCode"
            value={cityCode}
            onChange={(e) => setCityCode(e.target.value)}
            required
            className={inputClass}
          >
            <option value="" disabled>
              Choose a city
            </option>
            {STATES.map((st) => (
              <optgroup key={st.code} label={st.name}>
                {CITIES.filter((c) => c.state === st.code).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
      </div>

      {derived.length > 0 && <p className="-mt-2 text-xs text-muted">{derived.join(" · ")}</p>}

      <Field label="Call language" name="language" error={errors.language}>
        <select
          name="language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          required
          className={inputClass}
        >
          <option value="" disabled>
            Choose the language we call them in
          </option>
          {CALL_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name === l.label ? l.name : `${l.name} · ${l.label}`}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Notes" name="notes" error={errors.notes} optional>
        <textarea
          name="notes"
          defaultValue={values.notes}
          maxLength={500}
          rows={2}
          className={`${inputClass} resize-y`}
        />
      </Field>

      <div className="flex items-center justify-end gap-2 pt-1">
        {footerStart && <div className="mr-auto">{footerStart}</div>}
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
