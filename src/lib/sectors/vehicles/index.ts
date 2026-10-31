import { z } from "zod";
import type { SectorConfig, VocabEntry } from "../schema";

export const SEGMENTS = [
  { code: "two_wheeler", label: "Two-wheelers" },
  { code: "car", label: "Cars" },
] as const satisfies readonly VocabEntry[];
export type Segment = (typeof SEGMENTS)[number]["code"];

/**
 * Brands in the mockup's heatmap row order. Each brand belongs to exactly one segment:
 * "honda" is Honda Motorcycle & Scooter India (two-wheelers); Honda Cars would be its own brand.
 * Vahan maker names are mapped in a later step, when registration data is loaded.
 */
export const BRANDS = [
  { code: "tvs", label: "TVS", segment: "two_wheeler" },
  { code: "hero", label: "Hero", segment: "two_wheeler" },
  { code: "bajaj", label: "Bajaj", segment: "two_wheeler" },
  { code: "honda", label: "Honda", segment: "two_wheeler" },
  { code: "royal_enfield", label: "Royal Enfield", segment: "two_wheeler" },
  { code: "maruti", label: "Maruti", segment: "car" },
  { code: "mahindra", label: "Mahindra", segment: "car" },
  { code: "tata", label: "Tata", segment: "car" },
  { code: "hyundai", label: "Hyundai", segment: "car" },
] as const satisfies readonly { code: string; label: string; segment: Segment }[];
export type Brand = (typeof BRANDS)[number]["code"];

const brandCodes = BRANDS.map((b) => b.code) as [Brand, ...Brand[]];
const segmentCodes = SEGMENTS.map((s) => s.code) as [Segment, ...Segment[]];
const segmentOf = new Map<string, Segment>(BRANDS.map((b) => [b.code, b.segment]));

export const VehicleAttributes = z
  .strictObject({ brand: z.enum(brandCodes), segment: z.enum(segmentCodes) })
  .refine((a) => segmentOf.get(a.brand) === a.segment, {
    message: "brand and segment don't match",
    path: ["segment"],
  });

export const vehicles: SectorConfig = {
  slug: "vehicles",
  name: "Vehicles",
  status: "live",
  sortOrder: 1,
  nouns: { one: "dealer", other: "dealers" },
  attributes: VehicleAttributes,
  vocab: {
    brand: BRANDS.map((b) => ({ code: b.code, label: b.label, meta: { segment: b.segment } })),
    segment: SEGMENTS,
  },
  pulseSurvey: "vehicle_pulse",
};
