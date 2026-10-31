export type PhoneKind = "mobile" | "landline";

export type NormalisedPhone = { e164: string; kind: PhoneKind };

// National significant number is 10 digits and never starts with 0. Mobiles start with 6-9;
// landlines start with their STD code.
const REAL_RE = /^\+91[1-9]\d{9}$/;
const MOBILE_RE = /^\+91[6-9]\d{9}$/;

/**
 * Normalises an Indian phone number to E.164 (+91 followed by 10 digits).
 * Accepts the forms people actually type: 9000012345, 09000012345, 919000012345,
 * +91 90000 12345, 0091-9000012345. Returns null for anything that isn't a valid Indian number.
 */
export function normalisePhone(input: string): NormalisedPhone | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (/[^\d\s\-().+]/.test(trimmed)) return null;
  // At most one "+", and only before any digit (so "(+91)" is fine but "91+63…" is not).
  const plusIdx = trimmed.indexOf("+");
  if (
    plusIdx !== -1 &&
    (trimmed.indexOf("+", plusIdx + 1) !== -1 || /[^\s(]/.test(trimmed.slice(0, plusIdx)))
  ) {
    return null;
  }
  const hasPlus = plusIdx !== -1;
  const digits = trimmed.replace(/\D/g, "");

  let national: string | null = null;
  if (hasPlus) {
    if (digits.startsWith("91") && digits.length === 12) national = digits.slice(2);
  } else if (digits.startsWith("0091") && digits.length === 14) {
    national = digits.slice(4);
  } else if (digits.startsWith("91") && digits.length === 12) {
    national = digits.slice(2);
  } else if (digits.startsWith("0") && digits.length === 11) {
    national = digits.slice(1);
  } else if (digits.length === 10) {
    national = digits;
  }
  if (national === null) return null;

  const e164 = `+91${national}`;
  if (!REAL_RE.test(e164)) return null;
  return { e164, kind: MOBILE_RE.test(e164) ? "mobile" : "landline" };
}

/** "+919000012345" → "+91•••••2345". For ops screens and logs; clients never see numbers at all. */
export function maskPhone(e164: string): string {
  if (e164.length < 8) return "•••";
  return `${e164.slice(0, 3)}•••••${e164.slice(-4)}`;
}
