/**
 * Destructive scripts (bootstrap, reset) only ever touch local development databases.
 * This guard is pure so it can be unit-tested; scripts call it before connecting.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
export const LOCAL_DATABASES = ["nabz_dev", "nabz_test"] as const;

export type LocalDatabase = { host: string; port: number; database: string; user: string };

export function parseDatabaseUrl(url: string): LocalDatabase {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Database URL is not a valid URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Database URL must use postgres://");
  }
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    user: decodeURIComponent(parsed.username),
  };
}

/** Throws unless the URL points at a local nabz_dev / nabz_test database. Never echoes the password. */
export function assertLocalNabzDatabase(
  url: string,
  allowed: readonly string[] = LOCAL_DATABASES,
): LocalDatabase {
  const db = parseDatabaseUrl(url);
  if (!LOCAL_HOSTS.has(db.host)) {
    throw new Error(
      `Refusing to run against non-local host "${db.host}". This script is for local development only.`,
    );
  }
  if (!allowed.includes(db.database)) {
    throw new Error(`Refusing to run against database "${db.database}". Allowed: ${allowed.join(", ")}.`);
  }
  return db;
}
