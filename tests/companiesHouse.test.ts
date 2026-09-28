import { describe, expect, it, vi } from "vitest";
import {
  buildSearchParams,
  createCompaniesHouseClient,
  eachDay,
  parseOfficerId,
  selectOtherCompanies,
  selectPrimaryOfficer,
  type Appointment,
  type Officer,
} from "@/lib/companiesHouse";
import { TokenBucket } from "@/lib/rateLimiter";

const noSleep = async () => undefined;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeClient(fetchImpl: typeof fetch) {
  return createCompaniesHouseClient({
    apiKey: "test-key",
    fetchImpl,
    sleep: noSleep,
    limiter: new TokenBucket({ capacity: 1000, refillPerSecond: 1000 }),
  });
}

function company(n: number) {
  return {
    company_number: String(n).padStart(8, "0"),
    company_name: `COMPANY ${n} LTD`,
    date_of_creation: "2026-09-01",
    company_type: "ltd",
    company_status: "active",
    registered_office_address: { locality: "Manchester", postal_code: "M1 1AA" },
    sic_codes: ["43220"],
  };
}

describe("Companies House client", () => {
  it("sends Basic auth with the API key as username and empty password", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ hits: 0, items: [] }));
    await makeClient(fetchImpl as unknown as typeof fetch).searchNewCompaniesPage(
      { incorporatedFrom: "2026-09-01", incorporatedTo: "2026-09-01" },
      0,
      5,
    );
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("test-key:").toString("base64")}`);
  });

  it("maps search results and reports the next page", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ hits: 3, items: [company(1), company(2)] }));
    const page = await makeClient(fetchImpl as unknown as typeof fetch).searchNewCompaniesPage(
      { incorporatedFrom: "2026-09-01", incorporatedTo: "2026-09-02" },
      0,
      2,
    );
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({
      companyNumber: "00000001",
      companyName: "COMPANY 1 LTD",
      dateOfCreation: "2026-09-01",
      sicCodes: ["43220"],
    });
    expect(page.nextStartIndex).toBe(2);
  });

  it("paginates through all pages and deduplicates on company number", async () => {
    const pages = [
      { hits: 5, items: [company(1), company(2)] },
      { hits: 5, items: [company(2), company(3)] },
      { hits: 5, items: [company(4)] },
    ];
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse(pages[urls.length - 1]);
    });
    const all: string[] = [];
    for await (const batch of makeClient(fetchImpl as unknown as typeof fetch).searchNewCompanies(
      { incorporatedFrom: "2026-09-01", incorporatedTo: "2026-09-01" },
      2,
    )) {
      all.push(...batch.map((c) => c.companyNumber));
    }
    expect(urls.map((u) => new URL(u).searchParams.get("start_index"))).toEqual(["0", "2", "4"]);
    expect(all).toEqual(["00000001", "00000002", "00000003", "00000004"]);
  });

  it("queries a multi-day range one day at a time", async () => {
    const days: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      const params = new URL(url).searchParams;
      expect(params.get("incorporated_from")).toBe(params.get("incorporated_to"));
      days.push(params.get("incorporated_from")!);
      return jsonResponse({ hits: 1, items: [company(days.length)] });
    });
    const all: string[] = [];
    for await (const batch of makeClient(fetchImpl as unknown as typeof fetch).searchNewCompanies({
      incorporatedFrom: "2026-08-30",
      incorporatedTo: "2026-09-02",
    })) {
      all.push(...batch.map((c) => c.companyNumber));
    }
    expect(days).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
    expect(all).toHaveLength(4);
  });

  it("never requests past the 10,000-result window", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const size = Number(new URL(url).searchParams.get("size"));
      return jsonResponse({ hits: 20_000, items: Array.from({ length: size }, (_, i) => company(i)) });
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const page = await client.searchNewCompaniesPage({ incorporatedFrom: "2026-09-01", incorporatedTo: "2026-09-01" }, 9_000, 5_000);
    expect(new URL(String(fetchImpl.mock.calls[0]![0])).searchParams.get("size")).toBe("1000");
    expect(page.truncated).toBe(true);
    expect(page.nextStartIndex).toBeNull();
    await expect(
      client.searchNewCompaniesPage({ incorporatedFrom: "2026-09-01", incorporatedTo: "2026-09-01" }, 10_000),
    ).rejects.toThrow(/beyond 10000/);
  });

  it("treats 404 as no results", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ errors: [] }, 404));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    expect(await client.getOfficers("12345678")).toEqual([]);
    const page = await client.searchNewCompaniesPage({ incorporatedFrom: "2026-09-01", incorporatedTo: "2026-09-01" });
    expect(page.items).toEqual([]);
    expect(page.nextStartIndex).toBeNull();
  });

  it("retries on 429 with backoff and then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return calls <= 2 ? new Response("", { status: 429 }) : jsonResponse({ items: [] });
    });
    await makeClient(fetchImpl as unknown as typeof fetch).getOfficers("12345678");
    expect(calls).toBe(3);
  });

  it("gives up after 5 retries", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 }));
    await expect(makeClient(fetchImpl as unknown as typeof fetch).getOfficers("12345678")).rejects.toThrow(/429/);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("reports an invalid API key clearly", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 401 }));
    await expect(makeClient(fetchImpl as unknown as typeof fetch).getOfficers("1")).rejects.toThrow(
      "Companies House API key is missing or invalid",
    );
  });

  it("maps officers and extracts the officer ID from the appointments link", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        items: [
          {
            name: "SMITH, John",
            officer_role: "director",
            appointed_on: "2026-09-01",
            links: { officer: { appointments: "/officers/abc123XYZ/appointments" } },
          },
          { bogus: true },
        ],
      }),
    );
    const officers = await makeClient(fetchImpl as unknown as typeof fetch).getOfficers("12345678");
    expect(officers).toEqual([
      { officerId: "abc123XYZ", name: "SMITH, John", role: "director", appointedOn: "2026-09-01", resignedOn: null },
    ]);
  });

  it("maps appointments", async () => {
    const fetchImpl = vi.fn(async (_url: string) =>
      jsonResponse({
        items: [
          {
            appointed_on: "2015-01-01",
            officer_role: "director",
            appointed_to: { company_number: "01234567", company_name: "OLD CO LTD", company_status: "active" },
          },
        ],
      }),
    );
    const appts = await makeClient(fetchImpl as unknown as typeof fetch).getOfficerAppointments("abc");
    expect(appts).toEqual([
      { companyNumber: "01234567", companyName: "OLD CO LTD", companyStatus: "active", appointedOn: "2015-01-01", resignedOn: null },
    ]);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("/officers/abc/appointments?items_per_page=50");
  });
});

describe("buildSearchParams", () => {
  it("applies defaults and optional filters", () => {
    const p = buildSearchParams(
      { incorporatedFrom: "2026-09-01", incorporatedTo: "2026-09-30", sicCodes: "43220, 43210", location: " Leeds " },
      5000,
      5000,
    );
    expect(p.get("company_status")).toBe("active");
    expect(p.get("company_type")).toBe("ltd");
    expect(p.getAll("sic_codes")).toEqual(["43220", "43210"]);
    expect(p.get("location")).toBe("Leeds");
    expect(p.get("start_index")).toBe("5000");
    expect(p.get("size")).toBe("5000");
  });
});

describe("eachDay", () => {
  it("lists every date inclusive, across month ends", () => {
    expect(eachDay("2026-08-30", "2026-09-01")).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
    expect(eachDay("2026-09-01", "2026-09-01")).toEqual(["2026-09-01"]);
    expect(eachDay("2026-09-02", "2026-09-01")).toEqual([]);
  });
});

describe("parseOfficerId", () => {
  it("extracts the ID", () => {
    expect(parseOfficerId("/officers/Xy_z-1/appointments")).toBe("Xy_z-1");
    expect(parseOfficerId(undefined)).toBeNull();
    expect(parseOfficerId("/company/123")).toBeNull();
  });
});

describe("selectPrimaryOfficer", () => {
  const officer = (o: Partial<Officer>): Officer => ({
    officerId: "id",
    name: "X",
    role: "director",
    appointedOn: "2026-01-01",
    resignedOn: null,
    ...o,
  });

  it("picks the earliest appointed active director, ignoring resigned ones", () => {
    const result = selectPrimaryOfficer([
      officer({ officerId: "a", name: "A", appointedOn: "2026-03-01" }),
      officer({ officerId: "b", name: "B", appointedOn: "2026-01-01", resignedOn: "2026-02-01" }),
      officer({ officerId: "c", name: "C", appointedOn: "2026-02-01" }),
      officer({ officerId: "s", name: "S", role: "secretary", appointedOn: "2025-01-01" }),
    ]);
    expect(result?.primary.officerId).toBe("c");
    expect(result?.activeNames).toEqual(["A", "C"]);
  });

  it("breaks ties by list order", () => {
    const result = selectPrimaryOfficer([officer({ officerId: "first" }), officer({ officerId: "second" })]);
    expect(result?.primary.officerId).toBe("first");
  });

  it("falls back to any active officer when there are no directors", () => {
    const result = selectPrimaryOfficer([officer({ officerId: "s", role: "secretary" })]);
    expect(result?.primary.officerId).toBe("s");
  });

  it("returns null when no active officer has an ID link", () => {
    expect(selectPrimaryOfficer([])).toBeNull();
    expect(selectPrimaryOfficer([officer({ resignedOn: "2026-01-02" })])).toBeNull();
    expect(selectPrimaryOfficer([officer({ officerId: null })])).toBeNull();
  });
});

describe("selectOtherCompanies", () => {
  const appt = (a: Partial<Appointment>): Appointment => ({
    companyNumber: "0",
    companyName: "X",
    companyStatus: "active",
    appointedOn: "2020-01-01",
    resignedOn: null,
    ...a,
  });

  it("excludes the original, prefers active, then oldest appointment, and limits", () => {
    const result = selectOtherCompanies(
      [
        appt({ companyNumber: "ORIG" }),
        appt({ companyNumber: "D", companyStatus: "dissolved", appointedOn: "2000-01-01" }),
        appt({ companyNumber: "A2", appointedOn: "2018-01-01" }),
        appt({ companyNumber: "A1", appointedOn: "2010-01-01" }),
        appt({ companyNumber: "A3", appointedOn: null }),
      ],
      "orig",
      3,
    );
    expect(result.map((a) => a.companyNumber)).toEqual(["A1", "A2", "A3"]);
  });

  it("deduplicates companies the officer holds several roles in", () => {
    const result = selectOtherCompanies(
      [appt({ companyNumber: "A", appointedOn: "2019-01-01" }), appt({ companyNumber: "A", appointedOn: "2012-01-01" })],
      "ORIG",
      10,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.appointedOn).toBe("2012-01-01");
  });
});
