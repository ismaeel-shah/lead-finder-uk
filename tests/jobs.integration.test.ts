/**
 * Integration tests for the job lifecycle against a real Postgres database.
 * Skipped unless TEST_DATABASE_URL is set, e.g.
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/leadfinder_test
 *   DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
 *   npm test
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanySearchFilters, CompanySearchPage, CompanySummary } from "@/lib/companiesHouse";
import {
  claimRows,
  createJob,
  deleteJob,
  listResults,
  pauseJob,
  processBatch,
  resetStaleClaims,
  resultsQuerySchema,
  resumeJob,
  retryErrors,
  runFetchStep,
  type ProcessDepsFactory,
} from "@/lib/jobs";
import { OUT_OF_CREDITS_MESSAGE, SearchError, type SearchProvider } from "@/lib/search/types";

const url = process.env.TEST_DATABASE_URL;
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : (null as unknown as PrismaClient);

const summary = (n: number, date: string): CompanySummary => ({
  companyNumber: `T${String(n).padStart(7, "0")}`,
  companyName: `TEST COMPANY ${n} LTD`,
  dateOfCreation: date,
  companyType: "ltd",
  companyStatus: "active",
  registeredOfficeAddress: { locality: "Leeds", postal_code: "LS1 1AA" },
  sicCodes: ["43220"],
});

/** Fake Companies House: `perDay` companies per day, served `pageSize` at a time. */
function fakeCh(perDay: Record<string, number>, pageSize = 2, delayMs = 0) {
  const calls: string[] = [];
  let n = 0;
  const byDay = new Map<string, CompanySummary[]>();
  for (const [day, count] of Object.entries(perDay)) {
    byDay.set(day, Array.from({ length: count }, () => summary(++n, day)));
  }
  return {
    calls,
    searchNewCompaniesPage: vi.fn(async (f: CompanySearchFilters, startIndex = 0): Promise<CompanySearchPage> => {
      calls.push(`${f.incorporatedFrom}@${startIndex}`);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const all = byDay.get(f.incorporatedFrom) ?? [];
      const items = all.slice(startIndex, startIndex + pageSize);
      const next = startIndex + items.length;
      return { items, hits: all.length, nextStartIndex: next < all.length ? next : null, truncated: false };
    }),
  };
}

/** Deps where companies whose name includes "FOUND" match on Facebook and "BOOM" throws. */
const makeDeps: ProcessDepsFactory = (usage) => {
  const search: SearchProvider = {
    name: "fake",
    async searchFacebook(name) {
      usage.credits++;
      if (name.includes("BOOM")) throw new Error("search exploded");
      if (name.includes("BROKE")) throw new SearchError(OUT_OF_CREDITS_MESSAGE, 402);
      return name.includes("FOUND")
        ? [{ title: `${name.replace(/ LTD$/, "")} | Facebook`, link: "https://www.facebook.com/found", snippet: null }]
        : [];
    },
    async searchBusinessProfile() {
      usage.credits++;
      return [];
    },
    async searchLinkedInCompany() {
      return [];
    },
    async searchLinkedInPeople() {
      return [];
    },
  };
  return {
    search,
    companiesHouse: { getOfficers: async () => [], getOfficerAppointments: async () => [] },
    matchThreshold: 0.85,
    maxOwnerCompanies: 10,
  };
};

async function jobWithRows(names: string[]) {
  const job = await createJob(prisma, {
    incorporatedFrom: "2026-09-01",
    incorporatedTo: "2026-09-01",
    companyType: "ltd",
    companyStatus: "active",
  });
  await prisma.companyResult.createMany({
    data: names.map((companyName, i) => ({
      jobId: job.id,
      companyNumber: `R${i}`,
      companyName,
      incorporationDate: new Date("2026-09-01T00:00:00Z"),
      sicCodes: [],
    })),
  });
  await prisma.job.update({ where: { id: job.id }, data: { status: "READY", totalCompanies: names.length, fetchCursor: undefined } });
  return job;
}

describe.skipIf(!url)("jobs (Postgres)", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  beforeEach(async () => {
    await prisma.job.deleteMany();
  });
  afterAll(async () => {
    await prisma.job.deleteMany();
    await prisma.$disconnect();
  });

  describe("runFetchStep", () => {
    it("passes the niche's SIC codes, extra codes and the name keyword to Companies House", async () => {
      const ch = fakeCh({ "2026-09-01": 1 });
      const job = await createJob(prisma, {
        incorporatedFrom: "2026-09-01",
        incorporatedTo: "2026-09-01",
        companyType: "ltd",
        companyStatus: "active",
        niche: "plumbing-electrical",
        sicCodes: "43999",
        nameIncludes: "gas",
      });
      await runFetchStep(prisma, ch, job.id);
      expect(ch.searchNewCompaniesPage.mock.calls[0]![0]).toMatchObject({ sicCodes: "43220,43210,43999", nameIncludes: "gas" });
      expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).filters).toMatchObject({
        niche: "plumbing-electrical",
        sic_codes: "43999",
        name_includes: "gas",
      });
    });

    it("fetches every day and page, dedupes, and marks the job READY", async () => {
      const ch = fakeCh({ "2026-09-01": 5, "2026-09-02": 0, "2026-09-03": 3 });
      const job = await createJob(prisma, {
        incorporatedFrom: "2026-09-01",
        incorporatedTo: "2026-09-03",
        companyType: "ltd",
        companyStatus: "active",
      });
      const result = await runFetchStep(prisma, ch, job.id);

      expect(result).toEqual({ done: true, totalCompanies: 8, nextDate: null });
      expect(ch.calls).toEqual(["2026-09-01@0", "2026-09-01@2", "2026-09-01@4", "2026-09-02@0", "2026-09-03@0", "2026-09-03@2"]);
      const saved = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(saved.status).toBe("READY");
      expect(saved.fetchCursor).toBeNull();

      // Running it again does nothing.
      expect((await runFetchStep(prisma, ch, job.id)).done).toBe(true);
      expect(ch.calls).toHaveLength(6);
    });

    it("stops at the time budget and continues from the saved cursor", async () => {
      const ch = fakeCh({ "2026-09-01": 6, "2026-09-02": 2 }, 2, 30);
      const job = await createJob(prisma, {
        incorporatedFrom: "2026-09-01",
        incorporatedTo: "2026-09-02",
        companyType: "ltd",
        companyStatus: "active",
      });
      const first = await runFetchStep(prisma, ch, job.id, 40);
      expect(first.done).toBe(false);
      expect(first.totalCompanies).toBeGreaterThan(0);

      let result = first;
      for (let i = 0; i < 10 && !result.done; i++) result = await runFetchStep(prisma, ch, job.id, 40);
      expect(result).toMatchObject({ done: true, totalCompanies: 8 });
      // No page was fetched twice.
      expect(new Set(ch.calls).size).toBe(ch.calls.length);
    });

    it("marks the job FAILED on an API error and can retry from the cursor", async () => {
      const ch = fakeCh({ "2026-09-01": 4 });
      ch.searchNewCompaniesPage.mockRejectedValueOnce(new Error("Companies House request failed (500)"));
      const job = await createJob(prisma, {
        incorporatedFrom: "2026-09-01",
        incorporatedTo: "2026-09-01",
        companyType: "ltd",
        companyStatus: "active",
      });
      await expect(runFetchStep(prisma, ch, job.id)).rejects.toThrow("(500)");
      expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("FAILED");

      expect(await runFetchStep(prisma, ch, job.id)).toMatchObject({ done: true, totalCompanies: 4 });
      expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).errorMessage).toBeNull();
    });
  });

  describe("processBatch", () => {
    it("does nothing until the job is started", async () => {
      const job = await jobWithRows(["A LTD"]);
      expect(await processBatch(prisma, job.id, makeDeps, 10)).toEqual({ processed: 0, remaining: 1, status: "READY" });
    });

    it("processes batches, updates counters and credits, and completes", async () => {
      const job = await jobWithRows(["FOUND ONE LTD", "NOTHING LTD", "BOOM LTD", "FOUND TWO LTD", "OTHER LTD"]);
      await resumeJob(prisma, job.id);

      const first = await processBatch(prisma, job.id, makeDeps, 3);
      expect(first).toMatchObject({ processed: 3, remaining: 2, status: "RUNNING" });
      const second = await processBatch(prisma, job.id, makeDeps, 3);
      expect(second).toMatchObject({ processed: 2, remaining: 0, status: "COMPLETED" });

      const saved = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(saved).toMatchObject({ processedCount: 5, foundCount: 2, noMatchCount: 2, errorCount: 1 });
      // FOUND: 2 credits each; NOTHING/OTHER: 2 each (no officers); BOOM: fails in the fb search (1) + places (1).
      expect(saved.searchCreditsUsed).toBe(10);

      const boom = await prisma.companyResult.findFirstOrThrow({ where: { jobId: job.id, companyName: "BOOM LTD" } });
      expect(boom).toMatchObject({ status: "ERROR", errorMessage: "search exploded" });
      expect(boom.processedAt).not.toBeNull();
    });

    it("claims nothing when deps cannot be built (e.g. missing key)", async () => {
      const job = await jobWithRows(["A LTD"]);
      await resumeJob(prisma, job.id);
      const failing: ProcessDepsFactory = () => {
        throw new Error("Serper API key is missing or invalid");
      };
      await expect(processBatch(prisma, job.id, failing, 10)).rejects.toThrow("Serper");
      expect(await prisma.companyResult.count({ where: { jobId: job.id, status: "PENDING" } })).toBe(1);
    });

    it("pauses the run and requeues companies when search credits run out", async () => {
      const job = await jobWithRows(["A LTD", "BROKE LTD", "C LTD", "D LTD"]);
      await resumeJob(prisma, job.id);
      const result = await processBatch(prisma, job.id, makeDeps, 10);
      expect(result.status).toBe("PAUSED");
      const saved = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(saved.errorMessage).toBe(OUT_OF_CREDITS_MESSAGE);
      // Nothing is marked as an error: the company that hit the limit, and any
      // not yet started, are back in the queue.
      expect(await prisma.companyResult.count({ where: { jobId: job.id, status: "ERROR" } })).toBe(0);
      expect(await prisma.companyResult.count({ where: { jobId: job.id, companyName: "BROKE LTD", status: "PENDING" } })).toBe(1);
      expect(await prisma.companyResult.count({ where: { jobId: job.id, status: "PROCESSING" } })).toBe(0);

      const resumed = await resumeJob(prisma, job.id);
      expect(resumed).toMatchObject({ status: "RUNNING", errorMessage: null });
    });

    it("never gives the same row to two overlapping batches", async () => {
      const job = await jobWithRows(Array.from({ length: 30 }, (_, i) => `CO ${i} LTD`));
      const [a, b, c] = await Promise.all([claimRows(prisma, job.id, 12), claimRows(prisma, job.id, 12), claimRows(prisma, job.id, 12)]);
      const ids = [...a, ...b, ...c].map((r) => r.id);
      expect(ids).toHaveLength(30);
      expect(new Set(ids).size).toBe(30);
    });

    it("resets rows stuck in PROCESSING for more than 5 minutes", async () => {
      const job = await jobWithRows(["STUCK LTD", "FRESH LTD"]);
      await prisma.companyResult.updateMany({
        where: { jobId: job.id, companyName: "STUCK LTD" },
        data: { status: "PROCESSING", claimedAt: new Date(Date.now() - 6 * 60 * 1000) },
      });
      await prisma.companyResult.updateMany({
        where: { jobId: job.id, companyName: "FRESH LTD" },
        data: { status: "PROCESSING", claimedAt: new Date() },
      });
      expect(await resetStaleClaims(prisma, job.id)).toBe(1);
      const stuck = await prisma.companyResult.findFirstOrThrow({ where: { jobId: job.id, companyName: "STUCK LTD" } });
      expect(stuck.status).toBe("PENDING");
    });

    it("releases rows it could not start before the time budget ran out", async () => {
      const job = await jobWithRows(["A LTD", "B LTD", "C LTD"]);
      await resumeJob(prisma, job.id);
      const result = await processBatch(prisma, job.id, makeDeps, 10, 0);
      expect(result).toMatchObject({ processed: 0, remaining: 3, status: "RUNNING" });
      expect(await prisma.companyResult.count({ where: { jobId: job.id, status: "PENDING" } })).toBe(3);
    });
  });

  describe("pause / resume / retry", () => {
    it("pauses and resumes", async () => {
      const job = await jobWithRows(["A LTD", "B LTD"]);
      await expect(pauseJob(prisma, job.id)).rejects.toThrow(/Only a running job/);
      await resumeJob(prisma, job.id);
      expect((await pauseJob(prisma, job.id)).status).toBe("PAUSED");
      expect(await processBatch(prisma, job.id, makeDeps, 10)).toMatchObject({ processed: 0, status: "PAUSED" });
      expect((await resumeJob(prisma, job.id)).status).toBe("RUNNING");
      expect(await processBatch(prisma, job.id, makeDeps, 10)).toMatchObject({ processed: 2, status: "COMPLETED" });
    });

    it("retries errors and fixes the counters", async () => {
      const job = await jobWithRows(["BOOM LTD", "FOUND LTD"]);
      await resumeJob(prisma, job.id);
      await processBatch(prisma, job.id, makeDeps, 10);
      expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "COMPLETED", errorCount: 1 });

      const { job: retried, retried: count } = await retryErrors(prisma, job.id);
      expect(count).toBe(1);
      expect(retried).toMatchObject({ status: "RUNNING", errorCount: 0, processedCount: 1 });
      const boom = await prisma.companyResult.findFirstOrThrow({ where: { jobId: job.id, companyName: "BOOM LTD" } });
      expect(boom).toMatchObject({ status: "PENDING", errorMessage: null });
    });
  });

  describe("deleteJob", () => {
    it("deletes the run and its results but keeps the search cache", async () => {
      const job = await jobWithRows(["A LTD", "B LTD"]);
      await prisma.searchCache.upsert({
        where: { provider_type_query: { provider: "test", type: "facebook", query: "delete-test" } },
        create: { provider: "test", type: "facebook", query: "delete-test", response: [] },
        update: {},
      });
      expect(await deleteJob(prisma, job.id)).toEqual({ deletedCompanies: 2 });
      expect(await prisma.job.findUnique({ where: { id: job.id } })).toBeNull();
      expect(await prisma.companyResult.count({ where: { jobId: job.id } })).toBe(0);
      expect(await prisma.searchCache.count({ where: { query: "delete-test" } })).toBe(1);
      await prisma.searchCache.deleteMany({ where: { query: "delete-test" } });
      await expect(deleteJob(prisma, job.id)).rejects.toThrow("Job not found");
    });
  });

  describe("listResults", () => {
    it("filters by tab and name and paginates", async () => {
      const job = await jobWithRows(["Acme Plumbing LTD", "Beta LTD", "Gamma LTD", "Acme Roofing LTD"]);
      await prisma.companyResult.updateMany({
        where: { jobId: job.id, companyName: { in: ["Acme Plumbing LTD", "Beta LTD"] } },
        data: { status: "FOUND", matchSource: "BUSINESS" },
      });
      await prisma.companyResult.updateMany({
        where: { jobId: job.id, companyName: "Beta LTD" },
        data: { matchSource: "OWNER_OTHER_BUSINESS" },
      });

      const q = (params: Record<string, string>) => listResults(prisma, job.id, resultsQuerySchema.parse(params));
      expect((await q({ status: "found" })).total).toBe(2);
      expect((await q({ status: "via_owner" })).items.map((r) => r.companyName)).toEqual(["Beta LTD"]);
      expect((await q({ search: "acme" })).total).toBe(2);
      const paged = await q({ pageSize: "3", page: "2" });
      expect(paged).toMatchObject({ total: 4, pageCount: 2 });
      expect(paged.items).toHaveLength(1);
      expect(paged.items[0]!.incorporationDate).toBe("2026-09-01");
    });
  });
});
