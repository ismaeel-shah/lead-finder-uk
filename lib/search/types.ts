export interface SearchResult {
  title: string;
  link: string;
  snippet: string | null;
}

export interface PlaceResult {
  title: string;
  address: string | null;
  cid: string | null;
  /** Google Maps link for the listing (built from cid when present). */
  mapsUrl: string | null;
  website: string | null;
  phoneNumber: string | null;
  rating: number | null;
}

export interface SearchProvider {
  readonly name: string;
  /** Organic results for a Facebook site search on the company name. */
  searchFacebook(companyName: string): Promise<SearchResult[]>;
  /** Google Business Profile candidates for the company name. */
  searchBusinessProfile(companyName: string): Promise<PlaceResult[]>;
  /** Organic results for LinkedIn company pages matching the company name. */
  searchLinkedInCompany(companyName: string): Promise<SearchResult[]>;
  /** Organic results for LinkedIn profiles of a person, with a company name as context. */
  searchLinkedInPeople(personName: string, companyName: string): Promise<SearchResult[]>;
}

export type SearchType = "facebook" | "places" | "organic" | "linkedin_company" | "linkedin_person";

export interface CachedEntry {
  response: unknown;
  createdAt: Date;
}

/** Stores parsed provider responses so re-runs do not spend credits. */
export interface SearchCache {
  /** The entry if present and younger than the cache TTL, else null. */
  get(provider: string, type: SearchType, query: string): Promise<CachedEntry | null>;
  set(provider: string, type: SearchType, query: string, response: unknown): Promise<void>;
}

/** Mutable counter of paid requests made (cache hits are free). */
export interface SearchUsage {
  credits: number;
}

/** Shown when the provider has no credits left; processing pauses on it. */
export const OUT_OF_CREDITS_MESSAGE =
  "No search API key can be used right now: every key is out of credits or was rejected. Top up at serper.dev or add a key under Search API keys, then resume the run.";

export class SearchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SearchError";
  }
}
