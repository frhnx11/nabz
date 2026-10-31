/**
 * Geography reference data, mirrored into the geo_* tables by `pnpm db:sync`.
 *
 * City tiers follow the Government of India's HRA city classification (7th CPC): Annexure to
 * Department of Expenditure O.M. No. 2/5/2017-E.II(B) dated 07.07.2017, which carries the list
 * from O.M. No. 2/5/2014-E.II(B) dated 21.07.2015. Class X → tier 1, Y → tier 2, and every city
 * not listed as X or Y is class Z → tier 3. This is the most widely used official tiering.
 */

export const TIER_SOURCE = "GoI HRA classification, DoE O.M. 2/5/2017-E.II(B), 07.07.2017";

export type CityTier = 1 | 2 | 3;

export const CITY_TIERS: readonly { tier: CityTier; label: string; short: string }[] = [
  { tier: 1, label: "Tier 1 cities", short: "Tier 1" },
  { tier: 2, label: "Tier 2 cities", short: "Tier 2" },
  { tier: 3, label: "Tier 3 towns", short: "Tier 3" },
];

/** Regions follow the groupings used in the product mockup's splits. */
export const REGIONS = [
  { code: "north", name: "North" },
  { code: "west", name: "West" },
  { code: "south", name: "South" },
  { code: "east", name: "East" },
] as const;
export type RegionCode = (typeof REGIONS)[number]["code"];

/** Codes are ISO 3166-2:IN subdivision codes. Order is the mockup's heatmap column order. */
export const STATES = [
  { code: "UP", name: "Uttar Pradesh", shortName: "UP", region: "north" },
  { code: "BR", name: "Bihar", shortName: "Bihar", region: "north" },
  { code: "MP", name: "Madhya Pradesh", shortName: "MP", region: "north" },
  { code: "RJ", name: "Rajasthan", shortName: "Rajasthan", region: "west" },
  { code: "MH", name: "Maharashtra", shortName: "Maharashtra", region: "west" },
  { code: "GJ", name: "Gujarat", shortName: "Gujarat", region: "west" },
  { code: "TN", name: "Tamil Nadu", shortName: "Tamil Nadu", region: "south" },
  { code: "KA", name: "Karnataka", shortName: "Karnataka", region: "south" },
  { code: "WB", name: "West Bengal", shortName: "W Bengal", region: "east" },
] as const satisfies readonly { code: string; name: string; shortName: string; region: RegionCode }[];
export type StateCode = (typeof STATES)[number]["code"];

export type City = { code: string; state: StateCode; name: string; tier: CityTier };

export const CITIES: readonly City[] = [
  // Uttar Pradesh: no X cities; Lucknow, Kanpur, Gorakhpur, Varanasi are Y.
  { code: "up-lucknow", state: "UP", name: "Lucknow", tier: 2 },
  { code: "up-kanpur", state: "UP", name: "Kanpur", tier: 2 },
  { code: "up-gorakhpur", state: "UP", name: "Gorakhpur", tier: 2 },
  { code: "up-varanasi", state: "UP", name: "Varanasi", tier: 2 },
  { code: "up-sitapur", state: "UP", name: "Sitapur", tier: 3 },
  // Bihar: only Patna is Y.
  { code: "br-patna", state: "BR", name: "Patna", tier: 2 },
  { code: "br-gaya", state: "BR", name: "Gaya", tier: 3 },
  { code: "br-muzaffarpur", state: "BR", name: "Muzaffarpur", tier: 3 },
  { code: "br-darbhanga", state: "BR", name: "Darbhanga", tier: 3 },
  // Madhya Pradesh
  { code: "mp-indore", state: "MP", name: "Indore", tier: 2 },
  { code: "mp-bhopal", state: "MP", name: "Bhopal", tier: 2 },
  { code: "mp-jabalpur", state: "MP", name: "Jabalpur", tier: 2 },
  { code: "mp-satna", state: "MP", name: "Satna", tier: 3 },
  // Rajasthan
  { code: "rj-jaipur", state: "RJ", name: "Jaipur", tier: 2 },
  { code: "rj-jodhpur", state: "RJ", name: "Jodhpur", tier: 2 },
  { code: "rj-kota", state: "RJ", name: "Kota", tier: 2 },
  { code: "rj-sikar", state: "RJ", name: "Sikar", tier: 3 },
  // Maharashtra: Greater Mumbai and Pune are X.
  { code: "mh-mumbai", state: "MH", name: "Mumbai", tier: 1 },
  { code: "mh-pune", state: "MH", name: "Pune", tier: 1 },
  { code: "mh-nashik", state: "MH", name: "Nashik", tier: 2 },
  { code: "mh-nagpur", state: "MH", name: "Nagpur", tier: 2 },
  // Gujarat: Ahmadabad is X.
  { code: "gj-ahmedabad", state: "GJ", name: "Ahmedabad", tier: 1 },
  { code: "gj-surat", state: "GJ", name: "Surat", tier: 2 },
  { code: "gj-rajkot", state: "GJ", name: "Rajkot", tier: 2 },
  { code: "gj-mehsana", state: "GJ", name: "Mehsana", tier: 3 },
  // Tamil Nadu: Chennai is X.
  { code: "tn-chennai", state: "TN", name: "Chennai", tier: 1 },
  { code: "tn-coimbatore", state: "TN", name: "Coimbatore", tier: 2 },
  { code: "tn-madurai", state: "TN", name: "Madurai", tier: 2 },
  { code: "tn-karur", state: "TN", name: "Karur", tier: 3 },
  // Karnataka: Bengaluru is X; Mysore and Hubli-Dharwad are Y.
  { code: "ka-bengaluru", state: "KA", name: "Bengaluru", tier: 1 },
  { code: "ka-mysuru", state: "KA", name: "Mysuru", tier: 2 },
  { code: "ka-hubballi", state: "KA", name: "Hubballi", tier: 2 },
  { code: "ka-hassan", state: "KA", name: "Hassan", tier: 3 },
  // West Bengal: Kolkata is X; Asansol and Siliguri are Y.
  { code: "wb-kolkata", state: "WB", name: "Kolkata", tier: 1 },
  { code: "wb-siliguri", state: "WB", name: "Siliguri", tier: 2 },
  { code: "wb-asansol", state: "WB", name: "Asansol", tier: 2 },
  { code: "wb-bardhaman", state: "WB", name: "Bardhaman", tier: 3 },
];

const stateByCode = new Map<string, (typeof STATES)[number]>(STATES.map((s) => [s.code, s]));
const cityByCode = new Map<string, City>(CITIES.map((c) => [c.code, c]));

export function getState(code: string) {
  const state = stateByCode.get(code);
  if (!state) throw new Error(`Unknown state code: ${code}`);
  return state;
}

export function getCity(code: string): City {
  const city = cityByCode.get(code);
  if (!city) throw new Error(`Unknown city code: ${code}`);
  return city;
}
