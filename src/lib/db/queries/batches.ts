import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import { type CallingScope, numberAllowed } from "../../calling-policy";
import type { BatchFieldErrors, BatchInput } from "../../batches/form";
import { FINAL_STATUS_RANK } from "../../calls/ingest/status";
import { getSector } from "../../sectors/registry";
import { latestSurvey } from "../../surveys/registry";
import type { Db } from "../client";
import {
  batches,
  batchMembers,
  calls,
  geoCities,
  geoStates,
  dealers,
  setRecipients,
  sets,
} from "../schema";
import { audit } from "./audit";

/**
 * Batches: saved lists of dealers that ops can call. A dealer is in at most one batch.
 * Queries run one after another: they may be given a transaction (see CLAUDE.md).
 */

export type BatchCard = {
  id: string;
  sectorSlug: string;
  name: string;
  notes: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  members: number;
  /** Members per attribute value / state, most first. */
  brands: { code: string; n: number }[];
  states: { code: string; n: number }[];
  /** Members whose number can be called (the rest stay in the batch and are skipped). */
  callable: number;
  setCount: number;
  lastSet: {
    id: string;
    status: string;
    weekStart: string;
    at: Date | null;
    recipients: number;
    answered: number;
    /** Dealers whose call has reached a final status. */
    finished: number;
  } | null;
};

function countBy(values: string[]): { code: string; n: number }[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .map(([code, n]) => ({ code, n }))
    .toSorted((a, b) => b.n - a.n || (a.code < b.code ? -1 : 1));
}

/** Every batch with its summary: live batches first, newest first, then archived. */
export async function listBatches(db: Db, scope: CallingScope): Promise<BatchCard[]> {
  const rows = await db
    .select()
    .from(batches)
    .orderBy(
      sql`${batches.archivedAt} is not null`,
      desc(batches.createdAt),
      asc(batches.name),
    );
  if (rows.length === 0) return [];
  const ids = rows.map((b) => b.id);

  const members = await db
    .select({
      batchId: batchMembers.batchId,
      phoneE164: dealers.phoneE164,
      attributes: dealers.attributes,
      state: geoCities.stateCode,
    })
    .from(batchMembers)
    .innerJoin(dealers, eq(dealers.id, batchMembers.dealerId))
    .innerJoin(geoCities, eq(geoCities.code, dealers.cityCode))
    .where(inArray(batchMembers.batchId, ids));

  const setCounts = await db
    .select({ batchId: sets.batchId, n: count() })
    .from(sets)
    .where(inArray(sets.batchId, ids))
    .groupBy(sets.batchId);

  const lastSets = await db
    .selectDistinctOn([sets.batchId], {
      id: sets.id,
      batchId: sets.batchId,
      status: sets.status,
      weekStart: sets.weekStart,
      createdAt: sets.createdAt,
    })
    .from(sets)
    .where(and(isNotNull(sets.batchId), inArray(sets.batchId, ids)))
    .orderBy(sets.batchId, desc(sets.weekStart), desc(sets.createdAt));
  const setIds = lastSets.map((r) => r.id);

  const recipients = setIds.length
    ? await db
        .select({ setId: setRecipients.setId, n: count() })
        .from(setRecipients)
        .where(and(inArray(setRecipients.setId, setIds), eq(setRecipients.included, true)))
        .groupBy(setRecipients.setId)
    : [];

  const finished = setIds.length
    ? await db
        .select({ setId: calls.setId, n: countDistinct(calls.dealerId) })
        .from(calls)
        .where(and(inArray(calls.setId, setIds), eq(calls.statusRank, FINAL_STATUS_RANK)))
        .groupBy(calls.setId)
    : [];

  // "Answered" = gave enough answers to count in the index, once per dealer.
  const answeredBySector = new Map<string, Map<string, number>>();
  for (const sectorSlug of new Set(rows.map((b) => b.sectorSlug))) {
    const survey = getSector(sectorSlug).pulseSurvey;
    if (!survey || setIds.length === 0) continue;
    const minAnswered = latestSurvey(survey).qa.minAnsweredForUsable;
    const answered = await db
      .select({ setId: calls.setId, n: countDistinct(calls.dealerId) })
      .from(calls)
      .where(and(inArray(calls.setId, setIds), gte(calls.answeredCount, minAnswered)))
      .groupBy(calls.setId);
    answeredBySector.set(sectorSlug, new Map(answered.map((a) => [a.setId, a.n])));
  }

  return rows.map((b): BatchCard => {
    const mine = members.filter((m) => m.batchId === b.id);
    const last = lastSets.find((r) => r.batchId === b.id);
    // The sector's first attribute is its main one (vehicles: brand).
    const primary = Object.keys(getSector(b.sectorSlug).vocab)[0];
    return {
      id: b.id,
      sectorSlug: b.sectorSlug,
      name: b.name,
      notes: b.notes,
      archivedAt: b.archivedAt,
      createdAt: b.createdAt,
      members: mine.length,
      brands: primary ? countBy(mine.map((m) => m.attributes[primary] ?? "—")) : [],
      states: countBy(mine.map((m) => m.state)),
      callable: mine.filter((m) => numberAllowed(m.phoneE164, scope)).length,
      setCount: setCounts.find((r) => r.batchId === b.id)?.n ?? 0,
      lastSet: last
        ? {
            id: last.id,
            status: last.status,
            finished: finished.find((f) => f.setId === last.id)?.n ?? 0,
            weekStart: last.weekStart,
            at: last.createdAt,
            recipients: recipients.find((r) => r.setId === last.id)?.n ?? 0,
            answered: answeredBySector.get(b.sectorSlug)?.get(last.id) ?? 0,
          }
        : null,
    };
  });
}

export type PickerDealer = {
  id: string;
  businessName: string;
  brand: string;
  city: string;
  /** Short state name for display, and the state code. */
  state: string;
  stateCode: string;
  /** Their number can't be called in this mode: they'd stay in the batch and be skipped. */
  notPermitted: boolean;
  /** The batch they're in, if any. */
  batch: { id: string; name: string } | null;
};

/** Every dealer, with the batch they're already in. No phone numbers: this goes to the browser. */
export async function batchPicker(db: Db, scope: CallingScope): Promise<PickerDealer[]> {
  const rows = await db
    .select({
      id: dealers.id,
      businessName: dealers.businessName,
      phoneE164: dealers.phoneE164,
      attributes: dealers.attributes,
      city: geoCities.name,
      state: geoStates.shortName,
      stateCode: geoStates.code,
      batchId: batches.id,
      batchName: batches.name,
    })
    .from(dealers)
    .innerJoin(geoCities, eq(geoCities.code, dealers.cityCode))
    .innerJoin(geoStates, eq(geoStates.code, geoCities.stateCode))
    .leftJoin(batchMembers, eq(batchMembers.dealerId, dealers.id))
    .leftJoin(batches, eq(batches.id, batchMembers.batchId))
    .orderBy(asc(geoStates.sortOrder), asc(geoCities.name), asc(dealers.businessName), asc(dealers.id));
  return rows.map((r) => ({
    id: r.id,
    businessName: r.businessName,
    brand: r.attributes.brand ?? "",
    city: r.city,
    state: r.state,
    stateCode: r.stateCode,
    notPermitted: !numberAllowed(r.phoneE164, scope),
    batch: r.batchId && r.batchName ? { id: r.batchId, name: r.batchName } : null,
  }));
}

export type SaveBatchResult = { ok: true; id: string } | { ok: false; errors: BatchFieldErrors };

/** The constraint a Postgres error violated, looking through Drizzle's wrapper. */
function violated(e: unknown): string | null {
  for (let err = e as { code?: string; constraint?: string; cause?: unknown } | undefined; err;) {
    if (err.code === "23505" && err.constraint) return err.constraint;
    err = err.cause as typeof err;
  }
  return null;
}

/** Creates a batch, or updates its name, notes and members. A member can't be in another batch. */
export async function saveBatch(
  db: Db,
  input: BatchInput,
  context: { actor: string; batchId?: string | null; sectorSlug?: string },
): Promise<SaveBatchResult> {
  try {
    return await db.transaction(async (tx): Promise<SaveBatchResult> => {
      let existing: typeof batches.$inferSelect | undefined;
      if (context.batchId) {
        [existing] = await tx.select().from(batches).where(eq(batches.id, context.batchId));
        if (!existing || existing.archivedAt)
          return { ok: false, errors: { name: "This batch no longer exists." } };
      }

      const [clash] = await tx
        .select({ id: batches.id })
        .from(batches)
        .where(
          and(
            sql`lower(${batches.name}) = lower(${input.name})`,
            isNull(batches.archivedAt),
            context.batchId ? ne(batches.id, context.batchId) : undefined,
          ),
        )
        .limit(1);
      if (clash)
        return { ok: false, errors: { name: "Another batch already has this name." } };

      if (input.memberIds.length > 0) {
        const found = await tx.select({ id: dealers.id }).from(dealers).where(inArray(dealers.id, input.memberIds));
        if (found.length !== input.memberIds.length) {
          return { ok: false, errors: { memberIds: "Some of these dealers no longer exist. Reopen and try again." } };
        }
        const taken = await tx
          .select({ name: batches.name })
          .from(batchMembers)
          .innerJoin(batches, eq(batches.id, batchMembers.batchId))
          .where(
            and(
              inArray(batchMembers.dealerId, input.memberIds),
              context.batchId ? ne(batchMembers.batchId, context.batchId) : undefined,
            ),
          );
        if (taken.length > 0)
          return { ok: false, errors: { memberIds: takenMessage(taken.map((t) => t.name)) } };
      }

      let id: string;
      let added = input.memberIds;
      let removed = 0;
      if (existing) {
        id = existing.id;
        await tx.update(batches).set({ name: input.name, notes: input.notes }).where(eq(batches.id, id));
        const current = await tx
          .select({ dealerId: batchMembers.dealerId })
          .from(batchMembers)
          .where(eq(batchMembers.batchId, id));
        const keep = new Set(input.memberIds);
        const had = new Set(current.map((m) => m.dealerId));
        added = input.memberIds.filter((m) => !had.has(m));
        const drop = [...had].filter((m) => !keep.has(m));
        removed = drop.length;
        if (drop.length > 0) {
          await tx
            .delete(batchMembers)
            .where(and(eq(batchMembers.batchId, id), inArray(batchMembers.dealerId, drop)));
        }
      } else {
        const [row] = await tx
          .insert(batches)
          .values({
            sectorSlug: context.sectorSlug ?? "vehicles",
            name: input.name,
            notes: input.notes,
            createdBy: context.actor,
          })
          .returning({ id: batches.id });
        if (!row) throw new Error("Insert returned no row");
        id = row.id;
      }
      if (added.length > 0) {
        await tx
          .insert(batchMembers)
          .values(added.map((dealerId) => ({ batchId: id, dealerId })));
      }

      await audit(tx, {
        actor: context.actor,
        action: existing ? "batch.update" : "batch.create",
        entityType: "batch",
        entityId: id,
        meta: { members: input.memberIds.length, added: added.length, removed },
      });
      return { ok: true, id };
    });
  } catch (e) {
    // Another save won the race between our checks and the write.
    const constraint = violated(e);
    if (constraint === "batches_name_uq")
      return { ok: false, errors: { name: "Another batch already has this name." } };
    if (constraint === "batch_members_dealer_uq" || constraint === "batch_members_pk") {
      return {
        ok: false,
        errors: {
          memberIds: "Some of these dealers were just added to another batch. Reopen and try again.",
        },
      };
    }
    throw e;
  }
}

function takenMessage(names: string[]): string {
  const unique = [...new Set(names)];
  const n = names.length;
  return `${n} ${n === 1 ? "dealer is" : "dealers are"} already in ${unique.length === 1 ? `“${unique[0]}”` : "other batches"}. A dealer can be in only one batch.`;
}

export type RemoveBatchResult = { ok: true; removed: "deleted" | "archived" } | { ok: false; error: string };

/**
 * Removes a batch. One never called is deleted; one that has sets is archived instead (its sets keep
 * pointing at it) and its members are released, so they can join another batch.
 */
export async function removeBatch(
  db: Db,
  id: string,
  context: { actor: string },
): Promise<RemoveBatchResult> {
  return db.transaction(async (tx): Promise<RemoveBatchResult> => {
    const [b] = await tx.select().from(batches).where(eq(batches.id, id));
    if (!b || b.archivedAt) return { ok: false, error: "This batch no longer exists." };
    const [ran] = await tx.select({ n: count() }).from(sets).where(eq(sets.batchId, id));
    const [m] = await tx.select({ n: count() }).from(batchMembers).where(eq(batchMembers.batchId, id));
    if ((ran?.n ?? 0) === 0) {
      await tx.delete(batches).where(eq(batches.id, id));
      await audit(tx, {
        actor: context.actor,
        action: "batch.delete",
        entityType: "batch",
        entityId: id,
        meta: { members: m?.n ?? 0 },
      });
      return { ok: true, removed: "deleted" };
    }
    await tx.delete(batchMembers).where(eq(batchMembers.batchId, id));
    await tx.update(batches).set({ archivedAt: new Date() }).where(eq(batches.id, id));
    await audit(tx, {
      actor: context.actor,
      action: "batch.archive",
      entityType: "batch",
      entityId: id,
      meta: { members: m?.n ?? 0, sets: ran?.n ?? 0 },
    });
    return { ok: true, removed: "archived" };
  });
}

/** The ids of a batch's members (for the edit form). */
export async function batchMemberIds(db: Db, id: string): Promise<string[]> {
  const rows = await db
    .select({ dealerId: batchMembers.dealerId })
    .from(batchMembers)
    .where(eq(batchMembers.batchId, id));
  return rows.map((r) => r.dealerId);
}
