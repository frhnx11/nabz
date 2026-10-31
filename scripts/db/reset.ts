/**
 * Drops and recreates a LOCAL database's schema, then migrates it.
 *   pnpm db:reset --yes            reset nabz_dev
 *   pnpm db:reset --yes --setup    reset, then sync
 * Refuses anything that isn't nabz_dev / nabz_test on this machine.
 */
import pg from "pg";
import { assertLocalNabzDatabase } from "../../src/lib/db/local-guard";
import { loadLocalEnv, runScript } from "./_env";
import { runMigrations } from "./migrate";

export async function resetLocalDatabase(url: string): Promise<void> {
  assertLocalNabzDatabase(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("drop schema if exists drizzle cascade");
    await client.query("drop schema public cascade");
    await client.query("create schema public");
  } finally {
    await client.end();
  }
  await runMigrations(url);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/db/reset.ts")) {
  runScript(async () => {
    loadLocalEnv();
    if (!process.argv.includes("--yes")) {
      throw new Error("This deletes all data in the local database. Re-run with --yes to confirm.");
    }
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const target = assertLocalNabzDatabase(url);
    await resetLocalDatabase(url);
    console.log(`✓ reset and migrated ${target.database}`);
    if (process.argv.includes("--setup")) {
      const { syncReferenceData } = await import("../../src/lib/db/sync");
      const { createDb } = await import("../../src/lib/db/client");
      const { db, pool } = createDb(url, { max: 1 });
      try {
        console.log(await syncReferenceData(db));
      } finally {
        await pool.end();
      }
    }
  });
}
