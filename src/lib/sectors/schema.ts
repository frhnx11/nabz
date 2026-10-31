import type { z } from "zod";

/** A value a dealer attribute can take, e.g. brand "tvs" labelled "TVS". */
export type VocabEntry = { code: string; label: string; meta?: Record<string, string> };

/**
 * A sector is a kind of business Nabz surveys (vehicle dealers, kirana stores, …).
 * Adding a sector means adding one of these, plus a survey definition; no code paths change.
 */
export type SectorConfig = {
  slug: string;
  name: string;
  status: "live" | "planned";
  sortOrder: number;
  /** What the sector calls a dealer in UI copy: "n = 312 dealers", "n = 40 stores". */
  nouns: { one: string; other: string };
  /** Validates dealers.attributes for this sector. */
  attributes: z.ZodType<Record<string, string>>;
  /** Allowed values (and their display order) for each attribute. Dimensions and labels use these. */
  vocab: Record<string, readonly VocabEntry[]>;
  /** The survey behind this sector's weekly Pulse, if it has one. */
  pulseSurvey: string | null;
};

export const SECTOR_SLUG_RE = /^[a-z][a-z0-9_]*$/;
