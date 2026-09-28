import { z } from "zod";
import { fetchWithRetry, HttpError } from "@/lib/http";
import type { PlaceResult, SearchCache, SearchResult, SearchType, SearchUsage } from "@/lib/search/types";
import { OUT_OF_CREDITS_MESSAGE, SearchError } from "@/lib/search/types";

export const SEARCH_TIMEOUT_MS = 15_000;
export const SEARCH_MAX_RETRIES = 3;

export const searchResultSchema: z.ZodType<SearchResult> = z.object({
  title: z.string(),
  link: z.string(),
  snippet: z.string().nullable(),
});

export const placeResultSchema: z.ZodType<PlaceResult> = z.object({
  title: z.string(),
  address: z.string().nullable(),
  cid: z.string().nullable(),
  mapsUrl: z.string().nullable(),
  website: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  rating: z.number().nullable(),
});

export interface CachedSearchContext {
  provider: string;
  cache: SearchCache | null;
  usage: SearchUsage;
}

/**
 * Empty results are only trusted for a day. Serper Places was seen returning
 * an empty list for a query that returns a listing moments later; caching
 * that for 30 days would hide the business on every re-run.
 */
export const EMPTY_RESULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Returns the cached result for (provider, type, query) or runs `load`,
 * counts one credit and caches what it returns. Cached entries that no
 * longer match the schema, and empty results older than a day, are misses.
 */
export async function cachedSearch<T>(
  ctx: CachedSearchContext,
  type: SearchType,
  query: string,
  schema: z.ZodType<T>,
  load: () => Promise<T>,
): Promise<T> {
  if (ctx.cache) {
    const hit = await ctx.cache.get(ctx.provider, type, query).catch((err: unknown) => {
      console.warn(`[search-cache] read failed: ${(err as Error).message}`);
      return null;
    });
    if (hit !== null) {
      const parsed = schema.safeParse(hit.response);
      const isEmpty = Array.isArray(parsed.data) && parsed.data.length === 0;
      const expiredEmpty = isEmpty && Date.now() - hit.createdAt.getTime() > EMPTY_RESULT_TTL_MS;
      if (parsed.success && !expiredEmpty) return parsed.data;
    }
  }

  const result = await load();
  ctx.usage.credits += 1;
  if (ctx.cache) await ctx.cache.set(ctx.provider, type, query, result);
  return result;
}

export interface JsonRequestOptions {
  label: string;
  /** Message used when the provider rejects the key (401/403). */
  authErrorMessage: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Sends a request with timeout + retry and returns the parsed JSON body. */
export async function requestJson(url: string, init: RequestInit, options: JsonRequestOptions): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchWithRetry(url, init, {
      label: options.label,
      maxRetries: SEARCH_MAX_RETRIES,
      timeoutMs: SEARCH_TIMEOUT_MS,
      fetchImpl: options.fetchImpl,
      sleep: options.sleep,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      throw new SearchError(`${options.label} request failed (${err.status})${detail(err.body)}`, err.status);
    }
    throw new SearchError(`${options.label} request failed: ${(err as Error).message}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new SearchError(options.authErrorMessage, response.status);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // Serper answers 400 {"message":"Not enough credits"} (seen live); treat any
    // "credits" / "quota" refusal as the account being empty.
    if ((response.status === 400 || response.status === 402 || response.status === 403) && /not enough credits|out of credits|quota/i.test(body)) {
      throw new SearchError(OUT_OF_CREDITS_MESSAGE, 402);
    }
    throw new SearchError(`${options.label} returned ${response.status}${detail(body)}`, response.status);
  }
  return response.json();
}

function detail(body: string | undefined): string {
  return body ? `: ${body.slice(0, 200)}` : "";
}
