import { z } from "zod";
import { isUkBusinessAddress } from "@/lib/location";
import { searchName } from "@/lib/matching";
import {
  cachedSearch,
  placeResultSchema,
  requestJson,
  searchResultSchema,
  type CachedSearchContext,
} from "@/lib/search/request";
import { StaticKeyPool, type KeyPool } from "@/lib/search/keys";
import { OUT_OF_CREDITS_MESSAGE, SearchError, type PlaceResult, type SearchCache, type SearchProvider, type SearchResult, type SearchUsage } from "@/lib/search/types";

const SERPER_URL = "https://google.serper.dev";

/**
 * Without an explicit location, Serper searches near its own servers (seen:
 * Virginia, USA): Places then returns US businesses for UK names, and UK-only
 * businesses can be missing entirely. `gl: "uk"` alone does not prevent this.
 */
export const SERPER_LOCATION = "United Kingdom";
const GEO = { gl: "uk", location: SERPER_LOCATION } as const;

/** Cache key for a query. Includes the location so results fetched without it are not reused. */
const cacheKey = (q: string) => `${q} @${SERPER_LOCATION}`;

const organicSchema = z.object({
  organic: z
    .array(
      z.object({
        title: z.string().optional(),
        link: z.string().optional(),
        snippet: z.string().optional(),
      }),
    )
    .optional(),
  knowledgeGraph: z
    .object({
      title: z.string().optional(),
      website: z.string().optional(),
      cid: z.string().optional(),
      address: z.string().optional(),
      phoneNumber: z.string().optional(),
      rating: z.number().optional(),
      attributes: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

const placesSchema = z.object({
  places: z
    .array(
      z.object({
        title: z.string().optional(),
        address: z.string().optional(),
        cid: z.union([z.string(), z.number()]).optional(),
        website: z.string().optional(),
        phoneNumber: z.string().optional(),
        rating: z.number().optional(),
      }),
    )
    .optional(),
});

export interface SerperProviderOptions {
  /** Keys tried in order; when one runs out of credits the next takes over. */
  keys?: KeyPool;
  /** A single key (shorthand for a one-key pool). */
  apiKey?: string;
  cache: SearchCache | null;
  usage: SearchUsage;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** `site:linkedin.com/company "Acme Plumbing"` */
export function linkedInCompanyQuery(companyName: string): string {
  return `site:linkedin.com/company "${searchName(companyName)}"`;
}

/**
 * `site:linkedin.com/in "Thomas Milward" Precision Plumbing SW`: the person's
 * name is exact; the company is unquoted context, because a new company's
 * name often isn't on the profile yet (matching checks the tie afterwards).
 */
export function linkedInPeopleQuery(personName: string, companyName: string): string {
  return `site:linkedin.com/in "${personName}" ${searchName(companyName)}`.trim();
}

export function mapsUrlForCid(cid: string): string {
  return `https://www.google.com/maps?cid=${encodeURIComponent(cid)}`;
}

/** True for Google Maps listing links found in organic results. */
export function isGoogleMapsLink(link: string): boolean {
  try {
    const url = new URL(link);
    const host = url.hostname.toLowerCase();
    if (host === "maps.app.goo.gl") return true;
    if (/^maps\.google\.[a-z.]+$/.test(host)) return true;
    return /^(www\.)?google\.[a-z.]+$/.test(host) && url.pathname.startsWith("/maps");
  } catch {
    return false;
  }
}

export function createSerperProvider(options: SerperProviderOptions): SearchProvider {
  const ctx: CachedSearchContext = { provider: "serper", cache: options.cache, usage: options.usage };

  const pool: KeyPool = options.keys ?? new StaticKeyPool(options.apiKey ? [options.apiKey] : []);

  /**
   * Sends one request with the first usable key. A key that is out of
   * credits or rejected is marked as such and the request is repeated with
   * the next one; only when no key is left does the error reach the caller
   * (which pauses the run).
   */
  async function post(endpoint: "search" | "places", body: Record<string, unknown>): Promise<unknown> {
    for (;;) {
      const key = await pool.acquire();
      if (!key) throw new SearchError(OUT_OF_CREDITS_MESSAGE, 402);
      try {
        const result = await requestJson(
          `${SERPER_URL}/${endpoint}`,
          {
            method: "POST",
            headers: { "X-API-KEY": key.key, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
          {
            label: "serper",
            authErrorMessage: "Serper API key is missing or invalid",
            fetchImpl: options.fetchImpl,
            sleep: options.sleep,
          },
        );
        await pool.reportSuccess(key.id);
        return result;
      } catch (err) {
        if (err instanceof SearchError && err.status === 402) {
          await pool.reportExhausted(key.id, "Out of credits");
          continue;
        }
        if (err instanceof SearchError && (err.status === 401 || err.status === 403)) {
          await pool.reportInvalid(key.id, "Rejected by Serper (invalid or revoked key)");
          continue;
        }
        throw err;
      }
    }
  }

  /** A cached organic search returning title / link / snippet rows. */
  async function organic(type: "facebook" | "linkedin_company" | "linkedin_person", q: string): Promise<SearchResult[]> {
    return cachedSearch(ctx, type, cacheKey(q), z.array(searchResultSchema), async () => {
      const data = organicSchema.parse(await post("search", { q, ...GEO, num: 10 }));
      return (data.organic ?? []).flatMap((r) =>
        r.title && r.link ? [{ title: r.title, link: r.link, snippet: r.snippet ?? null }] : [],
      );
    });
  }

  async function searchFacebook(companyName: string): Promise<SearchResult[]> {
    return organic("facebook", `site:facebook.com "${searchName(companyName)}"`);
  }

  async function searchLinkedInCompany(companyName: string): Promise<SearchResult[]> {
    return organic("linkedin_company", linkedInCompanyQuery(companyName));
  }

  async function searchLinkedInPeople(personName: string, companyName: string): Promise<SearchResult[]> {
    return organic("linkedin_person", linkedInPeopleQuery(personName, companyName));
  }

  async function searchBusinessProfile(companyName: string): Promise<PlaceResult[]> {
    const name = searchName(companyName);
    const cached = await cachedSearch(ctx, "places", cacheKey(name), z.array(placeResultSchema), async () => {
      const data = placesSchema.parse(await post("places", { q: name, ...GEO }));
      return (data.places ?? []).flatMap((p): PlaceResult[] => {
        if (!p.title) return [];
        const cid = p.cid === undefined ? null : String(p.cid);
        return [
          {
            title: p.title,
            address: p.address ?? null,
            cid,
            mapsUrl: cid ? mapsUrlForCid(cid) : null,
            website: p.website ?? null,
            phoneNumber: p.phoneNumber ?? null,
            rating: p.rating ?? null,
          },
        ];
      });
    });
    // Second line of defence: drop anything whose address is clearly not in the UK.
    const places = cached.filter((p) => isUkBusinessAddress(p.address));
    if (places.length > 0) return places;

    // Fallback: one organic search, accepting Maps links or a local-business knowledge graph.
    const q = `"${name}" UK`;
    const fallback = await cachedSearch(ctx, "organic", cacheKey(q), z.array(placeResultSchema), async () => {
      const data = organicSchema.parse(await post("search", { q, ...GEO, num: 10 }));
      return placesFromOrganic(data);
    });
    return fallback.filter((p) => isUkBusinessAddress(p.address));
  }

  return { name: "serper", searchFacebook, searchBusinessProfile, searchLinkedInCompany, searchLinkedInPeople };
}

function placesFromOrganic(data: z.infer<typeof organicSchema>): PlaceResult[] {
  const out: PlaceResult[] = [];

  const kg = data.knowledgeGraph;
  const kgAddress = kg?.address ?? kg?.attributes?.["Address"] ?? null;
  const kgPhone = kg?.phoneNumber ?? kg?.attributes?.["Phone"] ?? null;
  // Only a knowledge graph with an address or phone is a local business
  // (others are e.g. people or brands).
  if (kg?.title && (kgAddress || kgPhone || kg.cid)) {
    out.push({
      title: kg.title,
      address: kgAddress,
      cid: kg.cid ?? null,
      mapsUrl: kg.cid
        ? mapsUrlForCid(kg.cid)
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([kg.title, kgAddress].filter(Boolean).join(" "))}`,
      website: kg.website ?? null,
      phoneNumber: kgPhone,
      rating: kg.rating ?? null,
    });
  }

  for (const r of data.organic ?? []) {
    if (r.title && r.link && isGoogleMapsLink(r.link)) {
      out.push({
        title: r.title.replace(/\s*[-·|]\s*Google Maps\s*$/i, ""),
        address: r.snippet ?? null,
        cid: null,
        mapsUrl: r.link,
        website: null,
        phoneNumber: null,
        rating: null,
      });
    }
  }
  return out;
}
