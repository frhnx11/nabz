import type { SurveyDefinition } from "../surveys/schema";

export type DealerGeo = { state: string; region: string; cityTier: number };

/** A dealer's value for each of the survey's dimensions (missing attributes are left out). */
export function dealerDims(
  definition: Pick<SurveyDefinition, "dimensions">,
  attributes: Readonly<Record<string, string>>,
  geo: DealerGeo,
): Record<string, string> {
  const dims: Record<string, string> = {};
  for (const d of definition.dimensions) {
    let value: string | undefined;
    if (d.source.kind === "attribute") value = attributes[d.source.attribute];
    else if (d.source.field === "state") value = geo.state;
    else if (d.source.field === "region") value = geo.region;
    else value = String(geo.cityTier);
    if (value !== undefined) dims[d.key] = value;
  }
  return dims;
}
