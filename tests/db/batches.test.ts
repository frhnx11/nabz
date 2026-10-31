import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { CallingScope } from "../../src/lib/calling-policy";
import type { Db } from "../../src/lib/db/client";
import { batchPicker, listBatches, removeBatch, saveBatch } from "../../src/lib/db/queries/batches";
import { auditLog, batches, batchMembers, dealers, sets } from "../../src/lib/db/schema";
import { expectFailure, inRollback, latestSurveyId, testDb } from "./helpers";

const { db, pool } = testDb();
afterAll(() => pool.end());

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const ctx = { actor: "ops" };

async function addDealer(tx: Tx, n: number, phone = `+91900000000${n}`) {
  const [r] = await tx
    .insert(dealers)
    .values({
      sectorSlug: "vehicles",
      businessName: `Dealer ${n}`,
      phoneE164: phone,
      cityCode: "ka-bengaluru",
      attributes: { brand: "hero", segment: "two_wheeler" },
    })
    .returning({ id: dealers.id });
  return r!.id;
}

describe("batch rules in the database", () => {
  it("keeps each dealer in one batch, and batch names unique", async () => {
    await inRollback(db, async (tx) => {
      const dealer = await addDealer(tx, 1);
      const [a] = await tx.insert(batches).values({ sectorSlug: "vehicles", name: "A", createdBy: "test" }).returning();
      const [b] = await tx.insert(batches).values({ sectorSlug: "vehicles", name: "B", createdBy: "test" }).returning();
      await tx.insert(batchMembers).values({ batchId: a!.id, dealerId: dealer });

      const twice = await expectFailure(tx, (sp) => sp.insert(batchMembers).values({ batchId: b!.id, dealerId: dealer }));
      expect(twice.constraint).toBe("batch_members_dealer_uq");

      const dup = await expectFailure(tx, (sp) =>
        sp.insert(batches).values({ sectorSlug: "vehicles", name: "a", createdBy: "test" }),
      );
      expect(dup.constraint).toBe("batches_name_uq");
    });
  });

  it("keeps batches that have sets", async () => {
    await inRollback(db, async (tx) => {
      const surveyId = await latestSurveyId(tx);
      const [batch] = await tx.insert(batches).values({ sectorSlug: "vehicles", name: "Hero", createdBy: "test" }).returning();
      await tx.insert(sets).values({ batchId: batch!.id, surveyId, weekStart: "2026-10-26", createdBy: "test" });
      const del = await expectFailure(tx, (sp) => sp.delete(batches).where(eq(batches.id, batch!.id)));
      expect(del.constraint).toBe("sets_batch_id_batches_id_fk");
    });
  });
});

describe("saveBatch", () => {
  it("creates, renames and changes members, auditing without personal data", async () => {
    await inRollback(db, async (tx) => {
      const asDb = tx as unknown as Db;
      const [d1, d2, d3] = [await addDealer(tx, 1), await addDealer(tx, 2), await addDealer(tx, 3)];
      const created = await saveBatch(asDb, { name: "Bengaluru", notes: null, memberIds: [d1!, d2!] }, ctx);
      expect(created.ok).toBe(true);
      const id = (created as { id: string }).id;

      const updated = await saveBatch(
        asDb,
        { name: "Bengaluru 2W", notes: "Hero only", memberIds: [d2!, d3!] },
        { ...ctx, batchId: id },
      );
      expect(updated).toEqual({ ok: true, id });
      const members = await tx.select().from(batchMembers).where(eq(batchMembers.batchId, id));
      expect(members.map((m) => m.dealerId).toSorted()).toEqual([d2, d3].toSorted());
      const [row] = await tx.select().from(batches).where(eq(batches.id, id));
      expect(row).toMatchObject({ name: "Bengaluru 2W", notes: "Hero only" });

      const log = await tx.select().from(auditLog).where(eq(auditLog.entityId, id)).orderBy(auditLog.at);
      expect(log.map((l) => l.action)).toEqual(["batch.create", "batch.update"]);
      expect(log[1]!.meta).toEqual({ members: 2, added: 1, removed: 1 });
      expect(JSON.stringify(log)).not.toContain("Dealer 1");
    });
  });

  it("refuses dealers from another batch, unknown dealers and duplicate names", async () => {
    await inRollback(db, async (tx) => {
      const asDb = tx as unknown as Db;
      const d1 = await addDealer(tx, 1);
      const first = (await saveBatch(asDb, { name: "One", notes: null, memberIds: [d1] }, ctx)) as { id: string };

      expect(await saveBatch(asDb, { name: "Two", notes: null, memberIds: [d1] }, ctx)).toEqual({
        ok: false,
        errors: { memberIds: "1 dealer is already in “One”. A dealer can be in only one batch." },
      });
      expect(
        await saveBatch(asDb, { name: "Two", notes: null, memberIds: ["00000000-0000-4000-8000-000000000000"] }, ctx),
      ).toEqual({
        ok: false,
        errors: { memberIds: "Some of these dealers no longer exist. Reopen and try again." },
      });
      expect(await saveBatch(asDb, { name: "one", notes: null, memberIds: [] }, ctx)).toEqual({
        ok: false,
        errors: { name: "Another batch already has this name." },
      });
      // Saving a batch with its own members is fine.
      expect(await saveBatch(asDb, { name: "One", notes: null, memberIds: [d1] }, { ...ctx, batchId: first.id })).toEqual({
        ok: true,
        id: first.id,
      });
    });
  });
});

const SCOPE: CallingScope = { mode: "testing", allowedNumbers: ["+919000012345"] };

describe("batchPicker, listBatches and removeBatch", () => {
  it("shows who is taken, summarises each batch, and archives batches with sets", async () => {
    await inRollback(db, async (tx) => {
      const asDb = tx as unknown as Db;
      const owner = await addDealer(tx, 0, "+919000012345");
      const friend = await addDealer(tx, 1);
      const free = await addDealer(tx, 2, "+919000012345");
      const batch = (await saveBatch(asDb, { name: "Testers", notes: null, memberIds: [owner, friend] }, ctx)) as {
        id: string;
      };

      const picker = await batchPicker(asDb, SCOPE);
      expect(picker.find((p) => p.id === friend)).toMatchObject({
        notPermitted: true,
        batch: { id: batch.id, name: "Testers" },
      });
      expect(picker.find((p) => p.id === free)).toMatchObject({ notPermitted: false, batch: null });
      expect(JSON.stringify(picker)).not.toContain("+91");

      expect((await listBatches(asDb, SCOPE))[0]).toMatchObject({
        name: "Testers",
        members: 2,
        callable: 1,
        brands: [{ code: "hero", n: 2 }],
        states: [{ code: "KA", n: 2 }],
        setCount: 0,
        lastSet: null,
      });

      // Never called → deleted.
      expect(await removeBatch(asDb, batch.id, ctx)).toEqual({ ok: true, removed: "deleted" });
      expect(await tx.select().from(batches).where(eq(batches.id, batch.id))).toEqual([]);

      // Has a set → archived, members released, name free again, sorted last.
      const called = (await saveBatch(asDb, { name: "Called", notes: null, memberIds: [owner] }, ctx)) as { id: string };
      await tx.insert(sets).values({
        batchId: called.id,
        surveyId: await latestSurveyId(tx),
        weekStart: "2026-10-26",
        createdBy: "test",
      });
      expect((await listBatches(asDb, SCOPE))[0]).toMatchObject({ setCount: 1, lastSet: { weekStart: "2026-10-26" } });
      expect(await removeBatch(asDb, called.id, ctx)).toEqual({ ok: true, removed: "archived" });
      const [archived] = await tx.select().from(batches).where(eq(batches.id, called.id));
      expect(archived!.archivedAt).not.toBeNull();
      expect(await tx.select().from(batchMembers).where(eq(batchMembers.batchId, called.id))).toEqual([]);
      expect(await removeBatch(asDb, called.id, ctx)).toEqual({ ok: false, error: "This batch no longer exists." });
      expect((await saveBatch(asDb, { name: "Called", notes: null, memberIds: [] }, ctx)).ok).toBe(true);
      expect((await listBatches(asDb, SCOPE)).at(-1)).toMatchObject({ id: called.id, members: 0 });
      expect(await tx.select().from(sets).where(eq(sets.batchId, called.id))).toHaveLength(1);
    });
  });
});
