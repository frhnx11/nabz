import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env";
import * as schema from "./schema";

// Return `date` columns as "YYYY-MM-DD" strings. The default parses them as local-midnight Date
// objects, which shifts survey weeks by a day on any machine not running in UTC.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export type Db = NodePgDatabase<typeof schema>;

/** Creates a pool + Drizzle instance for an explicit URL (scripts and tests). Caller must end the pool. */
export function createDb(url: string, options: pg.PoolConfig = {}): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, application_name: "nabz", ...options });
  return { db: drizzle(pool, { schema }), pool };
}

// One pool per process. In development, hot reloads re-evaluate modules, so the pool is kept on
// globalThis; otherwise every edit would leak a pool and exhaust Postgres connections.
const globalForDb = globalThis as unknown as { nabzDb?: { db: Db; pool: pg.Pool } };

/** The app's database. Created on first use, so importing this module never connects. */
export function db(): Db {
  globalForDb.nabzDb ??= createDb(env().DATABASE_URL, { max: 10, idleTimeoutMillis: 30_000 });
  return globalForDb.nabzDb.db;
}
