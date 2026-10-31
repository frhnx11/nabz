import { desc, eq } from "drizzle-orm";
import { createDb, type Db } from "../../src/lib/db/client";
import { surveys } from "../../src/lib/db/schema";

export function testDb() {
  const url = process.env.DATABASE_URL;
  if (!url?.includes("/nabz_test")) throw new Error("DB tests must run against nabz_test");
  return createDb(url, { max: 2 });
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The id of a survey's latest synced version (the one new calls use). A lookup by slug alone would
 * pick an arbitrary row once a survey has several versions.
 */
export async function latestSurveyId(tx: Pick<Db, "select">, slug = "vehicle_pulse"): Promise<string> {
  const [survey] = await tx
    .select({ id: surveys.id })
    .from(surveys)
    .where(eq(surveys.slug, slug))
    .orderBy(desc(surveys.version))
    .limit(1);
  if (!survey) throw new Error(`${slug} is not synced`);
  return survey.id;
}

class Rollback extends Error {}

/** Runs a test body in a transaction that is always rolled back, so tests never leave data behind. */
export async function inRollback(db: Db, body: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await body(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** The underlying Postgres error (Drizzle wraps driver errors in `cause`). */
function pgError(error: unknown): { message: string; constraint?: string; code?: string } {
  let e = error as { message?: string; constraint?: string; code?: string; cause?: unknown };
  while (e?.cause && !e.code) e = e.cause as typeof e;
  return { message: String(e?.message ?? error), constraint: e?.constraint, code: e?.code };
}

/**
 * Asserts that a statement fails, inside a savepoint so the surrounding transaction stays usable.
 * Returns the Postgres error so tests can check which constraint or guard fired.
 */
export async function expectFailure(tx: Tx, statement: (sp: Tx) => Promise<unknown>) {
  try {
    await tx.transaction(async (sp) => {
      await statement(sp);
    });
  } catch (error) {
    return pgError(error);
  }
  throw new Error("Expected the statement to fail, but it succeeded");
}
