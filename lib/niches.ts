/**
 * Business niches for the New run filter. Each maps to UK SIC 2007 codes,
 * which is how Companies House records what a company does; a run with a
 * niche fetches companies registered under any of its codes.
 */

export interface Niche {
  id: string;
  label: string;
  group: string;
  sic: readonly string[];
}

export const NICHES: readonly Niche[] = [
  // Trades & construction
  { id: "plumbing-electrical", label: "Plumbing, heating & electrical", group: "Trades & construction", sic: ["43220", "43210"] },
  { id: "builders", label: "Builders & construction", group: "Trades & construction", sic: ["41201", "41202", "43999", "43110", "43120"] },
  { id: "roofing", label: "Roofing", group: "Trades & construction", sic: ["43910"] },
  { id: "finishing-trades", label: "Decorating, plastering, joinery & flooring", group: "Trades & construction", sic: ["43310", "43320", "43330", "43341", "43342", "43390"] },
  { id: "cleaning", label: "Cleaning services", group: "Trades & construction", sic: ["81210", "81221", "81222", "81223", "81229", "81299"] },
  { id: "landscaping", label: "Gardening & landscaping", group: "Trades & construction", sic: ["81300"] },
  { id: "architecture-engineering", label: "Architects & engineers", group: "Trades & construction", sic: ["71111", "71112", "71121", "71122", "71129"] },

  // Food & hospitality
  { id: "restaurants", label: "Restaurants, cafés & takeaways", group: "Food & hospitality", sic: ["56101", "56102", "56103"] },
  { id: "pubs-bars", label: "Pubs, bars & clubs", group: "Food & hospitality", sic: ["56301", "56302"] },
  { id: "catering", label: "Catering & events food", group: "Food & hospitality", sic: ["56210", "56290"] },
  { id: "hotels", label: "Hotels & accommodation", group: "Food & hospitality", sic: ["55100", "55201", "55209", "55900"] },

  // Health, beauty & care
  { id: "hair-beauty", label: "Hair & beauty salons", group: "Health, beauty & care", sic: ["96020", "96040"] },
  { id: "fitness", label: "Gyms, fitness & sport", group: "Health, beauty & care", sic: ["93130", "93110", "93199", "85510"] },
  { id: "healthcare", label: "Clinics, dentists & healthcare", group: "Health, beauty & care", sic: ["86210", "86220", "86230", "86900"] },
  { id: "care", label: "Care homes & home care", group: "Health, beauty & care", sic: ["87100", "87300", "87900", "88100"] },
  { id: "childcare", label: "Childcare & nurseries", group: "Health, beauty & care", sic: ["88910"] },

  // Professional services
  { id: "it-software", label: "IT & software", group: "Professional services", sic: ["62012", "62020", "62090", "63110", "63120"] },
  { id: "marketing-design", label: "Marketing, design & media", group: "Professional services", sic: ["73110", "73120", "74100", "74201", "74202", "59111", "70210"] },
  { id: "consulting", label: "Consulting & business support", group: "Professional services", sic: ["70229", "82990", "74909"] },
  { id: "accounting-finance", label: "Accountants, finance & insurance", group: "Professional services", sic: ["69201", "69202", "69203", "64999", "66190", "66220"] },
  { id: "legal", label: "Legal services", group: "Professional services", sic: ["69101", "69102", "69109"] },
  { id: "recruitment", label: "Recruitment & staffing", group: "Professional services", sic: ["78109", "78200", "78300"] },
  { id: "education", label: "Training & tutoring", group: "Professional services", sic: ["85590", "85600", "85520"] },
  { id: "security", label: "Security services", group: "Professional services", sic: ["80100", "80200"] },

  // Property & motors
  { id: "property", label: "Property, lettings & estate agents", group: "Property, motors & transport", sic: ["68100", "68209", "68310", "68320", "41100"] },
  { id: "motors", label: "Car sales, garages & repairs", group: "Property, motors & transport", sic: ["45111", "45112", "45200", "45320"] },
  { id: "transport", label: "Transport, taxis & delivery", group: "Property, motors & transport", sic: ["49410", "49320", "49390", "53201", "53202", "52290"] },
  { id: "removals", label: "Removals", group: "Property, motors & transport", sic: ["49420"] },
  { id: "travel", label: "Travel agents & tours", group: "Property, motors & transport", sic: ["79110", "79120", "79909"] },

  // Retail & trade
  { id: "ecommerce", label: "Online shops & e-commerce", group: "Retail & trade", sic: ["47910"] },
  { id: "retail", label: "Shops & retail", group: "Retail & trade", sic: ["47110", "47190", "47290", "47710", "47750", "47770"] },
  { id: "wholesale", label: "Wholesale & import/export", group: "Retail & trade", sic: ["46900", "46190", "46390", "46420"] },
  { id: "events-entertainment", label: "Events & entertainment", group: "Retail & trade", sic: ["82301", "82302", "90010", "90020", "93290"] },
];

export const NICHE_IDS = NICHES.map((n) => n.id) as [string, ...string[]];

export function nicheById(id: string | null | undefined): Niche | undefined {
  return id ? NICHES.find((n) => n.id === id) : undefined;
}

/** Niche groups in display order, for <optgroup>s. */
export function nicheGroups(): { group: string; niches: Niche[] }[] {
  const groups: { group: string; niches: Niche[] }[] = [];
  for (const n of NICHES) {
    const g = groups.find((x) => x.group === n.group);
    if (g) g.niches.push(n);
    else groups.push({ group: n.group, niches: [n] });
  }
  return groups;
}

/** The niche's SIC codes plus any typed by hand, de-duplicated, as "a,b,c" (or undefined if none). */
export function combinedSicCodes(nicheId: string | null | undefined, manual: string | null | undefined): string | undefined {
  const codes = new Set([...(nicheById(nicheId)?.sic ?? []), ...(manual ?? "").split(/[\s,]+/).filter(Boolean)]);
  return codes.size ? [...codes].join(",") : undefined;
}
