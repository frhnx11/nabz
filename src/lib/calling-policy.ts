/**
 * Who can be called. `NABZ_MODE` and `ALLOWED_NUMBERS` (src/lib/env.ts) decide: in testing, only the
 * allowed numbers; in production, any valid number. Pure, and it reaches the browser, so the scope is
 * always passed in, never read from the environment here.
 */

export const CALLING_MODES = ["testing", "production"] as const;
export type CallingMode = (typeof CALLING_MODES)[number];

export type CallingScope = { mode: CallingMode; allowedNumbers: readonly string[] };

/** For code that only reads from Bolna: it can never place a call. */
export const NO_NUMBERS: CallingScope = { mode: "testing", allowedNumbers: [] };

const SWITCH_TO_PRODUCTION =
  "To call other numbers, set NABZ_MODE=production and add a premium Bolna API key in .env.local, then restart the app. See the README for the full steps.";

export const NUMBER_NOT_ALLOWED = `This number isn't allowed in testing mode. ${SWITCH_TO_PRODUCTION}`;
export const BATCH_NOT_ALLOWED = `No number in this batch is allowed in testing mode. ${SWITCH_TO_PRODUCTION}`;

export function numberAllowed(phoneE164: string, scope: CallingScope): boolean {
  return scope.mode === "production" || scope.allowedNumbers.includes(phoneE164);
}

/**
 * Why a dealer can't be saved with this number, or null if they can. A dealer keeping the number they
 * already have is always fine, so going back to testing doesn't lock anyone's details.
 */
export function dealerNumberRefusal(
  phoneE164: string,
  currentPhoneE164: string | null,
  scope: CallingScope,
): string | null {
  if (phoneE164 === currentPhoneE164 || numberAllowed(phoneE164, scope)) return null;
  return NUMBER_NOT_ALLOWED;
}

/** Hard ceilings that no configuration can exceed. */
export const CALLING_LIMITS = {
  /** The most dealers a batch can hold. */
  maxBatchSize: 500,
  maxDailySpendUsd: 10,
} as const;
