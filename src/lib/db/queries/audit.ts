import type { Db } from "../client";
import { auditLog } from "../schema";

export type AuditEntry = {
  actor: string;
  /** "<entity>.<verb>", e.g. "dealer.create", "set.start". */
  action: `${string}.${string}`;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
};

/**
 * Appends to the audit log. The log can never be edited or erased, so it must never contain personal
 * data: pass ids and field names, not names, phone numbers or transcripts.
 */
export async function audit(db: Pick<Db, "insert">, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actor: entry.actor,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    meta: entry.meta ?? null,
  });
}
