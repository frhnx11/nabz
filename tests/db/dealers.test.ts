import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/lib/db/client";
import { createDealer, getDealer, listDealers, updateDealer } from "../../src/lib/db/queries/dealers";
import { auditLog, dealers } from "../../src/lib/db/schema";
import { parseNewDealer } from "../../src/lib/dealers/new-dealer";
import { expectFailure, inRollback, testDb } from "./helpers";

const { db, pool } = testDb();
afterAll(() => pool.end());

const context = { actor: "Tester" };

function dealer(patch: Record<string, string> = {}) {
  const parsed = parseNewDealer({
    businessName: "Shree Balaji TVS",
    contactName: "Ramesh K.",
    contactRole: "",
    phone: "98765 43210",
    brand: "tvs",
    cityCode: "up-gorakhpur",
    language: "hi",
    notes: "",
    ...patch,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.dealer;
}

describe("createDealer", () => {
  it("saves a dealer and audits it without personal data", async () => {
    await inRollback(db, async (tx) => {
      const asDb = tx as unknown as Db;
      const result = await createDealer(asDb, dealer(), context);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [row] = await tx.select().from(dealers).where(eq(dealers.id, result.id));
      expect(row).toMatchObject({
        phoneE164: "+919876543210",
        cityCode: "up-gorakhpur",
        language: "hi",
        contactRole: "Sales manager",
        attributes: { brand: "tvs", segment: "two_wheeler" },
      });
      const [entry] = await tx.select().from(auditLog).where(eq(auditLog.entityId, result.id));
      expect(entry).toMatchObject({ actor: "Tester", action: "dealer.create" });
      const logged = JSON.stringify(entry);
      expect(logged).not.toContain("9876543210");
      expect(logged).not.toContain("Balaji");
    });
  });

  it("lets several dealers share a number (testers on one phone, one owner with several showrooms)", async () => {
    await inRollback(db, async (tx) => {
      const asDb = tx as unknown as Db;
      await createDealer(asDb, dealer(), context);
      const again = await createDealer(
        asDb,
        dealer({ businessName: "Other Motors", phone: "+91 98765 43210" }),
        context,
      );
      expect(again.ok).toBe(true);
    });
  });

});

describe("call language", () => {
  it("stores the chosen language and refuses one we can't call in", async () => {
    await inRollback(db, async (tx) => {
      const asDb = tx as unknown as Db;
      const result = await createDealer(asDb, dealer({ language: "ta" }), context);
      if (!result.ok) throw new Error("not created");
      const [row] = await tx.select({ language: dealers.language }).from(dealers).where(eq(dealers.id, result.id));
      expect(row?.language).toBe("ta");
      const refused = await expectFailure(tx, (sp) => sp.execute(sql`update dealers set language = 'ur' where id = ${result.id}`));
      expect(refused.constraint).toBe("dealers_language_ck");
    });
  });
});

describe("editing a dealer", () => {
  it("loads a dealer's details for the form", async () => {
    await inRollback(db, async (tx) => {
      const asDb = tx as unknown as Db;
      const created = await createDealer(asDb, dealer(), context);
      if (!created.ok) throw new Error("not created");
      expect(await getDealer(asDb, created.id)).toMatchObject({
        businessName: "Shree Balaji TVS",
        phoneE164: "+919876543210",
        cityCode: "up-gorakhpur",
        language: "hi",
        attributes: { brand: "tvs" },
      });
    });
  });

  it("saves every field and audits only the field names and codes, nothing personal", async () => {
    await inRollback(db, async (tx) => {
      const asDb = tx as unknown as Db;
      const created = await createDealer(asDb, dealer(), context);
      if (!created.ok) throw new Error("not created");
      const edited = dealer({
        businessName: "Shree Balaji Hyundai",
        contactName: "Suresh P.",
        phone: "98765 11111",
        brand: "hyundai",
        cityCode: "tn-chennai",
        language: "en",
        notes: "Prefers mornings",
      });
      expect(await updateDealer(asDb, created.id, edited, context)).toEqual({ ok: true });

      const [row] = await tx.select().from(dealers).where(eq(dealers.id, created.id));
      expect(row).toMatchObject({
        businessName: "Shree Balaji Hyundai",
        contactName: "Suresh P.",
        phoneE164: "+919876511111",
        cityCode: "tn-chennai",
        language: "en",
        notes: "Prefers mornings",
        attributes: { brand: "hyundai", segment: "car" },
      });
      const entries = await tx.select().from(auditLog).where(eq(auditLog.action, "dealer.update"));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actor: "Tester",
        entityId: created.id,
        before: { brand: "tvs", cityCode: "up-gorakhpur", language: "hi" },
        after: { brand: "hyundai", cityCode: "tn-chennai", language: "en" },
      });
      expect(entries[0]?.meta).toMatchObject({
        changed: expect.arrayContaining(["businessName", "contactName", "phoneE164", "notes", "language"]),
      });
      const logged = JSON.stringify(entries[0]);
      for (const secret of ["Balaji", "Suresh", "9876511111", "9876543210", "mornings"]) expect(logged).not.toContain(secret);

      // Saving the same details again changes nothing and logs nothing.
      await updateDealer(asDb, created.id, edited, context);
      expect(await tx.select().from(auditLog).where(eq(auditLog.action, "dealer.update"))).toHaveLength(1);
    });
  });

  it("refuses an unknown dealer", async () => {
    await inRollback(db, async (tx) => {
      const asDb = tx as unknown as Db;
      const missing = "00000000-0000-4000-8000-000000000000";
      expect(await getDealer(asDb, missing)).toBeNull();
      expect((await updateDealer(asDb, missing, dealer(), context)).ok).toBe(false);
      expect((await updateDealer(asDb, "not-a-uuid", dealer(), context)).ok).toBe(false);
    });
  });
});

describe("listDealers", () => {
  async function withDealers(body: (asDb: Db) => Promise<void>) {
    await inRollback(db, async (tx) => {
      const asDb = tx as unknown as Db;
      await createDealer(asDb, dealer({ businessName: "Older Enfield", brand: "royal_enfield", cityCode: "br-patna", phone: "91234 50000" }), context);
      await createDealer(asDb, dealer({ businessName: "Maruti Arena", brand: "maruti", cityCode: "ka-bengaluru", phone: "91234 50001" }), context);
      await createDealer(asDb, dealer(), context);
      await body(asDb);
    });
  }

  it("lists everyone", async () => {
    await withDealers(async (asDb) => {
      const { rows, total } = await listDealers(asDb, { page: 1 });
      expect(total).toBe(3);
      expect(rows.map((r) => r.businessName).toSorted()).toEqual(["Maruti Arena", "Older Enfield", "Shree Balaji TVS"]);
    });
  });

  it("matches every word against some field", async () => {
    await withDealers(async (asDb) => {
      const { rows } = await listDealers(asDb, { query: "tvs gorakhpur", page: 1 });
      expect(rows.map((r) => r.businessName)).toEqual(["Shree Balaji TVS"]);
    });
  });

  it("finds by brand label, state code, tier and phone fragment", async () => {
    await withDealers(async (asDb) => {
      const names = async (query: string) => (await listDealers(asDb, { query, page: 1 })).rows.map((r) => r.businessName);
      expect(await names("royal enfield")).toEqual(["Older Enfield"]);
      expect(await names("BR")).toEqual(["Older Enfield"]);
      expect(await names("tier1 maruti")).toEqual(["Maruti Arena"]);
      expect(await names("98765")).toEqual(["Shree Balaji TVS"]);
    });
  });

  it("treats typed wildcards literally and returns nothing for nonsense", async () => {
    await withDealers(async (asDb) => {
      expect((await listDealers(asDb, { query: "%", page: 1 })).total).toBe(0);
      expect((await listDealers(asDb, { query: "zzqqxx", page: 1 })).total).toBe(0);
    });
  });
});
