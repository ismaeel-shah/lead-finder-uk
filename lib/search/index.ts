import type { PrismaClient } from "@prisma/client";
import { getConfigStatus } from "@/lib/env";
import { createGoogleCseProvider } from "@/lib/search/googleCse";
import { PrismaKeyPool, StaticKeyPool, type KeyPool } from "@/lib/search/keys";
import { createSerperProvider } from "@/lib/search/serper";
import { OUT_OF_CREDITS_MESSAGE, SearchError, type SearchCache, type SearchProvider, type SearchUsage } from "@/lib/search/types";

export * from "@/lib/search/types";
export { MemorySearchCache, PrismaSearchCache } from "@/lib/search/cache";

export const NO_SEARCH_KEY_MESSAGE = "No search API key is set up. Add a Serper key under Search API keys in the sidebar.";

export interface SearchProviderFactoryOptions {
  cache: SearchCache | null;
  usage: SearchUsage;
  /** When given, Serper keys come from the database (Settings) plus SERPER_API_KEY. */
  prisma?: PrismaClient;
}

/**
 * Builds the provider chosen by SEARCH_PROVIDER. For Serper it fails fast:
 * no key at all -> NO_SEARCH_KEY_MESSAGE; keys but none with credits ->
 * OUT_OF_CREDITS_MESSAGE (the run pauses on that).
 */
export async function getSearchProvider({ cache, usage, prisma }: SearchProviderFactoryOptions): Promise<SearchProvider> {
  const config = getConfigStatus().config;
  const provider = config?.SEARCH_PROVIDER ?? "serper";

  if (provider === "google_cse") {
    if (!config?.GOOGLE_CSE_API_KEY || !config.GOOGLE_CSE_ID) {
      throw new SearchError("GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID are required when SEARCH_PROVIDER=google_cse");
    }
    return createGoogleCseProvider({ apiKey: config.GOOGLE_CSE_API_KEY, cx: config.GOOGLE_CSE_ID, cache, usage });
  }

  let keys: KeyPool;
  if (prisma) {
    const pool = new PrismaKeyPool(prisma, { envKey: config?.SERPER_API_KEY });
    if (!(await pool.hasKeys())) throw new SearchError(NO_SEARCH_KEY_MESSAGE);
    if (!(await pool.acquire())) throw new SearchError(OUT_OF_CREDITS_MESSAGE, 402);
    keys = pool;
  } else {
    if (!config?.SERPER_API_KEY) throw new SearchError(NO_SEARCH_KEY_MESSAGE);
    keys = new StaticKeyPool([config.SERPER_API_KEY]);
  }
  return createSerperProvider({ keys, cache, usage });
}
