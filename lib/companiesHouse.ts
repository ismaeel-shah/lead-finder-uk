import { z } from "zod";
import { getConfigStatus } from "@/lib/env";
import { fetchWithRetry, HttpError } from "@/lib/http";
import { TokenBucket } from "@/lib/rateLimiter";

const BASE_URL = "https://api.company-information.service.gov.uk";
const MAX_RETRIES = 5;
export const MAX_PAGE_SIZE = 5000;
/** The advanced search returns HTTP 500 for start_index >= 10,000 (verified against the live API). */
export const MAX_RESULT_WINDOW = 10_000;

/**
 * Companies House allows 600 requests per 5 minutes per key. A burst of 20
 * plus a sustained 500 / 300s means at most 520 requests in any 5-minute
 * window, safely under the limit. Shared by every client in this process.
 */
export const companiesHouseLimiter = new TokenBucket({ capacity: 20, refillPerSecond: 500 / 300 });

// ---------------------------------------------------------------------------
// Response schemas (only the fields we use; unknown keys are stripped)
// ---------------------------------------------------------------------------

const addressSchema = z
  .object({
    premises: z.string().optional(),
    address_line_1: z.string().optional(),
    address_line_2: z.string().optional(),
    locality: z.string().optional(),
    region: z.string().optional(),
    postal_code: z.string().optional(),
    country: z.string().optional(),
  })
  .passthrough();

const companyItemSchema = z.object({
  company_number: z.string(),
  company_name: z.string(),
  date_of_creation: z.string(),
  company_type: z.string().optional(),
  company_status: z.string().optional(),
  registered_office_address: addressSchema.optional(),
  sic_codes: z.array(z.string()).optional(),
});

const advancedSearchSchema = z.object({
  hits: z.number().optional(),
  items: z.array(z.unknown()).optional(),
});

const officerItemSchema = z.object({
  name: z.string(),
  officer_role: z.string(),
  appointed_on: z.string().optional(),
  resigned_on: z.string().optional(),
  links: z
    .object({
      officer: z.object({ appointments: z.string().optional() }).optional(),
    })
    .optional(),
});

const officersSchema = z.object({
  items: z.array(z.unknown()).optional(),
});

const appointmentItemSchema = z.object({
  appointed_on: z.string().optional(),
  appointed_before: z.string().optional(),
  resigned_on: z.string().optional(),
  officer_role: z.string().optional(),
  appointed_to: z.object({
    company_number: z.string(),
    company_name: z.string().optional(),
    company_status: z.string().optional(),
  }),
});

const appointmentsSchema = z.object({
  items: z.array(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RegisteredAddress = z.infer<typeof addressSchema>;

export interface CompanySummary {
  companyNumber: string;
  companyName: string;
  /** YYYY-MM-DD */
  dateOfCreation: string;
  companyType: string | null;
  companyStatus: string | null;
  registeredOfficeAddress: RegisteredAddress | null;
  sicCodes: string[];
}

export interface Officer {
  /** From links.officer.appointments; null if the link is missing. */
  officerId: string | null;
  name: string;
  role: string;
  appointedOn: string | null;
  resignedOn: string | null;
}

export interface Appointment {
  companyNumber: string;
  companyName: string;
  companyStatus: string | null;
  appointedOn: string | null;
  resignedOn: string | null;
}

export interface CompanySearchFilters {
  /** YYYY-MM-DD */
  incorporatedFrom: string;
  /** YYYY-MM-DD */
  incorporatedTo: string;
  companyStatus?: string;
  companyType?: string;
  /** Comma-separated SIC codes. */
  sicCodes?: string;
  location?: string;
  /** Only companies whose name contains this text. */
  nameIncludes?: string;
}

export interface CompanySearchPage {
  items: CompanySummary[];
  /** Total hits reported by Companies House, if given. */
  hits: number | null;
  /** start_index for the next page, or null when there are no more pages. */
  nextStartIndex: number | null;
  /** True when more results exist beyond the 10,000 the API can return. */
  truncated: boolean;
}

export interface CompaniesHouseClient {
  searchNewCompaniesPage(filters: CompanySearchFilters, startIndex?: number, size?: number): Promise<CompanySearchPage>;
  searchNewCompanies(filters: CompanySearchFilters, pageSize?: number): AsyncGenerator<CompanySummary[], void, undefined>;
  getOfficers(companyNumber: string): Promise<Officer[]>;
  getOfficerAppointments(officerId: string): Promise<Appointment[]>;
}

export class CompaniesHouseError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CompaniesHouseError";
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface CompaniesHouseClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  limiter?: TokenBucket;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
}

export function createCompaniesHouseClient(options: CompaniesHouseClientOptions): CompaniesHouseClient {
  const { apiKey, fetchImpl, sleep, limiter = companiesHouseLimiter, baseUrl = BASE_URL } = options;
  // HTTP Basic auth: username = API key, empty password.
  const authorization = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;

  /** GET a path; returns null on 404 (Companies House uses 404 for "nothing found"). */
  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    let response: Response;
    try {
      response = await fetchWithRetry(
        `${baseUrl}${path}`,
        { method: "GET", headers: { Authorization: authorization, Accept: "application/json" } },
        {
          label: "companies-house",
          maxRetries: MAX_RETRIES,
          beforeAttempt: () => limiter.take(),
          onRateLimited: () => limiter.drain(),
          fetchImpl,
          sleep,
        },
      );
    } catch (err) {
      if (err instanceof HttpError) {
        throw new CompaniesHouseError(`Companies House request failed (${err.status}) for ${path}`, err.status);
      }
      throw new CompaniesHouseError(`Companies House request failed for ${path}: ${(err as Error).message}`);
    }

    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403) {
      throw new CompaniesHouseError("Companies House API key is missing or invalid", response.status);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new CompaniesHouseError(
        `Companies House returned ${response.status} for ${path}${body ? `: ${body.slice(0, 200)}` : ""}`,
        response.status,
      );
    }

    const json: unknown = await response.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new CompaniesHouseError(`Unexpected Companies House response for ${path}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    }
    return parsed.data;
  }

  async function searchNewCompaniesPage(
    filters: CompanySearchFilters,
    startIndex = 0,
    size = MAX_PAGE_SIZE,
  ): Promise<CompanySearchPage> {
    if (startIndex >= MAX_RESULT_WINDOW) {
      throw new CompaniesHouseError(
        `Companies House search cannot page beyond ${MAX_RESULT_WINDOW} results; use a narrower date range`,
      );
    }
    // Never ask for results past the window: Companies House answers 500.
    const pageSize = Math.min(Math.max(1, size), MAX_PAGE_SIZE, MAX_RESULT_WINDOW - startIndex);
    const params = buildSearchParams(filters, startIndex, pageSize);
    const data = await get(`/advanced-search/companies?${params.toString()}`, advancedSearchSchema);
    if (!data) return { items: [], hits: 0, nextStartIndex: null, truncated: false };

    const rawItems = data.items ?? [];
    const items = parseItems(rawItems, companyItemSchema, "company").map(toCompanySummary);
    const hits = data.hits ?? null;
    const fetchedSoFar = startIndex + rawItems.length;
    const moreExist = rawItems.length === pageSize && (hits === null || fetchedSoFar < hits);
    const truncated = moreExist && fetchedSoFar >= MAX_RESULT_WINDOW;
    return { items, hits, nextStartIndex: moreExist && !truncated ? fetchedSoFar : null, truncated };
  }

  /**
   * Yields every company in the date range. The search API cannot page past
   * 10,000 results (a single month can have 50k+), so the range is queried
   * one day at a time; a single day is normally a few thousand.
   */
  async function* searchNewCompanies(
    filters: CompanySearchFilters,
    pageSize = MAX_PAGE_SIZE,
  ): AsyncGenerator<CompanySummary[], void, undefined> {
    const seen = new Set<string>();
    for (const day of eachDay(filters.incorporatedFrom, filters.incorporatedTo)) {
      const dayFilters = { ...filters, incorporatedFrom: day, incorporatedTo: day };
      let startIndex: number | null = 0;
      while (startIndex !== null) {
        const page = await searchNewCompaniesPage(dayFilters, startIndex, pageSize);
        if (page.truncated) {
          console.warn(`[companies-house] ${day} has more than ${MAX_RESULT_WINDOW} results; only the first ${MAX_RESULT_WINDOW} are returned`);
        }
        const fresh = page.items.filter((c) => !seen.has(c.companyNumber));
        fresh.forEach((c) => seen.add(c.companyNumber));
        if (fresh.length > 0) yield fresh;
        startIndex = page.nextStartIndex;
      }
    }
  }

  async function getOfficers(companyNumber: string): Promise<Officer[]> {
    const data = await get(`/company/${encodeURIComponent(companyNumber)}/officers?items_per_page=100`, officersSchema);
    if (!data) return [];
    return parseItems(data.items ?? [], officerItemSchema, "officer").map((o) => ({
      officerId: parseOfficerId(o.links?.officer?.appointments),
      name: o.name,
      role: o.officer_role,
      appointedOn: o.appointed_on ?? null,
      resignedOn: o.resigned_on ?? null,
    }));
  }

  async function getOfficerAppointments(officerId: string): Promise<Appointment[]> {
    const data = await get(`/officers/${encodeURIComponent(officerId)}/appointments?items_per_page=50`, appointmentsSchema);
    if (!data) return [];
    return parseItems(data.items ?? [], appointmentItemSchema, "appointment").map((a) => ({
      companyNumber: a.appointed_to.company_number,
      companyName: a.appointed_to.company_name ?? "",
      companyStatus: a.appointed_to.company_status ?? null,
      appointedOn: a.appointed_on ?? a.appointed_before ?? null,
      resignedOn: a.resigned_on ?? null,
    }));
  }

  return { searchNewCompaniesPage, searchNewCompanies, getOfficers, getOfficerAppointments };
}

/** Client built from environment config, for use in API routes and scripts. */
export function getCompaniesHouseClient(): CompaniesHouseClient {
  const apiKey = getConfigStatus().config?.COMPANIES_HOUSE_API_KEY;
  if (!apiKey) throw new CompaniesHouseError("Companies House API key is missing or invalid");
  return createCompaniesHouseClient({ apiKey });
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests and for the processing engine)
// ---------------------------------------------------------------------------

export function buildSearchParams(filters: CompanySearchFilters, startIndex: number, size: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("incorporated_from", filters.incorporatedFrom);
  params.set("incorporated_to", filters.incorporatedTo);
  for (const status of splitList(filters.companyStatus ?? "active")) params.append("company_status", status);
  for (const type of splitList(filters.companyType ?? "ltd")) params.append("company_type", type);
  for (const sic of splitList(filters.sicCodes)) params.append("sic_codes", sic);
  if (filters.location?.trim()) params.set("location", filters.location.trim());
  if (filters.nameIncludes?.trim()) params.set("company_name_includes", filters.nameIncludes.trim());
  params.set("size", String(size));
  params.set("start_index", String(startIndex));
  return params;
}

/** Every YYYY-MM-DD date from `from` to `to` inclusive. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/** Extracts the officer ID from "/officers/{officer_id}/appointments". */
export function parseOfficerId(appointmentsLink: string | undefined): string | null {
  if (!appointmentsLink) return null;
  const match = /\/officers\/([^/?#]+)\/appointments/.exec(appointmentsLink);
  return match?.[1] ?? null;
}

export interface PrimaryOfficerSelection {
  primary: Officer & { officerId: string };
  /** Names of all active directors (or active officers, if there are no directors). */
  activeNames: string[];
}

/**
 * Section 4.2: consider only active (not resigned) directors, falling back to
 * any active officer. The primary officer is the earliest appointed; ties go
 * to the first in the list. Officers without an ID link are skipped as the
 * primary because the fallback needs that link.
 */
export function selectPrimaryOfficer(officers: Officer[]): PrimaryOfficerSelection | null {
  const active = officers.filter((o) => !o.resignedOn);
  const directors = active.filter((o) => o.role.toLowerCase() === "director");
  const pool = directors.length > 0 ? directors : active;

  let primary: (Officer & { officerId: string }) | null = null;
  for (const officer of pool) {
    if (!officer.officerId) continue;
    if (!primary || compareDates(officer.appointedOn, primary.appointedOn) < 0) {
      primary = { ...officer, officerId: officer.officerId };
    }
  }
  if (!primary) return null;
  return { primary, activeNames: pool.map((o) => o.name) };
}

/**
 * Section 4.3: the officer's other companies, excluding the original, one
 * entry per company, active companies first, then oldest appointment first.
 */
export function selectOtherCompanies(appointments: Appointment[], excludeCompanyNumber: string, max: number): Appointment[] {
  const byCompany = new Map<string, Appointment>();
  for (const appt of appointments) {
    if (sameCompanyNumber(appt.companyNumber, excludeCompanyNumber)) continue;
    const existing = byCompany.get(appt.companyNumber);
    // Keep the oldest appointment for companies the officer holds several roles in.
    if (!existing || compareDates(appt.appointedOn, existing.appointedOn) < 0) {
      byCompany.set(appt.companyNumber, appt);
    }
  }
  return [...byCompany.values()]
    .map((appt, index) => ({ appt, index }))
    .sort((a, b) => {
      const activeA = a.appt.companyStatus === "active" ? 0 : 1;
      const activeB = b.appt.companyStatus === "active" ? 0 : 1;
      return activeA - activeB || compareDates(a.appt.appointedOn, b.appt.appointedOn) || a.index - b.index;
    })
    .slice(0, Math.max(0, max))
    .map(({ appt }) => appt);
}

function toCompanySummary(c: z.infer<typeof companyItemSchema>): CompanySummary {
  return {
    companyNumber: c.company_number,
    companyName: c.company_name,
    dateOfCreation: c.date_of_creation,
    companyType: c.company_type ?? null,
    companyStatus: c.company_status ?? null,
    registeredOfficeAddress: c.registered_office_address ?? null,
    sicCodes: c.sic_codes ?? [],
  };
}

/** Validates items one by one so a single malformed item doesn't fail the page. */
function parseItems<T>(items: unknown[], schema: z.ZodType<T>, kind: string): T[] {
  const out: T[] = [];
  for (const item of items) {
    const parsed = schema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
    else console.warn(`[companies-house] skipping malformed ${kind}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  return out;
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Compares YYYY-MM-DD strings; missing dates sort last. */
function compareDates(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
}

function sameCompanyNumber(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}
