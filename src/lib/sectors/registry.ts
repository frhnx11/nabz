import { PLANNED_SECTORS } from "./planned";
import { SECTOR_SLUG_RE, type SectorConfig } from "./schema";
import { vehicles } from "./vehicles";

export const SECTORS: readonly SectorConfig[] = [vehicles, ...PLANNED_SECTORS].toSorted(
  (a, b) => a.sortOrder - b.sortOrder,
);

const bySlug = new Map(SECTORS.map((s) => [s.slug, s]));

export function getSector(slug: string): SectorConfig {
  const sector = bySlug.get(slug);
  if (!sector) throw new Error(`Unknown sector: ${slug}`);
  return sector;
}

export function vocabLabel(sector: SectorConfig, attribute: string, code: string): string {
  return sector.vocab[attribute]?.find((v) => v.code === code)?.label ?? code;
}

/** Structural checks that the type system can't express. Run by tests and by db:sync. */
export function validateSectors(sectors: readonly SectorConfig[] = SECTORS): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const s of sectors) {
    if (!SECTOR_SLUG_RE.test(s.slug)) errors.push(`sector ${s.slug}: invalid slug`);
    if (seen.has(s.slug)) errors.push(`sector ${s.slug}: duplicate slug`);
    seen.add(s.slug);
    if (s.status === "live" && !s.pulseSurvey)
      errors.push(`sector ${s.slug}: live sectors need a pulse survey`);
    for (const [attr, entries] of Object.entries(s.vocab)) {
      const codes = entries.map((e) => e.code);
      if (new Set(codes).size !== codes.length) errors.push(`sector ${s.slug}: duplicate codes in ${attr}`);
    }
  }
  return errors;
}
