import { CITY_TIERS, getState, REGIONS, STATES } from "../reference/geo";
import { vocabLabel } from "../sectors/registry";
import type { SectorConfig } from "../sectors/schema";
import type { SurveyDefinition } from "../surveys/schema";

/**
 * Display labels and natural order for dimension values (brand "tvs" → "TVS", state "KA" →
 * "Karnataka", city tier "2" → "Tier 2 cities"). Driven by the survey's dimension sources, so it
 * works for any sector.
 */

type Defn = Pick<SurveyDefinition, "dimensions">;

function sourceOf(definition: Defn, dimension: string) {
  const d = definition.dimensions.find((x) => x.key === dimension);
  if (!d) throw new Error(`Unknown dimension: ${dimension}`);
  return d.source;
}

export function dimensionValueLabel(
  definition: Defn,
  sector: SectorConfig,
  dimension: string,
  code: string,
  form: "long" | "short" = "long",
): string {
  const source = sourceOf(definition, dimension);
  if (source.kind === "attribute") return vocabLabel(sector, source.attribute, code);
  switch (source.field) {
    case "state": {
      const s = getState(code);
      return form === "short" ? s.shortName : s.name;
    }
    case "region":
      return REGIONS.find((r) => r.code === code)?.name ?? code;
    case "city_tier": {
      const t = CITY_TIERS.find((x) => String(x.tier) === code);
      return (form === "short" ? t?.short : t?.label) ?? code;
    }
  }
}

/** Every value a dimension can take, in display order (vocabulary order for attributes). */
export function dimensionValues(definition: Defn, sector: SectorConfig, dimension: string): string[] {
  const source = sourceOf(definition, dimension);
  if (source.kind === "attribute") return (sector.vocab[source.attribute] ?? []).map((v) => v.code);
  switch (source.field) {
    case "state":
      return STATES.map((s) => s.code);
    case "region":
      return REGIONS.map((r) => r.code);
    case "city_tier":
      return CITY_TIERS.map((t) => String(t.tier));
  }
}

/** The dimension that holds a geo field (e.g. which dimension key is "state"), if the survey has one. */
export function geoDimension(definition: Defn, field: "state" | "region" | "city_tier"): string | null {
  return definition.dimensions.find((d) => d.source.kind === "geo" && d.source.field === field)?.key ?? null;
}

/** The first attribute dimension (vehicles: brand), the dealer's main identity in the sector. */
export function primaryAttributeDimension(definition: Defn): string | null {
  return definition.dimensions.find((d) => d.source.kind === "attribute")?.key ?? null;
}
