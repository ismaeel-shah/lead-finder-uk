import { describe, expect, it } from "vitest";
import { fmtCustomFilters, fmtFilters } from "@/components/dashboard/format";
import { buildSearchParams } from "@/lib/companiesHouse";
import { createJobSchema } from "@/lib/jobs";
import { combinedSicCodes, nicheById, nicheGroups, NICHES } from "@/lib/niches";

describe("niches", () => {
  it("have unique ids and five-digit SIC codes", () => {
    expect(new Set(NICHES.map((n) => n.id)).size).toBe(NICHES.length);
    for (const n of NICHES) {
      expect(n.sic.length).toBeGreaterThan(0);
      for (const code of n.sic) expect(code).toMatch(/^\d{5}$/);
    }
  });

  it("groups niches for the dropdown without losing any", () => {
    expect(nicheGroups().flatMap((g) => g.niches)).toHaveLength(NICHES.length);
  });

  it("combines a niche's codes with hand-typed ones, without duplicates", () => {
    expect(combinedSicCodes("plumbing-electrical", null)).toBe("43220,43210");
    expect(combinedSicCodes("plumbing-electrical", "43210, 43999")).toBe("43220,43210,43999");
    expect(combinedSicCodes(null, "43220")).toBe("43220");
    expect(combinedSicCodes(null, "")).toBeUndefined();
    expect(combinedSicCodes("no-such-niche", null)).toBeUndefined();
  });
});

describe("run input", () => {
  const base = { incorporatedFrom: "2026-09-01", incorporatedTo: "2026-09-07" };

  it("accepts a known niche and a name keyword", () => {
    const parsed = createJobSchema.parse({ ...base, niche: "restaurants", nameIncludes: "  pizza " });
    expect(parsed).toMatchObject({ niche: "restaurants", nameIncludes: "pizza" });
  });

  it("rejects an unknown niche", () => {
    expect(createJobSchema.safeParse({ ...base, niche: "astronauts" }).success).toBe(false);
  });
});

describe("Companies House search", () => {
  it("sends the niche's SIC codes and the name keyword", () => {
    const p = buildSearchParams(
      {
        incorporatedFrom: "2026-09-01",
        incorporatedTo: "2026-09-01",
        sicCodes: combinedSicCodes("plumbing-electrical", null),
        nameIncludes: " plumbing ",
      },
      0,
      100,
    );
    expect(p.getAll("sic_codes")).toEqual(["43220", "43210"]);
    expect(p.get("company_name_includes")).toBe("plumbing");
  });
});

describe("run summaries", () => {
  const filters = {
    company_type: "ltd",
    company_status: "active",
    niche: "plumbing-electrical",
    name_includes: "gas",
    location: "Leeds",
    sic_codes: null,
  };

  it("names the niche instead of listing its codes", () => {
    expect(fmtFilters(filters)).toBe("Active · LTD · Plumbing, heating & electrical · name contains “gas” · Leeds");
    expect(fmtCustomFilters(filters)).toBe("Plumbing, heating & electrical · “gas” · Leeds");
    expect(nicheById("plumbing-electrical")?.label).toBe("Plumbing, heating & electrical");
  });
});
