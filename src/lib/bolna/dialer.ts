import { eq } from "drizzle-orm";
import { agentFor } from "../calls/agents";
import type { CallingScope } from "../calling-policy";
import { TEST_CALL_ESTIMATE_CENTS, testCallRefusal, testCallUserData } from "../calls/test-call";
import type { Db } from "../db/client";
import { spentLast24hCents } from "../db/queries/spend";
import { dealers, dialerLog } from "../db/schema";
import { maskPhone } from "../domain/phone";
import { isUuid } from "../domain/uuid";
import { getCity } from "../reference/geo";
import { languageName, type CallLanguage } from "../reference/languages";
import { getSector, vocabLabel } from "../sectors/registry";
import { BolnaError, type BolnaClient, CallRefused } from "./client";
import { agentOf, dealerColumns, latestSurveyOf } from "./dialer-facts";

/**
 * The only code that places calls (spec §5.2). Today: test calls from the dealer pop-up, which change
 * no data (src/lib/calls/test-call.ts). The only row one writes is its line in `dialer_log`, the safety
 * record of every dialling decision, which is also how test calls count toward the daily spend cap.
 */

export type DialerConfig = {
  callingEnabled: boolean;
  scope: CallingScope;
  capUsd: number;
  actor: string;
};

/** Everything a test call depends on, read fresh each time. Queries run one after another. */
async function testCallFacts(db: Pick<Db, "select">, dealerId: string, config: DialerConfig, now: Date) {
  const [dealer] = isUuid(dealerId) ? await db.select(dealerColumns).from(dealers).where(eq(dealers.id, dealerId)) : [];
  const language = (dealer?.language ?? "hi") as CallLanguage;
  const sector = dealer ? getSector(dealer.sectorSlug) : null;
  const survey = dealer ? await latestSurveyOf(db, dealer.sectorSlug) : null;
  const agent = survey ? await agentOf(db, survey.id, language) : null;
  const spentCents = await spentLast24hCents(db, now);
  const refusal = testCallRefusal({
    callingEnabled: config.callingEnabled,
    scope: config.scope,
    phoneE164: dealer?.phoneE164 ?? null,
    hasAgent: agent !== null,
    language: languageName(language),
    spentCents,
    capCents: Math.round(config.capUsd * 100),
  });
  return { dealer, sector, survey, agent, language, refusal };
}

export type TestCallPreview = {
  phone: string | null;
  language: string;
  agentLabel: string | null;
  tested: boolean;
  estimateCents: number;
  /** Why the call can't be placed, or null if it can. */
  refusal: string | null;
};

/** What pressing Test call would do. Writes nothing. */
export async function testCallPreview(
  db: Pick<Db, "select">,
  dealerId: string,
  config: DialerConfig,
  now = new Date(),
): Promise<TestCallPreview> {
  const { dealer, survey, agent, language, refusal } = await testCallFacts(db, dealerId, config, now);
  return {
    phone: dealer ? maskPhone(dealer.phoneE164) : null,
    language: languageName(language),
    agentLabel: agent?.label ?? null,
    tested: survey ? (agentFor(language, survey)?.tested ?? false) : false,
    estimateCents: TEST_CALL_ESTIMATE_CENTS,
    refusal: refusal?.detail ?? null,
  };
}

export type TestCallResult =
  | { status: "placed"; executionId: string }
  | { status: "refused"; message: string }
  /** No answer from Bolna: the call may or may not have gone out. */
  | { status: "unknown"; message: string };

export async function placeTestCall(
  db: Pick<Db, "select" | "insert" | "update">,
  bolna: Pick<BolnaClient, "makeCall">,
  dealerId: string,
  config: DialerConfig,
  now = new Date(),
): Promise<TestCallResult> {
  const { dealer, sector, agent, refusal } = await testCallFacts(db, dealerId, config, now);
  const entry = { action: "test_call" as const, recipientCount: 1, actor: config.actor };

  if (refusal || !dealer || !agent || !sector) {
    const code = refusal?.code ?? "no_dealer";
    await db.insert(dialerLog).values({
      ...entry,
      allowed: false,
      refusalCode: code,
      refusalDetail: refusal?.detail ?? null,
    });
    return { status: "refused", message: refusal?.detail ?? "This dealer can't be called." };
  }

  // Logged before dialling, so a crash can't leave a call uncounted against the spend cap.
  const [log] = await db
    .insert(dialerLog)
    .values({ ...entry, allowed: true, estimatedCostCents: TEST_CALL_ESTIMATE_CENTS })
    .returning({ id: dialerLog.id });
  const brandCode = dealer.attributes.brand;
  try {
    const placed = await bolna.makeCall({
      agentId: agent.bolnaAgentId,
      to: dealer.phoneE164,
      userData: testCallUserData({
        businessName: dealer.businessName,
        brand: brandCode ? vocabLabel(sector, "brand", brandCode) : "",
        city: getCity(dealer.cityCode).name,
      }),
    });
    await db
      .update(dialerLog)
      .set({ httpStatus: 200, bolnaRef: placed.execution_id })
      .where(eq(dialerLog.id, log!.id));
    return { status: "placed", executionId: placed.execution_id };
  } catch (error) {
    if (error instanceof BolnaError || error instanceof CallRefused) {
      // Nothing was dialled, so nothing was spent.
      await db
        .update(dialerLog)
        .set({
          allowed: false,
          refusalCode: "bolna_error",
          estimatedCostCents: 0,
          httpStatus: error instanceof BolnaError ? error.status : null,
        })
        .where(eq(dialerLog.id, log!.id));
      return { status: "refused", message: error.message };
    }
    await db
      .update(dialerLog)
      .set({ refusalDetail: "No answer from Bolna; the call may have gone out." })
      .where(eq(dialerLog.id, log!.id));
    return { status: "unknown", message: "No answer from Bolna. Check Bolna's call history before trying again." };
  }
}
