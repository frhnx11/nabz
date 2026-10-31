import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { tstz } from "./_shared";

/**
 * Who did what, append-only (trigger). Never stores personal data, because it can't be scrubbed:
 * record ids and field names, not names or numbers.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: tstz("at").notNull().defaultNow(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_at_idx").on(t.at.desc()),
    check("audit_log_action_ck", sql`${t.action} ~ '^[a-z_]+\\.[a-z_]+$'`),
  ],
);
