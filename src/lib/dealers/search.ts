import { BRANDS, SEGMENTS } from "../sectors/vehicles";

/**
 * Turns what an operator types into the search box into per-word criteria. Every word must match
 * some field (so "tvs gorakhpur" finds TVS dealers in Gorakhpur). Words are matched against text
 * fields directly, and also against the labels of coded fields (brand "Royal Enfield" → royal_enfield).
 */

export type SearchToken = {
  /** The word as typed, lower-cased, for text fields (LIKE-escaped by the query layer). */
  text: string;
  /** Digits only, when the word looks like part of a phone number (3+ digits). */
  digits: string | null;
  brandCodes: string[];
  segmentCodes: string[];
  /** 1, 2 or 3 when the word is a tier ("2", "tier2", "t2"). */
  tier: 1 | 2 | 3 | null;
};

const MAX_TOKENS = 6;

export function parseSearch(query: string | null | undefined): SearchToken[] {
  if (!query) return [];
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .slice(0, MAX_TOKENS)
    .map((word) => {
      const bare = word.replace(/[^\p{L}\p{N}]/gu, "");
      const digits = word.replace(/[\s+\-()]/g, "");
      const tierMatch = /^(?:tier|t)?([123])$/.exec(bare);
      return {
        text: word,
        digits: /^\d{3,}$/.test(digits) ? digits : null,
        brandCodes: bare
          ? BRANDS.filter(
              (b) => b.label.toLowerCase().replace(/\s+/g, "").includes(bare) || b.code.includes(bare),
            ).map((b) => b.code)
          : [],
        segmentCodes: bare
          ? SEGMENTS.filter(
              (s) =>
                s.label
                  .toLowerCase()
                  .replace(/[^a-z]/g, "")
                  .includes(bare) || s.code.includes(bare),
            ).map((s) => s.code)
          : [],
        tier: tierMatch ? (Number(tierMatch[1]) as 1 | 2 | 3) : null,
      };
    });
}

/** Escapes LIKE wildcards so a typed "%" or "_" is matched literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
