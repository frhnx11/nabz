/**
 * The languages Nabz can call a dealer in: one call agent each (call-lab: hi04, en01, ta02, bn01, …).
 * A dealer's `language` is always one of these, and it is the language we always call them in.
 *
 * Codes are BCP 47. Bolna's Sarvam setup uses its own code for Odia ("od"), kept here so the mapping
 * lives in one place. Urdu isn't listed: Bolna has no Sarvam Urdu, so there is no Urdu agent (the
 * Hindi agent covers spoken Urdu).
 */
export const CALL_LANGUAGES = [
  { code: "en", name: "English", label: "English" },
  { code: "hi", name: "Hindi", label: "हिन्दी" },
  { code: "bn", name: "Bengali", label: "বাংলা" },
  { code: "mr", name: "Marathi", label: "मराठी" },
  { code: "te", name: "Telugu", label: "తెలుగు" },
  { code: "ta", name: "Tamil", label: "தமிழ்" },
  { code: "gu", name: "Gujarati", label: "ગુજરાતી" },
  { code: "kn", name: "Kannada", label: "ಕನ್ನಡ" },
  { code: "or", name: "Odia", label: "ଓଡ଼ିଆ", sarvam: "od" },
  { code: "ml", name: "Malayalam", label: "മലയാളം" },
  { code: "pa", name: "Punjabi", label: "ਪੰਜਾਬੀ" },
  { code: "as", name: "Assamese", label: "অসমীয়া" },
] as const satisfies readonly { code: string; name: string; label: string; sarvam?: string }[];

export type CallLanguage = (typeof CALL_LANGUAGES)[number]["code"];

export const CALL_LANGUAGE_CODES = CALL_LANGUAGES.map((l) => l.code) as [CallLanguage, ...CallLanguage[]];

/** "Tamil", or the code itself for anything unknown (rows from before the list existed). */
export function languageName(code: string): string {
  return CALL_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}
