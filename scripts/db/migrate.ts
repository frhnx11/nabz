/** Applies pending migrations from ./drizzle to DATABASE_URL. */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "../../src/lib/db/client";
import { parseDatabaseUrl } from "../../src/lib/db/local-guard";
import { loadLocalEnv, runScript } from "./_env";

export async function runMigrations(url: string): Promise<void> {
  const { db, pool } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/db/migrate.ts")) {
  runScript(async () => {
    loadLocalEnv();
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (run pnpm db:bootstrap first)");
    const target = parseDatabaseUrl(url);
    await runMigrations(url);
    console.log(`✓ migrations applied to ${target.database} on ${target.host}`);
  });
}
