import { BATCH_NOT_ALLOWED, type CallingScope, numberAllowed } from "../calling-policy";
import { TEST_CALL_ESTIMATE_CENTS } from "./test-call";

/**
 * Who a set calls, and why anyone isn't (spec §5.2). Pure: the dialer loads the facts, this decides.
 * A set is one run of a batch: every row, in order, one call at a time. Calls never overlap, so rows
 * can share a phone, and running a batch again calls everyone again (the newest good call wins in the
 * index). The dialer checks each row again just before dialling.
 */

/** What the spend cap assumes per call: the longest call we've seen. */
export const CALL_BUDGET_CENTS = TEST_CALL_ESTIMATE_CENTS;

export type PlanMember = { dealerId: string; phoneE164: string; language: string };

export type PlanAgent = { agentVersionId: string; bolnaAgentId: string; label: string };

export type ExclusionCode = "not_permitted" | "no_agent";

export const EXCLUSION_LABEL: Record<ExclusionCode, string> = {
  not_permitted: "Not allowed in testing mode",
  no_agent: "No agent for their language",
};

export type RowFacts = {
  scope: CallingScope;
  /** The current agent per language, for languages that have one. */
  agents: ReadonlyMap<string, PlanAgent>;
};

/** Why this row can't be called, or null if it can. */
export function memberExclusion(m: Omit<PlanMember, "dealerId">, f: RowFacts): ExclusionCode | null {
  if (!numberAllowed(m.phoneE164, f.scope)) return "not_permitted";
  if (!f.agents.has(m.language)) return "no_agent";
  return null;
}

export type SpendFacts = { spentCents: number; capCents: number };

export type SetFacts = RowFacts &
  SpendFacts & {
    callingEnabled: boolean;
    archived: boolean;
    /** Another set is being called: one at a time, across all batches. */
    anotherLive: boolean;
  };

export type SetRefusal = { code: string; detail: string };

export type SetPlan = {
  /** Why the set can't start at all, or null. */
  refusal: SetRefusal | null;
  /** Every row, with the reason if it's left out. */
  recipients: { dealerId: string; reason: ExclusionCode | null }[];
  excluded: { reason: ExclusionCode; n: number }[];
  callCount: number;
  estimateCents: number;
};

export function planSet(members: readonly PlanMember[], f: SetFacts): SetPlan {
  const recipients = members.map((m) => ({ dealerId: m.dealerId, reason: memberExclusion(m, f) }));
  const counts = new Map<ExclusionCode, number>();
  for (const { reason } of recipients) if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const callCount = recipients.filter((r) => r.reason === null).length;
  return {
    refusal: setRefusal(f, callCount, members.length > 0 && counts.get("not_permitted") === members.length),
    recipients,
    excluded: [...counts.entries()].map(([reason, n]) => ({ reason, n })).toSorted((a, b) => b.n - a.n),
    callCount,
    estimateCents: callCount * CALL_BUDGET_CENTS,
  };
}

function setRefusal(f: SetFacts, callCount: number, noneAllowed: boolean): SetRefusal | null {
  if (f.archived) return { code: "archived", detail: "This batch is archived." };
  if (f.anotherLive) return { code: "open_set", detail: "Another set is being called. Wait for it to finish, or stop it." };
  if (!f.callingEnabled) return { code: "calling_off", detail: "Calling is switched off (CALLING_ENABLED is not true)." };
  if (noneAllowed) return { code: "nobody", detail: BATCH_NOT_ALLOWED };
  if (callCount === 0) return { code: "nobody", detail: "Nobody in this batch can be called right now." };
  return spendRefusal(f);
}

/** Whether one more call fits the daily spend cap. */
export function spendRefusal(f: SpendFacts): SetRefusal | null {
  return f.spentCents + CALL_BUDGET_CENTS > f.capCents
    ? {
        code: "spend_cap",
        detail: `The daily spend cap is used up ($${(f.capCents / 100).toFixed(2)}, BOLNA_DAILY_SPEND_CAP_USD).`,
      }
    : null;
}
