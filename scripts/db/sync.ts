/** Mirrors sectors, geography and survey definitions from code into the database. */
import { createDb } from "../../src/lib/db/client";
import { syncReferenceData } from "../../src/lib/db/sync";
import { loadLocalEnv, runScript } from "./_env";

runScript(async () => {
  loadLocalEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const { db, pool } = createDb(url, { max: 1 });
  try {
    const summary = await syncReferenceData(db);
    console.log(
      `✓ synced ${summary.sectors} sectors, ${summary.states} states, ${summary.cities} cities\n` +
        summary.surveys.map((s) => `  survey ${s}`).join("\n"),
    );
  } finally {
    await pool.end();
  }
});
