import { z } from "zod";
import { searchName } from "@/lib/matching";
import { cachedSearch, requestJson, searchResultSchema, type CachedSearchContext } from "@/lib/search/request";
import { linkedInCompanyQuery, linkedInPeopleQuery } from "@/lib/search/serper";
import type { PlaceResult, SearchCache, SearchProvider, SearchResult, SearchUsage } from "@/lib/search/types";

const CSE_URL = "https://www.googleapis.com/customsearch/v1";

const cseSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().optional(),
        link: z.string().optional(),
        snippet: z.string().optional(),
      }),
    )
    .optional(),
});

export interface GoogleCseProviderOptions {
  apiKey: string;
  cx: string;
  cache: SearchCache | null;
  usage: SearchUsage;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

let warnedAboutPlaces = false;

/** Google Custom Search JSON API: Facebook and LinkedIn searches; no Google Business (spec 6.2). */
export function createGoogleCseProvider(options: GoogleCseProviderOptions): SearchProvider {
  const ctx: CachedSearchContext = { provider: "google_cse", cache: options.cache, usage: options.usage };

  async function organic(type: "facebook" | "linkedin_company" | "linkedin_person", q: string): Promise<SearchResult[]> {
    return cachedSearch(ctx, type, q, z.array(searchResultSchema), async () => {
      const params = new URLSearchParams({ key: options.apiKey, cx: options.cx, q, gl: "uk", num: "10" });
      const data = cseSchema.parse(
        await requestJson(`${CSE_URL}?${params.toString()}`, { method: "GET" }, {
          label: "google-cse",
          authErrorMessage: "Google Custom Search API key or engine ID is missing or invalid",
          fetchImpl: options.fetchImpl,
          sleep: options.sleep,
        }),
      );
      return (data.items ?? []).flatMap((r) =>
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

  async function searchBusinessProfile(): Promise<PlaceResult[]> {
    if (!warnedAboutPlaces) {
      warnedAboutPlaces = true;
      console.warn("[google-cse] Google Business Profile search needs SEARCH_PROVIDER=serper; returning no results");
    }
    return [];
  }

  return { name: "google_cse", searchFacebook, searchBusinessProfile, searchLinkedInCompany, searchLinkedInPeople };
}
