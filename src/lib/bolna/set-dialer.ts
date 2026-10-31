import { and, eq, isNull, lt, notExists } from "drizzle-orm";
import { FINAL_STATUS_RANK } from "../calls/ingest/status";
import { CALL_BUDGET_CENTS, memberExclusion, type PlanAgent, planSet, type SetPlan, spendRefusal } from "../calls/set-plan";
import type { Db } from "../db/client";
import { type CollectBolna, collectCalls } from "../db/collect";
import { audit } from "../db/queries/audit";
import { previousWeekAnswers } from "../db/queries/calls";
import { type DbConn, ingestExecution } from "../db/queries/ingest";
import { spentLast24hCents } from "../db/queries/spend";
import { batches, batchMembers, calls, dealers, dialerLog, setRecipients, sets, surveys } from "../db/schema";
import { isUuid } from "../domain/uuid";
import { weekStartOf } from "../domain/week";
import { getCity } from "../reference/geo";
import { getSector, vocabLabel } from "../sectors/registry";
import { latestSurvey } from "../surveys/registry";
import { BolnaError, type BolnaClient, CallRefused } from "./client";
import type { DialerConfig } from "./dialer";
import { agentOf, type Conn, dealerColumns, latestSurveyOf } from "./dialer-facts";

/**
 * Calling a batch: each run is a **set**, and its rows are called one at a time, in order. The set's live
 * page calls `advanceSet` every few seconds, so a call only starts while someone is watching, and
 * closing the page pauses the set. These calls count in the index.
 */

async function loadPlan(db: Conn, batchId: string, config: DialerConfig, now: Date) {
  const [batch] = isUuid(batchId) ? await db.select().from(batches).where(eq(batches.id, batchId)) : [];
  if (!batch) return null;
  const members = await db
    .select(dealerColumns)
    .from(batchMembers)
    .innerJoin(dealers, eq(dealers.id, batchMembers.dealerId))
    .where(eq(batchMembers.batchId, batchId))
    .orderBy(dealers.businessName, dealers.id);
  const survey = await latestSurveyOf(db, batch.sectorSlug);
  const agents = new Map<string, PlanAgent>();
  if (survey) {
    for (const language of new Set(members.map((m) => m.language))) {
      const agent = await agentOf(db, survey.id, language);
      if (agent) agents.set(language, agent);
    }
  }
  const [live] = await db.select({ id: sets.id }).from(sets).where(eq(sets.status, "running")).limit(1);
  const plan = planSet(members, {
    callingEnabled: config.callingEnabled,
    scope: config.scope,
    agents,
    spentCents: await spentLast24hCents(db, now),
    capCents: Math.round(config.capUsd * 100),
    archived: batch.archivedAt !== null,
    anotherLive: Boolean(live),
  });
  return { batch, survey, plan };
}

export type SetPreview = { batchName: string; plan: SetPlan };

/** What pressing Call would do. Writes nothing and asks Bolna nothing. */
export async function setPreview(
  db: Conn,
  batchId: string,
  config: DialerConfig,
  now = new Date(),
): Promise<SetPreview | null> {
  const loaded = await loadPlan(db, batchId, config, now);
  return loaded ? { batchName: loaded.batch.name, plan: loaded.plan } : null;
}

export type StartSetResult = { status: "refused"; message: string } | { status: "started"; setId: string };

/** Creates a set. Nothing dials here: the live page's first step places row 1. */
export async function startSet(
  db: Pick<DbConn, "transaction" | "insert">,
  batchId: string,
  config: DialerConfig,
  now = new Date(),
): Promise<StartSetResult> {
  const result = await db.transaction(async (tx): Promise<StartSetResult | { refusal: { code: string; detail: string } }> => {
    if (isUuid(batchId)) await tx.select({ id: batches.id }).from(batches).where(eq(batches.id, batchId)).for("update");
    const loaded = await loadPlan(tx, batchId, config, now);
    if (!loaded) return { status: "refused", message: "This batch no longer exists." };
    const { survey, plan } = loaded;
    if (plan.refusal) return { refusal: plan.refusal };
    if (!survey) return { refusal: { code: "no_survey", detail: "No survey is synced." } };

    const [set] = await tx
      .insert(sets)
      .values({
        batchId,
        surveyId: survey.id,
        weekStart: weekStartOf(now),
        recipientCount: plan.callCount,
        estimatedCostCents: plan.estimateCents,
        createdBy: config.actor,
      })
      .returning({ id: sets.id });
    for (const r of plan.recipients) {
      await tx.insert(setRecipients).values({
        setId: set!.id,
        dealerId: r.dealerId,
        included: r.reason === null,
        exclusionReason: r.reason,
      });
    }
    await audit(tx, {
      actor: config.actor,
      action: "set.start",
      entityType: "set",
      entityId: set!.id,
      meta: { batchId, calling: plan.callCount, excluded: Object.fromEntries(plan.excluded.map((e) => [e.reason, e.n])) },
    });
    return { status: "started", setId: set!.id };
  });

  if ("refusal" in result) {
    await db.insert(dialerLog).values({
      actor: config.actor,
      action: "call",
      recipientCount: 0,
      allowed: false,
      refusalCode: result.refusal.code,
      refusalDetail: result.refusal.detail,
    });
    return { status: "refused", message: result.refusal.detail };
  }
  return result;
}

/**
 * One step of a live set, safe to repeat: bring in the current call's news, then, if nothing is ringing,
 * place the next row's call. The set's row is locked while dialling, so two steps can't both dial.
 */
export async function advanceSet(
  db: DbConn & Pick<Db, "selectDistinct">,
  bolna: CollectBolna & Pick<BolnaClient, "makeCall">,
  setId: string,
  config: DialerConfig,
  now = new Date(),
): Promise<void> {
  if (!isUuid(setId)) return;
  await collectCalls(db, bolna, { now });

  await db.transaction(async (tx) => {
    const [set] = await tx
      .select({ id: sets.id, status: sets.status, weekStart: sets.weekStart, surveyId: sets.surveyId })
      .from(sets)
      .where(eq(sets.id, setId))
      .for("update");
    if (!set || set.status !== "running") return;

    const [open] = await tx
      .select({ id: calls.id })
      .from(calls)
      .where(and(eq(calls.setId, setId), lt(calls.statusRank, FINAL_STATUS_RANK)))
      .limit(1);
    if (open) return;

    const stop = async (reason: string) => {
      await tx.update(sets).set({ status: "stopped", stopReason: reason }).where(eq(sets.id, setId));
    };

    // Rows still to call, in batch order. A row that can't be called falls through to the next.
    const rows = await tx
      .select({ ...dealerColumns, recipientId: setRecipients.id, callRef: setRecipients.callRef })
      .from(setRecipients)
      .innerJoin(dealers, eq(dealers.id, setRecipients.dealerId))
      .where(
        and(
          eq(setRecipients.setId, setId),
          eq(setRecipients.included, true),
          isNull(setRecipients.dialError),
          notExists(tx.select({ id: calls.id }).from(calls).where(eq(calls.setRecipientId, setRecipients.id))),
        ),
      )
      .orderBy(dealers.businessName, dealers.id);

    for (const row of rows) {
      if (!config.callingEnabled) return stop("Calling was switched off.");
      const spent = spendRefusal({ spentCents: await spentLast24hCents(tx, now), capCents: Math.round(config.capUsd * 100) });
      if (spent) return stop(spent.detail);

      // Checked again now: the dealer may have changed since the set started.
      const agent = await agentOf(tx, set.surveyId, row.language);
      const skip = memberExclusion(row, { scope: config.scope, agents: new Map(agent ? [[row.language, agent]] : []) });
      if (skip || !agent) {
        await tx
          .update(setRecipients)
          .set({ included: false, exclusionReason: skip ?? "no_agent" })
          .where(eq(setRecipients.id, row.recipientId));
        continue;
      }

      const [survey] = await tx.select({ slug: surveys.slug }).from(surveys).where(eq(surveys.id, set.surveyId));
      const slug = survey!.slug;
      const previous = await previousWeekAnswers(tx, {
        dealerId: row.dealerId,
        surveySlug: slug,
        weekStart: set.weekStart,
        minAnswered: latestSurvey(slug).qa.minAnsweredForUsable,
      });
      const log = { actor: config.actor, action: "call" as const, setId, recipientCount: 1 };
      try {
        const placed = await bolna.makeCall({
          agentId: agent.bolnaAgentId,
          to: row.phoneE164,
          userData: {
            dealer_name: row.businessName,
            brand: row.attributes.brand ? vocabLabel(getSector(row.sectorSlug), "brand", row.attributes.brand) : "",
            city: getCity(row.cityCode).name,
            repeat_call: previous ? "yes" : "no",
            nabz_dealer_id: row.dealerId,
            nabz_call_ref: row.callRef,
          },
        });
        await tx.insert(dialerLog).values({
          ...log,
          allowed: true,
          bolnaRef: placed.execution_id,
          httpStatus: 200,
          estimatedCostCents: CALL_BUDGET_CENTS,
        });
        // The call's row, from the moment it's placed, so the page shows it ringing.
        await ingestExecution(
          tx,
          {
            id: placed.execution_id,
            agent_id: agent.bolnaAgentId,
            status: "queued",
            created_at: now.toISOString(),
            context_details: { recipient_data: { nabz_call_ref: row.callRef } },
          },
          {
            ourAgentIds: new Set([agent.bolnaAgentId]),
            recipientId: row.recipientId,
            agentVersionId: agent.agentVersionId,
          },
        );
      } catch (error) {
        if (error instanceof CallRefused) return stop("A call was refused by the calling safety rules.");
        if (!(error instanceof BolnaError) && !(error instanceof TypeError)) throw error;
        // Never redialled: if there was no answer, the call may have gone out.
        const message =
          error instanceof BolnaError ? `Bolna answered ${error.status}` : "No answer from Bolna; the call may have gone out";
        await tx.update(setRecipients).set({ dialError: message }).where(eq(setRecipients.id, row.recipientId));
        await tx.insert(dialerLog).values({
          ...log,
          allowed: false,
          refusalCode: "bolna_error",
          refusalDetail: message,
          httpStatus: error instanceof BolnaError ? error.status : null,
        });
      }
      return;
    }

    // No rows left and nothing ringing.
    await tx.update(sets).set({ status: "completed" }).where(eq(sets.id, setId));
  });
}

/** Stops a set: no further calls. The call in progress, if any, finishes by itself. */
export async function stopSet(
  db: Pick<Db, "update" | "insert">,
  setId: string,
  config: Pick<DialerConfig, "actor">,
): Promise<void> {
  if (!isUuid(setId)) return;
  const stopped = await db
    .update(sets)
    .set({ status: "stopped", stopReason: "Stopped by ops." })
    .where(and(eq(sets.id, setId), eq(sets.status, "running")))
    .returning({ id: sets.id });
  if (stopped.length > 0) {
    await audit(db, { actor: config.actor, action: "set.stop", entityType: "set", entityId: setId });
  }
}
