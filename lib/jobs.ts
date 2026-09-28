import { Prisma, type Job, type JobStatus, type PrismaClient, type ResultStatus } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import type { CompaniesHouseClient, CompanySearchFilters, RegisteredAddress } from "@/lib/companiesHouse";
import { addDays, dateOnly, formatDate, isValidDateString, todayInLondon } from "@/lib/dates";
import { processCompany, type CompanyInput, type ProcessDeps, type ProcessOutcome } from "@/lib/processCompany";
import { OUT_OF_CREDITS_MESSAGE, type SearchUsage } from "@/lib/search/types";

/**
 * Job lifecycle (spec Section 9). No step runs longer than a Vercel function
 * allows: fetching and processing are split into short steps that the
 * dashboard calls repeatedly.
 */

/** Stop starting new work after this long so the response beats maxDuration (60s). */
export const STEP_BUDGET_MS = 40_000;
/** Rows stuck in PROCESSING longer than this are handed back to PENDING. */
export const STALE_CLAIM_MS = 5 * 60 * 1000;
/** Companies processed at the same time within one batch. */
export const PROCESS_CONCURRENCY = 5;
export const MAX_RANGE_DAYS = 366;

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const dateString = z.string().refine(isValidDateString, "must be a date in YYYY-MM-DD format");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const createJobSchema = z
  .object({
    incorporatedFrom: dateString,
    incorporatedTo: dateString,
    companyType: z.string().trim().min(1).max(100).default("ltd"),
    companyStatus: z.string().trim().min(1).max(100).default("active"),
    sicCodes: optionalText(200).refine((v) => !v || /^[0-9,\s]+$/.test(v), "SIC codes must be numbers separated by commas"),
    location: optionalText(100),
  })
  .superRefine((v, ctx) => {
    if (v.incorporatedFrom > v.incorporatedTo) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["incorporatedFrom"], message: "must be on or before the end date" });
    }
    if (v.incorporatedTo > todayInLondon()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["incorporatedTo"], message: "cannot be in the future" });
    }
    const days = (Date.parse(v.incorporatedTo) - Date.parse(v.incorporatedFrom)) / 86_400_000 + 1;
    if (days > MAX_RANGE_DAYS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["incorporatedTo"], message: `date range cannot exceed ${MAX_RANGE_DAYS} days` });
    }
  });

export type CreateJobInput = z.infer<typeof createJobSchema>;

/** Stored in Job.filters, using the Companies House parameter names. */
const storedFiltersSchema = z.object({
  company_type: z.string(),
  company_status: z.string(),
  sic_codes: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
});

const fetchCursorSchema = z.object({ date: z.string(), startIndex: z.number().int().min(0) });
type FetchCursor = z.infer<typeof fetchCursorSchema>;

export const jobIdSchema = z.string().trim().min(1).max(64);

// ---------------------------------------------------------------------------
// Create + fetch
// ---------------------------------------------------------------------------

export async function createJob(prisma: PrismaClient, input: CreateJobInput): Promise<Job> {
  return prisma.job.create({
    data: {
      incorporatedFrom: dateOnly(input.incorporatedFrom),
      incorporatedTo: dateOnly(input.incorporatedTo),
      filters: {
        company_type: input.companyType,
        company_status: input.companyStatus,
        sic_codes: input.sicCodes ?? null,
        location: input.location ?? null,
      },
      status: "FETCHING",
      fetchCursor: { date: input.incorporatedFrom, startIndex: 0 },
    },
  });
}

export interface FetchStepResult {
  done: boolean;
  totalCompanies: number;
  /** Day the next call will continue from, if not done. */
  nextDate: string | null;
}

/**
 * Fetches Companies House pages, one day at a time, until the job is fully
 * fetched or the time budget runs out. The cursor is saved after every page,
 * so an interrupted fetch continues where it stopped.
 */
export async function runFetchStep(
  prisma: PrismaClient,
  ch: Pick<CompaniesHouseClient, "searchNewCompaniesPage">,
  jobId: string,
  budgetMs = STEP_BUDGET_MS,
): Promise<FetchStepResult> {
  const deadline = Date.now() + budgetMs;
  const job = await getJobOrThrow(prisma, jobId);
  if (job.status === "FAILED" && job.fetchCursor) {
    // A failed fetch can be retried from its cursor.
    await prisma.job.update({ where: { id: jobId }, data: { status: "FETCHING", errorMessage: null } });
  } else if (job.status !== "FETCHING") {
    return { done: true, totalCompanies: job.totalCompanies, nextDate: null };
  }

  const filters = storedFiltersSchema.parse(job.filters);
  const to = formatDate(job.incorporatedTo);
  let cursor: FetchCursor | null = fetchCursorSchema.parse(job.fetchCursor ?? { date: formatDate(job.incorporatedFrom), startIndex: 0 });

  try {
    while (cursor && Date.now() < deadline) {
      const search: CompanySearchFilters = {
        incorporatedFrom: cursor.date,
        incorporatedTo: cursor.date,
        companyType: filters.company_type,
        companyStatus: filters.company_status,
        sicCodes: filters.sic_codes ?? undefined,
        location: filters.location ?? undefined,
      };
      const page = await ch.searchNewCompaniesPage(search, cursor.startIndex);
      if (page.truncated) {
        console.warn(`[jobs] ${jobId}: ${cursor.date} has more than 10,000 companies; the rest cannot be fetched`);
      }

      if (page.items.length > 0) {
        await prisma.companyResult.createMany({
          data: page.items.map((c) => ({
            jobId,
            companyNumber: c.companyNumber,
            companyName: c.companyName,
            incorporationDate: dateOnly(c.dateOfCreation),
            companyType: c.companyType,
            registeredAddress: (c.registeredOfficeAddress ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
            sicCodes: c.sicCodes,
          })),
          skipDuplicates: true, // dedupe on (jobId, companyNumber)
        });
      }

      cursor =
        page.nextStartIndex !== null
          ? { date: cursor.date, startIndex: page.nextStartIndex }
          : cursor.date < to
            ? { date: addDays(cursor.date, 1), startIndex: 0 }
            : null;

      const totalCompanies = await prisma.companyResult.count({ where: { jobId } });
      await prisma.job.update({
        where: { id: jobId },
        data: {
          totalCompanies,
          fetchCursor: cursor ?? Prisma.DbNull,
          ...(cursor ? {} : { status: "READY" as JobStatus }),
        },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.job.update({ where: { id: jobId }, data: { status: "FAILED", errorMessage: message } });
    throw err;
  }

  const updated = await getJobOrThrow(prisma, jobId);
  return { done: cursor === null, totalCompanies: updated.totalCompanies, nextDate: cursor?.date ?? null };
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

export interface ProcessDepsFactory {
  /** Builds deps for one batch; `usage` collects the credits it spends. */
  (usage: SearchUsage): ProcessDeps | Promise<ProcessDeps>;
}

export interface BatchResult {
  processed: number;
  remaining: number;
  status: JobStatus;
}

interface ClaimedRow {
  id: string;
  companyNumber: string;
  companyName: string;
  registeredAddress: Prisma.JsonValue;
}

/** Hands rows stuck in PROCESSING (e.g. from a crashed batch) back to PENDING. */
export async function resetStaleClaims(prisma: PrismaClient, jobId: string, staleMs = STALE_CLAIM_MS): Promise<number> {
  const { count } = await prisma.companyResult.updateMany({
    where: {
      jobId,
      status: "PROCESSING",
      OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(Date.now() - staleMs) } }],
    },
    data: { status: "PENDING", claimedAt: null },
  });
  return count;
}

/**
 * Atomically claims up to `limit` PENDING rows. FOR UPDATE SKIP LOCKED means
 * two overlapping batch calls can never claim the same row: the second call
 * skips rows the first has locked and takes the next ones.
 */
export async function claimRows(prisma: PrismaClient, jobId: string, limit: number): Promise<ClaimedRow[]> {
  return prisma.$queryRaw<ClaimedRow[]>`
    UPDATE "CompanyResult"
    SET "status" = 'PROCESSING'::"ResultStatus", "claimedAt" = NOW()
    WHERE "id" IN (
      SELECT "id" FROM "CompanyResult"
      WHERE "jobId" = ${jobId} AND "status" = 'PENDING'::"ResultStatus"
      ORDER BY "incorporationDate", "companyNumber"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "companyNumber", "companyName", "registeredAddress"`;
}

/** Recomputes the job's counters from its rows (and adds any credits spent). */
export async function refreshCounters(prisma: PrismaClient, jobId: string, creditsDelta = 0): Promise<void> {
  const groups = await prisma.companyResult.groupBy({ by: ["status"], where: { jobId }, _count: { _all: true } });
  const count = (s: ResultStatus) => groups.find((g) => g.status === s)?._count._all ?? 0;
  const found = count("FOUND");
  const noMatch = count("NO_MATCH");
  const errors = count("ERROR");
  await prisma.job.update({
    where: { id: jobId },
    data: {
      foundCount: found,
      noMatchCount: noMatch,
      errorCount: errors,
      processedCount: found + noMatch + errors,
      ...(creditsDelta > 0 ? { searchCreditsUsed: { increment: creditsDelta } } : {}),
    },
  });
}

/**
 * Processes one batch: claims up to `batchSize` rows, processes them a few at
 * a time, and saves each result as soon as it is ready. Rows not started
 * before the time budget runs out are released back to PENDING.
 */
export async function processBatch(
  prisma: PrismaClient,
  jobId: string,
  makeDeps: ProcessDepsFactory,
  batchSize: number,
  budgetMs = STEP_BUDGET_MS,
): Promise<BatchResult> {
  const deadline = Date.now() + budgetMs;
  const job = await getJobOrThrow(prisma, jobId);
  if (job.status !== "RUNNING") {
    return { processed: 0, remaining: await countRemaining(prisma, jobId), status: job.status };
  }

  // Build deps before claiming, so a config error (e.g. a missing key) cannot
  // leave claimed rows stuck in PROCESSING.
  const usage: SearchUsage = { credits: 0 };
  let deps: ProcessDeps;
  try {
    deps = await makeDeps(usage);
  } catch (err) {
    // Every search key is out of credits: pause (nothing claimed) instead of failing.
    if (err instanceof Error && err.message === OUT_OF_CREDITS_MESSAGE) {
      await prisma.job.updateMany({ where: { id: jobId, status: "RUNNING" }, data: { status: "PAUSED", errorMessage: OUT_OF_CREDITS_MESSAGE } });
      return { processed: 0, remaining: await countRemaining(prisma, jobId), status: "PAUSED" };
    }
    throw err;
  }
  await resetStaleClaims(prisma, jobId);
  const rows = await claimRows(prisma, jobId, batchSize);
  let creditsSaved = 0;
  let processed = 0;

  const queue = [...rows];
  const released: string[] = [];

  let outOfCredits = false;

  async function worker() {
    for (let row = queue.shift(); row; row = queue.shift()) {
      if (Date.now() >= deadline || outOfCredits) {
        released.push(row.id);
        continue;
      }
      const outcome = await processCompany(toCompanyInput(row), deps);
      // An empty search account would fail every remaining company the same
      // way. Put this one back in the queue instead of marking it an error,
      // stop the batch, and pause the run (below) until credits are topped up.
      if (outcome.status === "ERROR" && outcome.errorMessage === OUT_OF_CREDITS_MESSAGE) {
        outOfCredits = true;
        released.push(row.id);
        continue;
      }
      await saveOutcome(prisma, row.id, outcome);
      processed++;
      // Credits are counted per company so progress polling sees them rise.
      const delta = usage.credits - creditsSaved;
      creditsSaved = usage.credits;
      await refreshCounters(prisma, jobId, delta);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PROCESS_CONCURRENCY, rows.length) }, worker));
  // Workers refresh counters concurrently and can overwrite each other with
  // slightly stale numbers; one final recount makes them exact.
  if (processed > 0) await refreshCounters(prisma, jobId);

  if (released.length > 0) {
    await prisma.companyResult.updateMany({
      where: { id: { in: released }, status: "PROCESSING" },
      data: { status: "PENDING", claimedAt: null },
    });
  }

  if (outOfCredits) {
    await prisma.job.updateMany({ where: { id: jobId, status: "RUNNING" }, data: { status: "PAUSED", errorMessage: OUT_OF_CREDITS_MESSAGE } });
  }

  const remaining = await countRemaining(prisma, jobId);
  if (remaining === 0) {
    await prisma.job.updateMany({ where: { id: jobId, status: "RUNNING" }, data: { status: "COMPLETED" } });
  }
  const after = await getJobOrThrow(prisma, jobId);
  return { processed, remaining, status: after.status };
}

async function saveOutcome(prisma: PrismaClient, rowId: string, outcome: ProcessOutcome): Promise<void> {
  await prisma.companyResult.update({
    where: { id: rowId },
    data: { ...outcome, processedAt: new Date(), claimedAt: null },
  });
}

function toCompanyInput(row: ClaimedRow): CompanyInput {
  const address = row.registeredAddress as RegisteredAddress | null;
  return {
    companyNumber: row.companyNumber,
    companyName: row.companyName,
    registeredAddress: address && typeof address === "object" ? address : null,
  };
}

async function countRemaining(prisma: PrismaClient, jobId: string): Promise<number> {
  return prisma.companyResult.count({ where: { jobId, status: { in: ["PENDING", "PROCESSING"] } } });
}

// ---------------------------------------------------------------------------
// Pause / resume / retry
// ---------------------------------------------------------------------------

export async function pauseJob(prisma: PrismaClient, jobId: string): Promise<Job> {
  const job = await getJobOrThrow(prisma, jobId);
  if (job.status !== "RUNNING") throw new ApiError(409, `Only a running job can be paused (job is ${job.status.toLowerCase()})`);
  await prisma.job.updateMany({ where: { id: jobId, status: "RUNNING" }, data: { status: "PAUSED" } });
  return getJobOrThrow(prisma, jobId);
}

/** Starts or resumes processing (READY / PAUSED -> RUNNING). */
export async function resumeJob(prisma: PrismaClient, jobId: string): Promise<Job> {
  const job = await getJobOrThrow(prisma, jobId);
  if (job.status === "RUNNING") return job;
  if (job.status !== "READY" && job.status !== "PAUSED") {
    throw new ApiError(409, `A ${job.status.toLowerCase()} job cannot be started`);
  }
  await resetStaleClaims(prisma, jobId);
  const remaining = await countRemaining(prisma, jobId);
  await prisma.job.updateMany({
    where: { id: jobId, status: { in: ["READY", "PAUSED"] } },
    data: { status: remaining > 0 ? "RUNNING" : "COMPLETED", errorMessage: null },
  });
  return getJobOrThrow(prisma, jobId);
}

/** Puts every ERROR row back to PENDING and sets the job running again. */
export async function retryErrors(prisma: PrismaClient, jobId: string): Promise<{ job: Job; retried: number }> {
  const job = await getJobOrThrow(prisma, jobId);
  if (job.status === "FETCHING" || job.status === "FAILED") {
    throw new ApiError(409, "Companies are still being fetched for this job");
  }
  const { count } = await prisma.companyResult.updateMany({
    where: { jobId, status: "ERROR" },
    data: { status: "PENDING", errorMessage: null, claimedAt: null },
  });
  await refreshCounters(prisma, jobId);
  if (count > 0 && job.status !== "RUNNING") {
    await prisma.job.update({ where: { id: jobId }, data: { status: "RUNNING", errorMessage: null } });
  }
  return { job: await getJobOrThrow(prisma, jobId), retried: count };
}

/**
 * Permanently deletes a run and all its results (rows cascade). The shared
 * search cache is kept, so running the same range again costs no credits.
 * A browser still driving this run gets a 404 on its next call and stops.
 */
export async function deleteJob(prisma: PrismaClient, jobId: string): Promise<{ deletedCompanies: number }> {
  const job = await getJobOrThrow(prisma, jobId);
  await prisma.job.delete({ where: { id: job.id } });
  return { deletedCompanies: job.totalCompanies };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getJobOrThrow(prisma: PrismaClient, jobId: string): Promise<Job> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new ApiError(404, "Job not found");
  return job;
}

export function serializeJob(job: Job, remaining?: number) {
  return {
    id: job.id,
    createdAt: job.createdAt.toISOString(),
    incorporatedFrom: formatDate(job.incorporatedFrom),
    incorporatedTo: formatDate(job.incorporatedTo),
    filters: job.filters,
    status: job.status,
    totalCompanies: job.totalCompanies,
    processedCount: job.processedCount,
    foundCount: job.foundCount,
    noMatchCount: job.noMatchCount,
    errorCount: job.errorCount,
    searchCreditsUsed: job.searchCreditsUsed,
    errorMessage: job.errorMessage,
    ...(remaining === undefined ? {} : { remaining }),
  };
}

export async function getJobSummary(prisma: PrismaClient, jobId: string) {
  const job = await getJobOrThrow(prisma, jobId);
  const [remaining, viaOwnerCount] = await Promise.all([
    countRemaining(prisma, jobId),
    prisma.companyResult.count({ where: { jobId, status: "FOUND", matchSource: "OWNER_OTHER_BUSINESS" } }),
  ]);
  return { ...serializeJob(job, remaining), viaOwnerCount };
}

export async function listJobs(prisma: PrismaClient, limit = 50) {
  const jobs = await prisma.job.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return jobs.map((j) => serializeJob(j));
}

export const resultsQuerySchema = z.object({
  status: z
    .enum(["all", "found", "via_owner", "no_match", "error", "pending"])
    .default("all"),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type ResultsQuery = z.infer<typeof resultsQuerySchema>;

export function resultsWhere(jobId: string, query: Pick<ResultsQuery, "status" | "search">): Prisma.CompanyResultWhereInput {
  const where: Prisma.CompanyResultWhereInput = { jobId };
  switch (query.status) {
    case "found":
      where.status = "FOUND";
      break;
    case "via_owner":
      where.status = "FOUND";
      where.matchSource = "OWNER_OTHER_BUSINESS";
      break;
    case "no_match":
      where.status = "NO_MATCH";
      break;
    case "error":
      where.status = "ERROR";
      break;
    case "pending":
      where.status = { in: ["PENDING", "PROCESSING"] };
      break;
  }
  if (query.search) where.companyName = { contains: query.search, mode: "insensitive" };
  return where;
}

export async function listResults(prisma: PrismaClient, jobId: string, query: ResultsQuery) {
  await getJobOrThrow(prisma, jobId);
  const where = resultsWhere(jobId, query);
  const [total, rows] = await Promise.all([
    prisma.companyResult.count({ where }),
    prisma.companyResult.findMany({
      where,
      orderBy: [{ incorporationDate: "asc" }, { companyName: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
    items: rows.map((r) => ({
      ...r,
      incorporationDate: formatDate(r.incorporationDate),
      processedAt: r.processedAt?.toISOString() ?? null,
      claimedAt: undefined,
    })),
  };
}
