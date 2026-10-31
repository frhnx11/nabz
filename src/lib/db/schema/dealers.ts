import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { CALL_LANGUAGE_CODES } from "../../reference/languages";
import { createdAt, inList, pk, updatedAt } from "./_shared";
import { geoCities, sectors } from "./config";

/**
 * A business Nabz calls: a vehicle dealer, or in another sector a store, … "Dealer" is the generic
 * word for it across the code. Sector-specific facts (brand, segment, store size) live in `attributes`,
 * validated by the sector's schema in code. Several dealers may share a phone (one owner with several
 * showrooms, or testers on one number).
 */
export const dealers = pgTable(
  "dealers",
  {
    id: pk(),
    sectorSlug: text("sector_slug")
      .notNull()
      .references(() => sectors.slug),
    businessName: text("business_name").notNull(),
    contactName: text("contact_name"),
    contactRole: text("contact_role"),
    phoneE164: text("phone_e164").notNull(),
    cityCode: text("city_code")
      .notNull()
      .references(() => geoCities.code),
    /** The language we always call this dealer in: one of CALL_LANGUAGES (src/lib/reference/languages.ts). */
    language: text("language").notNull().default("hi"),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("dealers_sector_idx").on(t.sectorSlug),
    index("dealers_city_idx").on(t.cityCode),
    check("dealers_phone_format_ck", sql`${t.phoneE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check("dealers_attributes_ck", sql`jsonb_typeof(${t.attributes}) = 'object'`),
    check("dealers_language_ck", inList(t.language, CALL_LANGUAGE_CODES)),
  ],
);
