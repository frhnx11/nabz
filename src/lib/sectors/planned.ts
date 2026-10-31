import { z } from "zod";
import type { SectorConfig } from "./schema";

/**
 * Sectors on the roadmap. They exist as rows (so the UI can show them as "coming"), but have no
 * attributes or survey yet. Making one live = define its attributes, vocab and a survey definition.
 */
function planned(slug: string, name: string, sortOrder: number, nouns: SectorConfig["nouns"]): SectorConfig {
  return {
    slug,
    name,
    status: "planned",
    sortOrder,
    nouns,
    attributes: z.strictObject({}),
    vocab: {},
    pulseSurvey: null,
  };
}

export const PLANNED_SECTORS: readonly SectorConfig[] = [
  planned("kirana", "Kirana", 2, { one: "store", other: "stores" }),
  planned("building_materials", "Building materials", 3, { one: "dealer", other: "dealers" }),
  planned("pharma", "Pharmacies", 4, { one: "pharmacy", other: "pharmacies" }),
  planned("farm_inputs", "Farm inputs", 5, { one: "retailer", other: "retailers" }),
];
