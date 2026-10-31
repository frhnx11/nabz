import { z } from "zod";
import { CALLING_LIMITS } from "../calling-policy";

/** Validation for the batch form. Pure, so the same rules are unit-tested and used by the server action. */

export const BATCH_NAME_MAX = 60;

/** "Hero · Karnataka": the name of a company × state batch, the usual way to group dealers. */
export function cellBatchName(brandName: string, stateName: string): string {
  return `${brandName} · ${stateName}`;
}

export const BATCH_NOTES_MAX = 500;

const BatchForm = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the batch a name.")
    .max(BATCH_NAME_MAX, `Keep it under ${BATCH_NAME_MAX} characters.`),
  notes: z
    .string()
    .trim()
    .max(BATCH_NOTES_MAX, `Keep it under ${BATCH_NOTES_MAX} characters.`)
    .transform((v) => (v === "" ? null : v)),
  memberIds: z
    .array(z.uuid({ message: "Unknown dealer." }))
    .transform((ids) => [...new Set(ids)])
    .refine((ids) => ids.length <= CALLING_LIMITS.maxBatchSize, {
      message: `A batch can hold at most ${CALLING_LIMITS.maxBatchSize} dealers.`,
    }),
});

export type BatchInput = { name: string; notes: string | null; memberIds: string[] };

export type BatchFieldErrors = Partial<Record<"name" | "notes" | "memberIds", string>>;

export type BatchParseResult = { ok: true; batch: BatchInput } | { ok: false; errors: BatchFieldErrors };

export function parseBatchForm(form: {
  name: unknown;
  notes?: unknown;
  memberIds: unknown;
}): BatchParseResult {
  const result = BatchForm.safeParse({ ...form, notes: form.notes ?? "" });
  if (result.success) return { ok: true, batch: result.data };
  const errors: BatchFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof BatchFieldErrors | undefined;
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return { ok: false, errors };
}
