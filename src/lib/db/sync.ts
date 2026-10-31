import { and, eq } from "drizzle-orm";
import { canonicalHash } from "../domain/canonical-json";
import { CITIES, REGIONS, STATES, TIER_SOURCE } from "../reference/geo";
import { SECTORS, validateSectors } from "../sectors/registry";
import { definitionHash, SURVEYS, validateSurveys } from "../surveys/registry";
import type { Db } from "./client";
import { geoCities, geoRegions, geoStates, sectors, surveys } from "./schema";

export type SyncSummary = {
  sectors: number;
  regions: number;
  states: number;
  cities: number;
  surveys: string[];
};

/**
 * Mirrors code-defined configuration (sectors, geography, survey definitions) into the database.
 * Idempotent. Refuses to change a survey version that is frozen (already used by calls): that change
 * must be a new version in code.
 */
export async function syncReferenceData(db: Db, now = new Date()): Promise<SyncSummary> {
  const problems = [...validateSectors(), ...validateSurveys()];
  if (problems.length > 0) throw new Error(`Configuration is invalid:\n- ${problems.join("\n- ")}`);

  return db.transaction(async (tx) => {
    for (const s of SECTORS) {
      const configSha256 = canonicalHash({
        slug: s.slug,
        name: s.name,
        status: s.status,
        sortOrder: s.sortOrder,
        nouns: s.nouns,
        vocab: s.vocab,
        pulseSurvey: s.pulseSurvey,
      }).sha256;
      const row = {
        slug: s.slug,
        name: s.name,
        status: s.status,
        sortOrder: s.sortOrder,
        nouns: s.nouns,
        configSha256,
      };
      await tx
        .insert(sectors)
        .values({ ...row, syncedAt: now })
        .onConflictDoUpdate({ target: sectors.slug, set: { ...row, syncedAt: now } });
    }

    for (const [i, r] of REGIONS.entries()) {
      const row = { code: r.code, name: r.name, sortOrder: i + 1 };
      await tx.insert(geoRegions).values(row).onConflictDoUpdate({ target: geoRegions.code, set: row });
    }
    for (const [i, s] of STATES.entries()) {
      const row = {
        code: s.code,
        name: s.name,
        shortName: s.shortName,
        regionCode: s.region,
        sortOrder: i + 1,
      };
      await tx.insert(geoStates).values(row).onConflictDoUpdate({ target: geoStates.code, set: row });
    }
    for (const c of CITIES) {
      const row = { code: c.code, stateCode: c.state, name: c.name, tier: c.tier, tierSource: TIER_SOURCE };
      await tx.insert(geoCities).values(row).onConflictDoUpdate({ target: geoCities.code, set: row });
    }

    const surveyResults: string[] = [];
    for (const def of SURVEYS) {
      const sha = definitionHash(def);
      const label = `${def.slug} v${def.version}`;
      const [existing] = await tx
        .select({ id: surveys.id, sha: surveys.definitionSha256, frozenAt: surveys.frozenAt })
        .from(surveys)
        .where(and(eq(surveys.slug, def.slug), eq(surveys.version, def.version)));

      const fields = {
        sectorSlug: def.sector,
        kind: def.kind,
        title: def.title.en,
        schemaVersion: def.schemaVersion,
        definition: def,
        definitionSha256: sha,
      };

      if (!existing) {
        await tx.insert(surveys).values({ slug: def.slug, version: def.version, ...fields, syncedAt: now });
        surveyResults.push(`${label}: created`);
      } else if (existing.sha === sha) {
        surveyResults.push(`${label}: unchanged`);
      } else if (existing.frozenAt) {
        throw new Error(
          `${label} is frozen (used since ${existing.frozenAt.toISOString()}) but its definition changed in code. ` +
            `Restore it and add version ${def.version + 1} instead.`,
        );
      } else {
        await tx
          .update(surveys)
          .set({ ...fields, syncedAt: now })
          .where(eq(surveys.id, existing.id));
        surveyResults.push(`${label}: updated (not yet frozen)`);
      }
    }

    return {
      sectors: SECTORS.length,
      regions: REGIONS.length,
      states: STATES.length,
      cities: CITIES.length,
      surveys: surveyResults,
    };
  });
}
