import { callRefusal } from "../bolna/client";
import type { CallingScope } from "../calling-policy";

/**
 * Test calls (the dealer pop-up): one real call to hear the agent, which changes no data. Only calls
 * made from a set count. A test call has no call row and carries no call reference, so nothing Bolna
 * reports about it can ever link back to a dealer. Pure.
 */

/** The longest call we've seen (155 s). A test call's real cost is never fetched, so this stands in for it. */
export const TEST_CALL_ESTIMATE_CENTS = 18;

export type TestCallFacts = {
  callingEnabled: boolean;
  scope: CallingScope;
  /** The dealer's number, or null if there's no such dealer. */
  phoneE164: string | null;
  /** A current agent exists for the dealer's language on the latest survey. */
  hasAgent: boolean;
  language: string;
  spentCents: number;
  capCents: number;
};

export type TestCallRefusal = { code: string; detail: string };

/** Why this test call can't be placed, or null. */
export function testCallRefusal(f: TestCallFacts): TestCallRefusal | null {
  if (!f.phoneE164) return { code: "no_dealer", detail: "This dealer can't be called." };
  const blocked = callRefusal(f.phoneE164, { callingEnabled: f.callingEnabled, scope: f.scope });
  if (blocked) return { code: f.callingEnabled ? "number_not_permitted" : "calling_off", detail: blocked };
  if (!f.hasAgent) {
    return { code: "no_agent", detail: `No agent is synced for ${f.language}. Run pnpm agents:sync.` };
  }
  if (f.spentCents + TEST_CALL_ESTIMATE_CENTS > f.capCents) {
    return {
      code: "spend_cap",
      detail: `This would pass the daily spend cap ($${(f.capCents / 100).toFixed(2)}, BOLNA_DAILY_SPEND_CAP_USD).`,
    };
  }
  return null;
}

/** What the agent's prompt needs. Deliberately no `nabz_call_ref`: nothing Bolna reports can link back. */
export function testCallUserData(d: { businessName: string; brand: string; city: string }): Record<string, string> {
  return { dealer_name: d.businessName, brand: d.brand, city: d.city, repeat_call: "no" };
}
