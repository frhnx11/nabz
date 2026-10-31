// Runs once before the DB test suite: rebuild nabz_test from the migrations, then load reference data.
import { existsSync } from "node:fs";
import { resetLocalDatabase } from "../../scripts/db/reset";
import { createDb } from "../../src/lib/db/client";
import { syncReferenceData } from "../../src/lib/db/sync";

export default async function setup(): Promise<void> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is not set (run pnpm db:bootstrap)");
  await resetLocalDatabase(url);
  const { db, pool } = createDb(url, { max: 1 });
  try {
    await syncReferenceData(db);
  } finally {
    await pool.end();
  }
}
