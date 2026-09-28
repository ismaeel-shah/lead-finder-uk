/**
 * Runs the Facebook and Google Business searches for one company name and
 * prints every candidate with its score and the one that would be chosen.
 *
 *   npm run test:search -- "Acme Plumbing Ltd"
 *   npm run test:search -- "Acme Plumbing Ltd" --no-cache
 *
 * Uses the database SearchCache when it is reachable, otherwise an in-memory
 * cache (so every run costs credits).
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { getConfigStatus } = await import("../lib/env");
  const { pickBestFacebookResult, pickBestPlace, scoreFacebookResult, scorePlace, searchName } = await import("../lib/matching");
  const { getSearchProvider, MemorySearchCache, PrismaSearchCache } = await import("../lib/search");
  type SearchCache = import("../lib/search").SearchCache;

  const args = process.argv.slice(2);
  const noCache = args.includes("--no-cache");
  const companyName = args.filter((a) => !a.startsWith("--")).join(" ").trim();
  if (!companyName) throw new Error('Usage: npm run test:search -- "Company Name"');

  const threshold = getConfigStatus().config?.MATCH_THRESHOLD ?? 0.85;
  // Use the database (search cache + keys from Settings) when it is reachable.
  const { PrismaClient } = await import("@prisma/client");
  let prisma: InstanceType<typeof PrismaClient> | undefined = new PrismaClient({ log: [] });
  try {
    await prisma.searchApiKey.count();
  } catch {
    await prisma.$disconnect().catch(() => undefined);
    prisma = undefined;
  }
  const disconnect = async () => {
    await prisma?.$disconnect();
  };

  let cache: SearchCache | null = null;
  let cacheLabel = "none (--no-cache)";
  if (!noCache) {
    cache = prisma ? new PrismaSearchCache(prisma) : new MemorySearchCache();
    cacheLabel = prisma ? "database" : "in-memory (database not reachable or not migrated)";
  }

  const usage = { credits: 0 };
  const provider = await getSearchProvider({ cache, usage, prisma });
  const opts = { threshold };

  console.log(`Company:   ${companyName}`);
  console.log(`Query:     "${searchName(companyName)}"`);
  console.log(`Provider:  ${provider.name}   Cache: ${cacheLabel}   Threshold: ${threshold}\n`);

  try {
    const fbResults = await provider.searchFacebook(companyName);
    console.log(`Facebook results (${fbResults.length}):`);
    console.table(
      fbResults.map((r) => {
        const scored = scoreFacebookResult(companyName, r, opts);
        return { score: scored ? scored.score.toFixed(3) : "rejected URL", title: r.title, url: scored?.url ?? r.link };
      }),
    );
    const fb = pickBestFacebookResult(companyName, fbResults, opts);
    console.log(fb ? `-> Facebook: ${fb.url} (score ${fb.score.toFixed(3)})\n` : "-> Facebook: no match\n");

    const places = await provider.searchBusinessProfile(companyName);
    console.log(`Google Business results (${places.length}):`);
    console.table(
      places.map((p) => ({ score: scorePlace(companyName, p, opts).toFixed(3), title: p.title, address: p.address ?? "", maps: p.mapsUrl ?? "" })),
    );
    const gmb = pickBestPlace(companyName, places, opts);
    console.log(
      gmb
        ? `-> Google Business: ${gmb.candidate.title} ${gmb.candidate.mapsUrl ?? ""} (score ${gmb.score.toFixed(3)})` +
            `\n   phone: ${gmb.candidate.phoneNumber ?? "-"}  website: ${gmb.candidate.website ?? "-"}`
        : "-> Google Business: no match",
    );

    console.log(`\nSearch credits used: ${usage.credits}`);
  } finally {
    await disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
