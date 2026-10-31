import { canonicalHash } from "../domain/canonical-json";
import { SECTORS } from "../sectors/registry";
import type { SectorConfig } from "../sectors/schema";
import { vehiclePulseV1 } from "./definitions/vehicle-pulse.v1";
import { vehiclePulseV2 } from "./definitions/vehicle-pulse.v2";
import type { SurveyDefinition } from "./schema";

/** Every survey definition, all versions. Old versions stay here forever: past calls refer to them. */
export const SURVEYS: readonly SurveyDefinition[] = [vehiclePulseV1, vehiclePulseV2];

/** The newest version of a survey: the one new runs use. */
export function latestSurvey(slug: string): SurveyDefinition {
  const versions = SURVEYS.filter((s) => s.slug === slug).toSorted((a, b) => b.version - a.version);
  const latest = versions[0];
  if (!latest) throw new Error(`Unknown survey ${slug}`);
  return latest;
}

/** Fingerprint stored with the frozen definition; any edit to a definition changes it. */
export function definitionHash(def: SurveyDefinition): string {
  return canonicalHash(def).sha256;
}

/** Checks that need both the surveys and the sectors. Run by tests and by db:sync. */
export function validateSurveys(
  surveys: readonly SurveyDefinition[] = SURVEYS,
  sectors: readonly SectorConfig[] = SECTORS,
): string[] {
  const errors: string[] = [];
  const sectorBySlug = new Map(sectors.map((s) => [s.slug, s]));
  const ids = new Set<string>();

  for (const def of surveys) {
    const id = `${def.slug} v${def.version}`;
    if (ids.has(id)) errors.push(`${id}: defined twice`);
    ids.add(id);

    const sector = sectorBySlug.get(def.sector);
    if (!sector) {
      errors.push(`${id}: unknown sector "${def.sector}"`);
      continue;
    }
    if (sector.status !== "live") errors.push(`${id}: sector "${def.sector}" is not live`);
    for (const dim of def.dimensions) {
      if (dim.source.kind === "attribute" && !sector.vocab[dim.source.attribute]) {
        errors.push(
          `${id}: dimension "${dim.key}" uses attribute "${dim.source.attribute}", which sector "${sector.slug}" doesn't define`,
        );
      }
    }
  }

  for (const sector of sectors) {
    if (
      sector.pulseSurvey &&
      !surveys.some((s) => s.slug === sector.pulseSurvey && s.sector === sector.slug)
    ) {
      errors.push(`sector ${sector.slug}: pulse survey "${sector.pulseSurvey}" doesn't exist`);
    }
  }
  return errors;
}
