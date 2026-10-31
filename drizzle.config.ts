import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, so load .env.local ourselves (values already set win).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
