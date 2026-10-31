import { and, asc, count, desc, eq, ilike, inArray, like, or, type SQL, sql } from "drizzle-orm";
import type { FieldErrors, NewDealer } from "../../dealers/new-dealer";
import { escapeLike, parseSearch, type SearchToken } from "../../dealers/search";
import { isUuid } from "../../domain/uuid";
import type { Db } from "../client";
import { dealers, geoCities, geoStates } from "../schema";
import { audit } from "./audit";

export const DEALERS_PAGE_SIZE = 50;

/** One word of the search box: it must match at least one field. */
function tokenCondition(t: SearchToken): SQL {
  const pattern = `%${escapeLike(t.text)}%`;
  const parts: SQL[] = [
    ilike(dealers.businessName, pattern),
    ilike(dealers.contactName, pattern),
    ilike(dealers.contactRole, pattern),
    ilike(dealers.notes, pattern),
    ilike(geoCities.name, pattern),
    ilike(geoStates.name, pattern),
    ilike(geoStates.shortName, pattern),
    eq(sql`lower(${geoStates.code})`, t.text),
  ];
  if (t.digits) parts.push(like(dealers.phoneE164, `%${t.digits}%`));
  if (t.brandCodes.length) parts.push(inArray(sql`${dealers.attributes}->>'brand'`, t.brandCodes));
  if (t.segmentCodes.length) parts.push(inArray(sql`${dealers.attributes}->>'segment'`, t.segmentCodes));
  if (t.tier) parts.push(eq(geoCities.tier, t.tier));
  return or(...parts) as SQL;
}

/** The dealers table, newest on top. `query` is the search box: every word must match some field. */
export async function listDealers(db: Db, options: { query?: string | null; page: number }) {
  const tokens = parseSearch(options.query);
  const where = tokens.length ? and(...tokens.map(tokenCondition)) : undefined;

  const base = db
    .select({
      id: dealers.id,
      businessName: dealers.businessName,
      contactName: dealers.contactName,
      phoneE164: dealers.phoneE164,
      attributes: dealers.attributes,
      language: dealers.language,
      city: geoCities.name,
      tier: geoCities.tier,
      state: geoStates.shortName,
    })
    .from(dealers)
    .innerJoin(geoCities, eq(geoCities.code, dealers.cityCode))
    .innerJoin(geoStates, eq(geoStates.code, geoCities.stateCode))
    .where(where);

  // Sequential on purpose: these may run inside a transaction, which has a single connection.
  const rows = await base
    .orderBy(
      desc(dealers.createdAt),
      asc(geoStates.sortOrder),
      asc(geoCities.name),
      asc(dealers.businessName),
      asc(dealers.id),
    )
    .limit(DEALERS_PAGE_SIZE)
    .offset((options.page - 1) * DEALERS_PAGE_SIZE);
  const [total] = await db
    .select({ n: count() })
    .from(dealers)
    .innerJoin(geoCities, eq(geoCities.code, dealers.cityCode))
    .innerJoin(geoStates, eq(geoStates.code, geoCities.stateCode))
    .where(where);
  return { rows, total: total?.n ?? 0 };
}

export type CreateResult = { ok: true; id: string } | { ok: false; errors: FieldErrors };

/**
 * Adds a dealer entered by ops. A number may be shared by several dealers. The audit entry records who
 * added it, never the name or number.
 */
export async function createDealer(db: Db, dealer: NewDealer, context: { actor: string }): Promise<CreateResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(dealers)
      .values({
        sectorSlug: "vehicles",
        businessName: dealer.businessName,
        contactName: dealer.contactName,
        contactRole: dealer.contactRole,
        phoneE164: dealer.phoneE164,
        cityCode: dealer.cityCode,
        language: dealer.language,
        attributes: { brand: dealer.brand, segment: dealer.segment },
        notes: dealer.notes,
      })
      .returning({ id: dealers.id });
    if (!row) throw new Error("Insert returned no row");

    await audit(tx, {
      actor: context.actor,
      action: "dealer.create",
      entityType: "dealer",
      entityId: row.id,
      meta: { brand: dealer.brand, city: dealer.cityCode },
    });
    return { ok: true, id: row.id };
  });
}

/** What the edit form needs for one dealer, or null if there's no such dealer. */
export async function getDealer(db: Db, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select({
      businessName: dealers.businessName,
      contactName: dealers.contactName,
      contactRole: dealers.contactRole,
      phoneE164: dealers.phoneE164,
      attributes: dealers.attributes,
      cityCode: dealers.cityCode,
      language: dealers.language,
      notes: dealers.notes,
    })
    .from(dealers)
    .where(eq(dealers.id, id))
    .limit(1);
  return row ?? null;
}

export type UpdateResult = { ok: true } | { ok: false; errors: FieldErrors };

/**
 * Saves ops' edits to a dealer. The audit entry lists which fields changed and the before/after codes
 * (brand, city, language), never the name, number or notes.
 */
export async function updateDealer(
  db: Db,
  id: string,
  dealer: NewDealer,
  context: { actor: string },
): Promise<UpdateResult> {
  return db.transaction(async (tx) => {
    const [current] = isUuid(id) ? await tx.select().from(dealers).where(eq(dealers.id, id)).limit(1) : [];
    if (!current) return { ok: false, errors: { businessName: "This dealer can't be edited." } };

    const next = {
      businessName: dealer.businessName,
      contactName: dealer.contactName,
      contactRole: dealer.contactRole,
      phoneE164: dealer.phoneE164,
      cityCode: dealer.cityCode,
      language: dealer.language,
      brand: dealer.brand,
      notes: dealer.notes,
    };
    const before = { ...current, brand: current.attributes.brand ?? null };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== before[k]);
    if (changed.length === 0) return { ok: true };

    await tx
      .update(dealers)
      .set({
        businessName: next.businessName,
        contactName: next.contactName,
        contactRole: next.contactRole,
        phoneE164: next.phoneE164,
        cityCode: next.cityCode,
        language: next.language,
        attributes: { ...current.attributes, brand: dealer.brand, segment: dealer.segment },
        notes: next.notes,
      })
      .where(eq(dealers.id, id));

    // Only non-personal codes go into before/after; personal fields are named, never logged.
    const CODES = ["brand", "cityCode", "language"] as const;
    const codesChanged = CODES.filter((k) => changed.includes(k));
    await audit(tx, {
      actor: context.actor,
      action: "dealer.update",
      entityType: "dealer",
      entityId: id,
      before: codesChanged.length ? Object.fromEntries(codesChanged.map((k) => [k, before[k]])) : null,
      after: codesChanged.length ? Object.fromEntries(codesChanged.map((k) => [k, next[k]])) : null,
      meta: { changed },
    });
    return { ok: true };
  });
}
