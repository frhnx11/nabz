// Runs in every DB test worker before the tests: point DATABASE_URL at the test database.
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl || !/\/nabz_test(\?|$)/.test(testUrl)) {
  throw new Error("DATABASE_URL_TEST must point at the nabz_test database (run pnpm db:bootstrap).");
}
process.env.DATABASE_URL = testUrl;
