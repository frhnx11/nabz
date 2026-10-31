import { and, asc, count, desc, eq, gte, inArray, max, sql } from "drizzle-orm";
import type { AnswerRateCall } from "../../calls/answer-rates";
import type { StoredExtraction } from "../../calls/report";
import { isUuid } from "../../domain/uuid";
import { addWeeks } from "../../domain/week";
import { indexQuestionKeys } from "../../surveys/helpers";
import type { Answers } from "../../index/score";
import type { SurveyDefinition } from "../../surveys/schema";
import type { Db } from "../client";
import { answerOverrides, callFlags, calls, geoCities, geoStates, dealers, surveys } from "../schema";

export const CALLS_PAGE_SIZE = 50;

/** When the call happened: when it connected, or when it was placed if it never connected. */
const callTime = sql<Date>`coalesce(${calls.startedAt}, ${calls.initiatedAt})`;

/** The review filter on Ops → Calls. */
export const CALL_QA_FILTERS = ["needs_review", "excluded", "approved"] as const;
export type CallQaFilter = (typeof CALL_QA_FILTERS)[number];

export type CallListOptions = { page: number; qa?: CallQaFilter; setId?: string };

function callFilter(options: Omit<CallListOptions, "page">) {
  return and(
    options.qa ? eq(calls.qaState, options.qa) : undefined,
    options.setId && isUuid(options.setId) ? eq(calls.setId, options.setId) : undefined,
  );
}

/** Every call the agent made, newest first, optionally only those in one review state . */
export async function listCalls(db: Db, options: CallListOptions) {
  const where = callFilter(options);
  // Sequential on purpose: these may run inside a transaction, which has a single connection.
  const rows = await db
    .select({
      id: calls.id,
      at: calls.startedAt,
      initiatedAt: calls.initiatedAt,
      durationS: calls.durationS,
      costCents: calls.costCents,
      derivedStatus: calls.derivedStatus,
      qaState: calls.qaState,
      answeredCount: calls.answeredCount,
      surveyId: calls.surveyId,
      dealerId: calls.dealerId,
      weekStart: calls.weekStart,
      businessName: dealers.businessName,
      attributes: dealers.attributes,
      city: geoCities.name,
    })
    .from(calls)
    .innerJoin(dealers, eq(dealers.id, calls.dealerId))
    .innerJoin(geoCities, eq(geoCities.code, dealers.cityCode))
    .where(where)
    .orderBy(desc(callTime), desc(calls.id))
    .limit(CALLS_PAGE_SIZE)
    .offset((options.page - 1) * CALLS_PAGE_SIZE);
  const [total] = await db.select({ n: count() }).from(calls).where(where);

  // How many questions feed the index, per survey version on this page (for "4/5").
  const surveyIds = [...new Set(rows.map((r) => r.surveyId))];
  const versions = surveyIds.length
    ? await db.select({ id: surveys.id, definition: surveys.definition }).from(surveys).where(inArray(surveys.id, surveyIds))
    : [];
  const indexCount = new Map(versions.map((v) => [v.id, indexQuestionKeys(v.definition as SurveyDefinition).length]));

  const newest = await newestUsableCalls(db, rows);
  return {
    rows: rows.map((r) => {
      const current = newest.get(`${r.dealerId}|${r.weekStart}`);
      return { ...r, indexQuestions: indexCount.get(r.surveyId) ?? 0, replaced: isReplaced(r, current) };
    }),
    total: total?.n ?? 0,
  };
}

/** The call the index uses for each dealer × week among these calls' dealers: the newest usable one. */
async function newestUsableCalls(db: Pick<Db, "select">, rows: readonly { dealerId: string; weekStart: string }[]) {
  const newest = new Map<string, string>();
  if (rows.length === 0) return newest;
  const versions = await db.select({ id: surveys.id, definition: surveys.definition }).from(surveys);
  const minAnswered = new Map(versions.map((v) => [v.id, (v.definition as SurveyDefinition).qa.minAnsweredForUsable]));
  const usable = await db
    .select({
      id: calls.id,
      dealerId: calls.dealerId,
      weekStart: calls.weekStart,
      surveyId: calls.surveyId,
      answeredCount: calls.answeredCount,
    })
    .from(calls)
    .where(
      and(
        inArray(calls.dealerId, [...new Set(rows.map((r) => r.dealerId))]),
        inArray(calls.weekStart, [...new Set(rows.map((r) => r.weekStart))]),
        inArray(calls.qaState, ["auto_ok", "approved"]),
      ),
    )
    .orderBy(callTime, calls.id);
  for (const c of usable) {
    if (c.answeredCount >= (minAnswered.get(c.surveyId) ?? 1)) newest.set(`${c.dealerId}|${c.weekStart}`, c.id);
  }
  return newest;
}

/** A call that would count, but a newer call from the same dealer that week has taken its place. */
function isReplaced(
  call: { id: string; qaState: string; answeredCount: number },
  current: string | undefined,
): boolean {
  return current !== undefined && current !== call.id && ["auto_ok", "approved"].includes(call.qaState) && call.answeredCount > 0;
}

/** How many calls are in each review state that needs a person's attention, for the filter pills. */
export async function reviewCounts(db: Db) {
  const [row] = await db
    .select({ needsReview: count() })
    .from(calls)
    .where(callFilter({ qa: "needs_review" }));
  return { needsReview: row?.needsReview ?? 0 };
}

/**
 * The dealer's answers from the week before `weekStart`, chosen as the index engine chooses
 * (isUsable + latestPerDealer in src/lib/index/engine.ts): any version of the same survey, only calls
 * the index would use, the newest of them. Momentum indicators and
 * week-on-week QA checks compare against it. Null if the dealer had no usable call that week.
 */
export async function previousWeekAnswers(
  db: Pick<Db, "select">,
  options: { dealerId: string; surveySlug: string; weekStart: string; minAnswered: number },
): Promise<Answers | null> {
  const sameSurvey = db.select({ id: surveys.id }).from(surveys).where(eq(surveys.slug, options.surveySlug));
  const [previous] = await db
    .select({ answers: calls.answers })
    .from(calls)
    .where(
      and(
        eq(calls.dealerId, options.dealerId),
        inArray(calls.surveyId, sameSurvey),
        eq(calls.weekStart, addWeeks(options.weekStart, -1)),
        inArray(calls.qaState, ["auto_ok", "approved"]),
        gte(calls.answeredCount, options.minAnswered),
      ),
    )
    .orderBy(desc(callTime), desc(calls.id))
    .limit(1);
  return (previous?.answers as Answers | undefined) ?? null;
}

/**
 * Everything the "Data" pop-up needs for one call: the call, its QA flags and ops corrections, the
 * dealer, the exact survey version it was asked under, and the same dealer's best answers
 * from the previous week (for momentum indicators such as stock). Null if there's no such call.
 */
export async function getCallDetail(db: Db, id: string) {
  if (!isUuid(id)) return null;

  const [row] = await db
    .select({
      call: calls,
      dealer: {
        businessName: dealers.businessName,
        contactName: dealers.contactName,
        attributes: dealers.attributes,
      },
      city: geoCities.name,
      state: geoStates.name,
      survey: { title: surveys.title, slug: surveys.slug, definition: surveys.definition },
    })
    .from(calls)
    .innerJoin(dealers, eq(dealers.id, calls.dealerId))
    .innerJoin(geoCities, eq(geoCities.code, dealers.cityCode))
    .innerJoin(geoStates, eq(geoStates.code, geoCities.stateCode))
    .innerJoin(surveys, eq(surveys.id, calls.surveyId))
    .where(eq(calls.id, id));
  if (!row) return null;

  const flags = await db
    .select({
      code: callFlags.code,
      severity: callFlags.severity,
      questionKey: callFlags.questionKey,
      detail: callFlags.detail,
    })
    .from(callFlags)
    .where(eq(callFlags.callId, id))
    .orderBy(asc(callFlags.createdAt), asc(callFlags.code));
  const overrides = await db
    .select({
      questionKey: answerOverrides.questionKey,
      oldValue: answerOverrides.oldValue,
      newValue: answerOverrides.newValue,
      reason: answerOverrides.reason,
      createdBy: answerOverrides.createdBy,
      createdAt: answerOverrides.createdAt,
    })
    .from(answerOverrides)
    .where(eq(answerOverrides.callId, id))
    .orderBy(asc(answerOverrides.createdAt));
  const previousAnswers = await previousWeekAnswers(db, {
    dealerId: row.call.dealerId,
    surveySlug: row.survey.slug,
    weekStart: row.call.weekStart,
    minAnswered: (row.survey.definition as SurveyDefinition).qa.minAnsweredForUsable,
  });

  const newest = await newestUsableCalls(db, [row.call]);
  const replaced = isReplaced(row.call, newest.get(`${row.call.dealerId}|${row.call.weekStart}`));

  return {
    replaced,
    call: row.call,
    dealer: row.dealer,
    city: row.city,
    state: row.state,
    surveyTitle: row.survey.title,
    definition: row.survey.definition as SurveyDefinition,
    flags,
    overrides,
    previousAnswers,
    extracted: row.call.extracted as Record<string, StoredExtraction>,
  };
}

export type CallDetail = NonNullable<Awaited<ReturnType<typeof getCallDetail>>>;

/** How many survey weeks the ops answer rates look back over, ending at the latest week with calls. */
export const ANSWER_RATE_WEEKS = 4;

/**
 * Surveyed calls (completed or partial) of one survey slug in its latest `ANSWER_RATE_WEEKS` weeks
 * with calls, for the ops "Answers by question" card. The window ends at the newest week that has
 * calls, not at today, so it reads no clock. Null when there are no surveyed calls, or the survey
 * isn't synced.
 */
export async function answerRateInputs(db: Db, options: { surveySlug: string }) {
  const surveyed = and(
    eq(surveys.slug, options.surveySlug),
    inArray(calls.derivedStatus, ["completed", "partial"]),
  );
  const [latest] = await db
    .select({ week: max(calls.weekStart) })
    .from(calls)
    .innerJoin(surveys, eq(surveys.id, calls.surveyId))
    .where(surveyed);
  if (!latest?.week) return null;
  const [survey] = await db
    .select({ definition: surveys.definition })
    .from(surveys)
    .where(eq(surveys.slug, options.surveySlug))
    .orderBy(desc(surveys.version))
    .limit(1);
  if (!survey) return null;

  const fromWeek = addWeeks(latest.week, -(ANSWER_RATE_WEEKS - 1));
  const rows = await db
    .select({ derivedStatus: calls.derivedStatus, answers: calls.answers, extracted: calls.extracted })
    .from(calls)
    .innerJoin(surveys, eq(surveys.id, calls.surveyId))
    .where(and(surveyed, gte(calls.weekStart, fromWeek)));
  return {
    definition: survey.definition as SurveyDefinition,
    fromWeek,
    toWeek: latest.week,
    calls: rows.map((r): AnswerRateCall => ({
      derivedStatus: r.derivedStatus,
      answers: r.answers,
      extracted: r.extracted as Record<string, StoredExtraction>,
    })),
  };
}
