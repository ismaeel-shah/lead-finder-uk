import { getCompaniesHouseClient } from "@/lib/companiesHouse";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/env";
import type { ProcessDepsFactory } from "@/lib/jobs";
import { getSearchProvider, PrismaSearchCache } from "@/lib/search";

/** Wires the real Companies House client, search provider and DB cache together. */
export const makeProcessDeps: ProcessDepsFactory = async (usage) => {
  const config = getConfig();
  return {
    companiesHouse: getCompaniesHouseClient(),
    search: await getSearchProvider({ cache: new PrismaSearchCache(prisma), usage, prisma }),
    matchThreshold: config.MATCH_THRESHOLD,
    maxOwnerCompanies: config.MAX_OWNER_COMPANIES,
    linkedin: config.LINKEDIN_SEARCH,
    facebookLocationCheck: config.FACEBOOK_LOCATION_CHECK,
  };
};

export function batchSize(): number {
  return getConfig().BATCH_SIZE;
}
