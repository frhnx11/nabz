import { z } from "zod";
import { normalisePhone } from "../domain/phone";
import { CITIES, getCity } from "../reference/geo";
import { CALL_LANGUAGE_CODES, type CallLanguage } from "../reference/languages";
import { BRANDS, type Brand } from "../sectors/vehicles";

/**
 * Validation for the dealer form ("Add dealer" and "Edit dealer"). Pure, so the same rules are
 * unit-tested and used by the server actions. Segment, state and tier are derived (from brand and
 * city), never typed. The language is chosen by hand: it's the language we always call the dealer
 * in, not guessed from the city.
 */

const brandCodes = BRANDS.map((b) => b.code) as [Brand, ...Brand[]];
const cityCodes = CITIES.map((c) => c.code) as [string, ...string[]];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

const NewDealerForm = z.object({
  businessName: z
    .string()
    .trim()
    .min(2, "Enter the showroom's name.")
    .max(120, "Keep it under 120 characters."),
  contactName: optionalText(80),
  contactRole: optionalText(60),
  phone: z.string().trim().min(1, "Enter a phone number."),
  brand: z.enum(brandCodes, { message: "Choose a brand." }),
  cityCode: z.enum(cityCodes, { message: "Choose a city." }),
  language: z.enum(CALL_LANGUAGE_CODES, { message: "Choose a language." }),
  notes: optionalText(500),
});

export type NewDealer = {
  businessName: string;
  contactName: string | null;
  contactRole: string | null;
  phoneE164: string;
  brand: Brand;
  segment: "two_wheeler" | "car";
  cityCode: string;
  language: CallLanguage;
  notes: string | null;
};

export type FieldErrors = Partial<
  Record<"businessName" | "contactName" | "contactRole" | "phone" | "brand" | "cityCode" | "language" | "notes", string>
>;

export type ParseResult = { ok: true; dealer: NewDealer } | { ok: false; errors: FieldErrors };

export function parseNewDealer(form: Record<string, unknown>): ParseResult {
  const result = NewDealerForm.safeParse(form);
  const errors: FieldErrors = {};
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof FieldErrors | undefined;
      if (field && !errors[field]) errors[field] = issue.message;
    }
    return { ok: false, errors };
  }

  const data = result.data;
  const phone = normalisePhone(data.phone);
  if (!phone) return { ok: false, errors: { phone: "That isn't a valid Indian phone number." } };

  const brand = BRANDS.find((b) => b.code === data.brand);
  const city = getCity(data.cityCode);
  return {
    ok: true,
    dealer: {
      businessName: data.businessName,
      contactName: data.contactName,
      contactRole: data.contactRole ?? "Sales manager",
      phoneE164: phone.e164,
      brand: data.brand,
      segment: brand?.segment ?? "two_wheeler",
      cityCode: city.code,
      language: data.language,
      notes: data.notes,
    },
  };
}
