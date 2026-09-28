import type { Prisma, PrismaClient } from "@prisma/client";
import type { CachedEntry, SearchCache, SearchType } from "@/lib/search/types";

export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** SearchCache table, keyed by (provider, type, query); entries expire after 30 days. */
export class PrismaSearchCache implements SearchCache {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ttlMs = CACHE_TTL_MS,
  ) {}

  async get(provider: string, type: SearchType, query: string): Promise<CachedEntry | null> {
    const row = await this.prisma.searchCache.findUnique({
      where: { provider_type_query: { provider, type, query } },
    });
    if (!row || Date.now() - row.createdAt.getTime() > this.ttlMs) return null;
    return { response: row.response, createdAt: row.createdAt };
  }

  async set(provider: string, type: SearchType, query: string, response: unknown): Promise<void> {
    const json = response as Prisma.InputJsonValue;
    try {
      await this.prisma.searchCache.upsert({
        where: { provider_type_query: { provider, type, query } },
        create: { provider, type, query, response: json },
        // Refresh createdAt so an expired entry gets a new 30-day lifetime.
        update: { response: json, createdAt: new Date() },
      });
    } catch (err) {
      // Two batches writing the same key at once can race on the unique
      // index; the other write wins and the result is the same.
      console.warn(`[search-cache] write failed for ${type} "${query}": ${(err as Error).message}`);
    }
  }
}

/** In-process cache for tests and scripts run without a database. */
export class MemorySearchCache implements SearchCache {
  private readonly entries = new Map<string, { response: unknown; createdAt: number }>();

  constructor(private readonly ttlMs = CACHE_TTL_MS) {}

  async get(provider: string, type: SearchType, query: string): Promise<CachedEntry | null> {
    const entry = this.entries.get(key(provider, type, query));
    if (!entry || Date.now() - entry.createdAt > this.ttlMs) return null;
    return { response: entry.response, createdAt: new Date(entry.createdAt) };
  }

  async set(provider: string, type: SearchType, query: string, response: unknown): Promise<void> {
    this.entries.set(key(provider, type, query), { response, createdAt: Date.now() });
  }

  get size(): number {
    return this.entries.size;
  }
}

const key = (provider: string, type: string, query: string) => JSON.stringify([provider, type, query]);
