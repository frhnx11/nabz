import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { testDb } from "./helpers";

const { db, pool } = testDb();
afterAll(() => pool.end());

type Snapshot = {
  tables: Record<
    string,
    {
      name: string;
      columns: Record<string, unknown>;
      indexes: Record<string, unknown>;
      foreignKeys: Record<string, unknown>;
      uniqueConstraints: Record<string, unknown>;
      checkConstraints?: Record<string, unknown>;
      compositePrimaryKeys?: Record<string, unknown>;
    }
  >;
};

function latestSnapshot(): Snapshot {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
    entries: { idx: number }[];
  };
  const idx = Math.max(...journal.entries.map((e) => e.idx));
  return JSON.parse(
    readFileSync(`drizzle/meta/${String(idx).padStart(4, "0")}_snapshot.json`, "utf8"),
  ) as Snapshot;
}

/**
 * nabz_test is built from the migration files, and drizzle-kit diffs the schema against the latest
 * snapshot. Hand-written migrations (renames: 0003) could drift from either; this catches it, down to
 * Postgres 18's named NOT NULL constraints.
 */
describe("migrations", () => {
  it("build exactly the tables, columns, constraints and indexes in drizzle's snapshot", async () => {
    const snapshot = latestSnapshot();
    const cons = (
      await db.execute<{ t: string; n: string; k: string; col: string | null }>(sql`
        select rel.relname t, con.conname n, con.contype k, a.attname col
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        left join pg_attribute a on a.attrelid = rel.oid and a.attnum = con.conkey[1]
        where rel.relnamespace = 'public'::regnamespace`)
    ).rows;
    const indexes = (
      await db.execute<{ t: string; n: string }>(
        sql`select tablename t, indexname n from pg_indexes where schemaname = 'public'`,
      )
    ).rows;
    const columns = (
      await db.execute<{ t: string; n: string }>(
        sql`select table_name t, column_name n from information_schema.columns where table_schema = 'public'`,
      )
    ).rows;

    const problems: string[] = [];
    const tables = Object.values(snapshot.tables);
    for (const tb of tables) {
      const t = tb.name;
      const dbCols = new Set(columns.filter((r) => r.t === t).map((r) => r.n));
      for (const c of Object.keys(tb.columns)) if (!dbCols.has(c)) problems.push(`${t}: missing column ${c}`);
      for (const c of dbCols) if (!(c in tb.columns)) problems.push(`${t}: extra column ${c}`);

      const want = new Set([
        ...Object.keys(tb.foreignKeys),
        ...Object.keys(tb.uniqueConstraints),
        ...Object.keys(tb.checkConstraints ?? {}),
        ...Object.keys(tb.compositePrimaryKeys ?? {}),
      ]);
      const mine = cons.filter((r) => r.t === t);
      for (const n of want) if (!mine.some((r) => r.n === n)) problems.push(`${t}: missing constraint ${n}`);
      for (const r of mine) {
        if (r.k === "n") {
          if (r.n !== `${t}_${r.col}_not_null`) problems.push(`${t}: NOT NULL constraint named ${r.n}`);
        } else if (r.k === "p" && !want.has(r.n)) {
          if (r.n !== `${t}_pkey`) problems.push(`${t}: primary key named ${r.n}`);
        } else if (!want.has(r.n)) {
          problems.push(`${t}: extra constraint ${r.n}`);
        }
      }

      const wantIdx = new Set(Object.keys(tb.indexes));
      const haveIdx = indexes.filter((r) => r.t === t && !cons.some((c) => c.n === r.n)).map((r) => r.n);
      for (const n of wantIdx) if (!haveIdx.includes(n)) problems.push(`${t}: missing index ${n}`);
      for (const n of haveIdx) if (!wantIdx.has(n)) problems.push(`${t}: extra index ${n}`);
    }
    for (const t of new Set(columns.map((r) => r.t))) {
      if (!tables.some((x) => x.name === t)) problems.push(`extra table ${t}`);
    }
    expect(problems).toEqual([]);
  });
});
