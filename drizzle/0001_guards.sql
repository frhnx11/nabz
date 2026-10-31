-- Database-level guarantees that application code can't accidentally break.
-- drizzle-kit doesn't model triggers, so they live in this hand-written migration.
-- Every guard raises SQLSTATE 'NZ001' ("nabz guard") so the app can recognise these errors.

-- 1. Survey definitions freeze on first use. After that only status and sync time may change.
CREATE FUNCTION nabz_surveys_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.frozen_at IS NOT NULL THEN
      RAISE EXCEPTION 'survey % v% is frozen and cannot be deleted', OLD.slug, OLD.version USING ERRCODE = 'NZ001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.frozen_at IS NOT NULL AND (
       NEW.frozen_at IS DISTINCT FROM OLD.frozen_at
    OR NEW.definition IS DISTINCT FROM OLD.definition
    OR NEW.definition_sha256 IS DISTINCT FROM OLD.definition_sha256
    OR NEW.slug IS DISTINCT FROM OLD.slug
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.sector_slug IS DISTINCT FROM OLD.sector_slug
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
  ) THEN
    RAISE EXCEPTION 'survey % v% is frozen: add a new version instead of editing it', OLD.slug, OLD.version USING ERRCODE = 'NZ001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER surveys_guard BEFORE UPDATE OR DELETE ON surveys FOR EACH ROW EXECUTE FUNCTION nabz_surveys_guard();
--> statement-breakpoint

-- 2. Append-only history: ops answer corrections and the audit log.
CREATE FUNCTION nabz_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'NZ001';
END $$;
--> statement-breakpoint
CREATE TRIGGER answer_overrides_append_only BEFORE UPDATE OR DELETE ON answer_overrides FOR EACH ROW EXECUTE FUNCTION nabz_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION nabz_append_only();
--> statement-breakpoint

-- TRUNCATE skips row triggers, so block it outright on the tables that must only grow.
CREATE TRIGGER answer_overrides_no_truncate BEFORE TRUNCATE ON answer_overrides FOR EACH STATEMENT EXECUTE FUNCTION nabz_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION nabz_append_only();
