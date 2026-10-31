/**
 * Collects call results from Bolna: every real call that isn't finished is fetched and stored, and
 * the extraction fallback runs where it's due (src/lib/db/collect.ts). Reads from Bolna only: it can
 * never place a call.
 *
 *   pnpm calls:sync    once
 *   pnpm calls:watch   every 30 s while any call is open, stopping by itself (at most 30 minutes)
 */
import { setTimeout as sleep } from "node:timers/promises";
import { createBolnaClient } from "../../src/lib/bolna/client";
import { NO_NUMBERS } from "../../src/lib/calling-policy";
import { createDb } from "../../src/lib/db/client";
import { collectCalls, describeCollection, pendingCollection } from "../../src/lib/db/collect";
import { env } from "../../src/lib/env";
import { loadLocalEnv, runScript } from "./_env";

const WATCH_EVERY_MS = 30_000;
const WATCH_FOR_MS = 30 * 60_000;

runScript(async () => {
  loadLocalEnv();
  const config = env();
  if (!config.BOLNA_API_KEY) throw new Error("BOLNA_API_KEY is not set");
  const watch = process.argv.includes("--watch");
  // Read-only use of the client: calling stays switched off here whatever the environment says.
  const bolna = createBolnaClient({ apiKey: config.BOLNA_API_KEY, callingEnabled: false, scope: NO_NUMBERS });

  const { db, pool } = createDb(config.DATABASE_URL, { max: 1 });
  try {
    const stopAt = Date.now() + WATCH_FOR_MS;
    for (;;) {
      const summary = await collectCalls(db, bolna);
      const time = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
      console.log(`${time}  ${describeCollection(summary)}`);
      for (const e of summary.errors) console.log(`          call ${e.callId}: ${e.message}`);
      if (!watch) break;
      if ((await pendingCollection(db)) === 0) {
        console.log("✓ nothing left to collect");
        break;
      }
      if (Date.now() + WATCH_EVERY_MS > stopAt) {
        console.log("Stopped after 30 minutes; run it again if calls are still open.");
        break;
      }
      await sleep(WATCH_EVERY_MS);
    }
  } finally {
    await pool.end();
  }
});
