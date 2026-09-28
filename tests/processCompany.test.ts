import { describe, expect, it, vi } from "vitest";
import type { Appointment, Officer } from "@/lib/companiesHouse";
import { NOTES, processCompanies, processCompany, type ProcessDeps } from "@/lib/processCompany";
import type { PlaceResult, SearchProvider, SearchResult } from "@/lib/search/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const fbPage = (name: string, slug: string): SearchResult => ({
  title: `${name} | Facebook`,
  link: `https://www.facebook.com/${slug}`,
  snippet: null,
});

const place = (title: string, cid: string): PlaceResult => ({
  title,
  address: "1 High St, Leeds LS1 1AA",
  cid,
  mapsUrl: `https://www.google.com/maps?cid=${cid}`,
  website: "https://example.com",
  phoneNumber: "0113 000 0000",
  rating: 4.5,
});

interface MockSetup {
  facebook?: Record<string, SearchResult[]>;
  places?: Record<string, PlaceResult[]>;
  officers?: Officer[];
  appointments?: Appointment[];
  linkedinCompany?: Record<string, SearchResult[]>;
  linkedinPeople?: Record<string, SearchResult[]>;
}

function mockDeps(setup: MockSetup = {}) {
  const search = {
    name: "mock",
    searchFacebook: vi.fn(async (name: string) => setup.facebook?.[name] ?? []),
    searchBusinessProfile: vi.fn(async (name: string) => setup.places?.[name] ?? []),
    searchLinkedInCompany: vi.fn(async (name: string) => setup.linkedinCompany?.[name] ?? []),
    searchLinkedInPeople: vi.fn(async (person: string, _company: string) => setup.linkedinPeople?.[person] ?? []),
  } satisfies SearchProvider;
  const companiesHouse = {
    getOfficers: vi.fn(async (_companyNumber: string) => setup.officers ?? []),
    getOfficerAppointments: vi.fn(async (_officerId: string) => setup.appointments ?? []),
  };
  const deps: ProcessDeps = { companiesHouse, search, matchThreshold: 0.85, maxOwnerCompanies: 10 };
  return { deps, search, companiesHouse };
}

const company = { companyNumber: "15000001", companyName: "ACME PLUMBING LTD", registeredAddress: { locality: "Leeds", postal_code: "LS1 1AA" } };

const director: Officer = {
  officerId: "officer-1",
  name: "SMITH, John",
  role: "director",
  appointedOn: "2026-09-01",
  resignedOn: null,
};

const appt = (companyNumber: string, companyName: string, appointedOn: string): Appointment => ({
  companyNumber,
  companyName,
  companyStatus: "active",
  appointedOn,
  resignedOn: null,
});

// ---------------------------------------------------------------------------
// Spec Section 14 cases
// ---------------------------------------------------------------------------

describe("processCompany", () => {
  it("direct match -> FOUND, BUSINESS", async () => {
    const { deps, companiesHouse } = mockDeps({
      officers: [director, { ...director, officerId: "officer-2", name: "JONES, Amy", appointedOn: "2026-09-02" }],
      facebook: { "ACME PLUMBING LTD": [fbPage("Apex Roofing", "apex"), fbPage("Acme Plumbing", "acmeplumbing")] },
      places: { "ACME PLUMBING LTD": [place("Acme Plumbing", "111")] },
    });
    const outcome = await processCompany(company, deps);

    expect(outcome).toMatchObject({
      status: "FOUND",
      matchSource: "BUSINESS",
      facebookUrl: "https://www.facebook.com/acmeplumbing",
      facebookScore: 1,
      googleBusinessUrl: "https://www.google.com/maps?cid=111",
      googleBusinessName: "Acme Plumbing",
      googleBusinessPhone: "0113 000 0000",
      googleBusinessWebsite: "https://example.com",
      googleBusinessScore: 1,
      matchedViaCompanyName: null,
      officerName: "SMITH, John",
      officerId: "officer-1",
      directorNames: ["SMITH, John", "JONES, Amy"],
      note: null,
      errorMessage: null,
    });
    // Directors are looked up for direct matches, but the fallback never runs.
    expect(companiesHouse.getOfficers).toHaveBeenCalledTimes(1);
    expect(companiesHouse.getOfficerAppointments).not.toHaveBeenCalled();
  });

  it("keeps a direct match FOUND when the director lookup fails", async () => {
    const { deps, companiesHouse } = mockDeps({
      facebook: { "ACME PLUMBING LTD": [fbPage("Acme Plumbing", "acmeplumbing")] },
    });
    companiesHouse.getOfficers.mockRejectedValue(new Error("Companies House request failed (500)"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await processCompany(company, deps)).toMatchObject({ status: "FOUND", officerName: null, directorNames: [], errorMessage: null });
    warn.mockRestore();
  });

  it("no direct match, owner's 2nd other company matches -> FOUND, OWNER_OTHER_BUSINESS, stops after first match", async () => {
    const { deps, search, companiesHouse } = mockDeps({
      officers: [director],
      appointments: [
        appt("15000001", "ACME PLUMBING LTD", "2026-09-01"), // the company itself
        appt("01111111", "SMITH HEATING LIMITED", "2010-01-01"),
        appt("02222222", "SMITH BATHROOMS LTD", "2012-01-01"),
        appt("03333333", "SMITH KITCHENS LTD", "2014-01-01"),
      ],
      facebook: {
        "SMITH BATHROOMS LTD": [fbPage("Smith Bathrooms", "smithbathrooms")],
        "SMITH KITCHENS LTD": [fbPage("Smith Kitchens", "smithkitchens")],
      },
    });
    const outcome = await processCompany(company, deps);

    expect(outcome).toMatchObject({
      status: "FOUND",
      matchSource: "OWNER_OTHER_BUSINESS",
      matchedViaCompanyName: "SMITH BATHROOMS LTD",
      matchedViaCompanyNumber: "02222222",
      officerName: "SMITH, John",
      officerId: "officer-1",
      directorNames: ["SMITH, John"],
      facebookUrl: "https://www.facebook.com/smithbathrooms",
      googleBusinessUrl: null,
    });
    // Direct, then the 1st and 2nd other companies; never the 3rd.
    expect(search.searchFacebook.mock.calls.map((c) => c[0])).toEqual([
      "ACME PLUMBING LTD",
      "SMITH HEATING LIMITED",
      "SMITH BATHROOMS LTD",
    ]);
    // Uses the officer ID link, not a name search.
    expect(companiesHouse.getOfficerAppointments).toHaveBeenCalledWith("officer-1");
  });

  it("no officers -> NO_MATCH with note", async () => {
    const { deps } = mockDeps({ officers: [] });
    expect(await processCompany(company, deps)).toMatchObject({ status: "NO_MATCH", note: NOTES.noOfficers, matchSource: null });
  });

  it("owner has no other companies -> NO_MATCH with note", async () => {
    const { deps } = mockDeps({ officers: [director], appointments: [appt("15000001", "ACME PLUMBING LTD", "2026-09-01")] });
    expect(await processCompany(company, deps)).toMatchObject({
      status: "NO_MATCH",
      note: NOTES.noOtherCompanies,
      officerName: "SMITH, John",
    });
  });

  it("search provider throws -> ERROR, job continues", async () => {
    const { deps, search } = mockDeps({
      facebook: { "WORKS LTD": [fbPage("Works", "works")] },
    });
    search.searchFacebook.mockImplementation(async (name: string) => {
      if (name === "ACME PLUMBING LTD") throw new Error("Serper request failed (500)");
      return name === "WORKS LTD" ? [fbPage("Works", "works")] : [];
    });

    const results = await processCompanies(
      [company, { companyNumber: "15000002", companyName: "WORKS LTD", registeredAddress: null }],
      deps,
    );
    expect(results[0]!.outcome).toMatchObject({ status: "ERROR", errorMessage: "Serper request failed (500)" });
    expect(results[1]!.outcome).toMatchObject({ status: "FOUND", matchSource: "BUSINESS" });
  });

  // -------------------------------------------------------------------------
  // Further cases
  // -------------------------------------------------------------------------

  it("counts a Google Business match alone as found", async () => {
    const { deps } = mockDeps({ places: { "ACME PLUMBING LTD": [place("Acme Plumbing", "111")] } });
    expect(await processCompany(company, deps)).toMatchObject({ status: "FOUND", facebookUrl: null, googleBusinessScore: 1 });
  });

  it("rejects clearly wrong results and falls through to the owner", async () => {
    const { deps, companiesHouse } = mockDeps({
      facebook: { "ACME PLUMBING LTD": [fbPage("Apex Roofing", "apex")] },
      places: { "ACME PLUMBING LTD": [place("Acme Roofing Supplies", "9")] },
      officers: [],
    });
    expect((await processCompany(company, deps)).status).toBe("NO_MATCH");
    expect(companiesHouse.getOfficers).toHaveBeenCalledTimes(1);
  });

  it("goes only one level deep: never fetches officers of the owner's companies", async () => {
    const { deps, companiesHouse } = mockDeps({
      officers: [director],
      appointments: [appt("01111111", "OTHER ONE LTD", "2010-01-01"), appt("02222222", "OTHER TWO LTD", "2011-01-01")],
    });
    const outcome = await processCompany(company, deps);
    expect(outcome).toMatchObject({ status: "NO_MATCH", note: NOTES.noOwnerMatch, officerName: "SMITH, John" });
    expect(companiesHouse.getOfficers).toHaveBeenCalledTimes(1);
    expect(companiesHouse.getOfficers).toHaveBeenCalledWith("15000001");
    expect(companiesHouse.getOfficerAppointments).toHaveBeenCalledTimes(1);
  });

  it("checks at most maxOwnerCompanies of the owner's companies", async () => {
    const { deps, search } = mockDeps({
      officers: [director],
      appointments: Array.from({ length: 8 }, (_, i) => appt(`0${i}`, `OTHER ${i} LTD`, `201${i}-01-01`)),
    });
    await processCompany(company, { ...deps, maxOwnerCompanies: 3 });
    expect(search.searchFacebook).toHaveBeenCalledTimes(1 + 3);
  });

  it("explains when active officers have no appointments link", async () => {
    const { deps } = mockDeps({ officers: [{ ...director, officerId: null }] });
    expect(await processCompany(company, deps)).toMatchObject({ status: "NO_MATCH", note: NOTES.noOfficerLink });
  });

  it("keeps the officer on an error during the owner phase", async () => {
    const { deps, companiesHouse } = mockDeps({ officers: [director] });
    companiesHouse.getOfficerAppointments.mockRejectedValue(new Error("Companies House request failed (500)"));
    expect(await processCompany(company, deps)).toMatchObject({
      status: "ERROR",
      officerName: "SMITH, John",
      errorMessage: "Companies House request failed (500)",
    });
  });

  it("builds a Maps search link when a place has no cid", async () => {
    const { deps } = mockDeps({
      places: { "ACME PLUMBING LTD": [{ ...place("Acme Plumbing", "x"), cid: null, mapsUrl: null }] },
    });
    const outcome = await processCompany(company, deps);
    expect(outcome.googleBusinessUrl).toBe(
      "https://www.google.com/maps/search/?api=1&query=Acme%20Plumbing%201%20High%20St%2C%20Leeds%20LS1%201AA",
    );
  });

  describe("Facebook location check", () => {
    const page = (title: string, snippet: string): SearchResult => ({ title, link: "https://www.facebook.com/acmeplumbing", snippet });
    const leeds = { ...company, registeredAddress: { locality: "Leeds", postal_code: "LS1 1AA" } };

    it("strict: drops a same-named page abroad and falls through to the owner", async () => {
      const { deps, companiesHouse } = mockDeps({
        officers: [],
        facebook: { "ACME PLUMBING LTD": [page("Acme Plumbing | Franklin TN", "Plumbers in Tennessee")] },
      });
      const outcome = await processCompany(leeds, { ...deps, facebookLocationCheck: "strict" });
      expect(outcome).toMatchObject({ status: "NO_MATCH", facebookUrl: null });
      expect(companiesHouse.getOfficers).toHaveBeenCalled();
    });

    it("strict: needs UK evidence when Facebook is the only match", async () => {
      const unknown = mockDeps({ officers: [], facebook: { "ACME PLUMBING LTD": [page("Acme Plumbing", "Plumbing service. 12 likes.")] } });
      expect((await processCompany(leeds, { ...unknown.deps, facebookLocationCheck: "strict" })).status).toBe("NO_MATCH");

      const uk = mockDeps({ officers: [], facebook: { "ACME PLUMBING LTD": [page("Acme Plumbing | Leeds", "Plumbing service. 12 likes.")] } });
      expect(await processCompany(leeds, { ...uk.deps, facebookLocationCheck: "strict" })).toMatchObject({
        status: "FOUND",
        facebookUrl: "https://www.facebook.com/acmeplumbing",
      });
    });

    it("strict: keeps a page with no location when a UK Google listing backs it up", async () => {
      const { deps } = mockDeps({
        facebook: { "ACME PLUMBING LTD": [page("Acme Plumbing", "Plumbing service. 12 likes.")] },
        places: { "ACME PLUMBING LTD": [place("Acme Plumbing", "111")] },
      });
      expect(await processCompany(leeds, { ...deps, facebookLocationCheck: "strict" })).toMatchObject({
        status: "FOUND",
        facebookUrl: "https://www.facebook.com/acmeplumbing",
        googleBusinessUrl: "https://www.google.com/maps?cid=111",
      });
    });

    it("lenient: accepts unknown locations but still drops pages abroad and personal profiles", async () => {
      const unknown = mockDeps({ officers: [], facebook: { "ACME PLUMBING LTD": [page("Acme Plumbing", "Plumbing service. 12 likes.")] } });
      expect((await processCompany(leeds, { ...unknown.deps, facebookLocationCheck: "lenient" })).status).toBe("FOUND");

      const abroad = mockDeps({ officers: [], facebook: { "ACME PLUMBING LTD": [page("Acme Plumbing | Delhi", "Plumbing")] } });
      expect((await processCompany(leeds, { ...abroad.deps, facebookLocationCheck: "lenient" })).status).toBe("NO_MATCH");

      const profile = mockDeps({
        officers: [],
        facebook: { "ACME PLUMBING LTD": [page("Acme Plumbing", "Acme Plumbing is on Facebook. Join Facebook to connect with Acme Plumbing")] },
      });
      expect((await processCompany(leeds, { ...profile.deps, facebookLocationCheck: "lenient" })).status).toBe("NO_MATCH");
    });
  });

  describe("LinkedIn", () => {
    const acmeFound = {
      officers: [director],
      facebook: { "ACME PLUMBING LTD": [fbPage("Acme Plumbing", "acmeplumbing")] },
      linkedinCompany: {
        "ACME PLUMBING LTD": [{ title: "Acme Plumbing | LinkedIn", link: "https://uk.linkedin.com/company/acme-plumbing", snippet: null }],
      },
      linkedinPeople: {
        "John Smith": [
          { title: "John Smith - Director - Acme Plumbing | LinkedIn", link: "https://uk.linkedin.com/in/john-smith-acme", snippet: null },
        ],
      },
    };

    it("adds the company page and the director profile to a found lead", async () => {
      const { deps, search } = mockDeps(acmeFound);
      const outcome = await processCompany(company, { ...deps, linkedin: "found" });
      expect(outcome).toMatchObject({
        status: "FOUND",
        linkedinCompanyUrl: "https://www.linkedin.com/company/acme-plumbing",
        linkedinCompanyScore: 1,
        linkedinDirectorUrl: "https://www.linkedin.com/in/john-smith-acme",
        linkedinDirectorScore: 1,
      });
      expect(search.searchLinkedInPeople).toHaveBeenCalledWith("John Smith", "ACME PLUMBING LTD");
    });

    it("searches the business that was found when the match came via the owner", async () => {
      const { deps, search } = mockDeps({
        officers: [director],
        appointments: [appt("01111111", "SMITH HEATING LIMITED", "2010-01-01")],
        facebook: { "SMITH HEATING LIMITED": [fbPage("Smith Heating", "smithheating")] },
      });
      await processCompany(company, { ...deps, linkedin: "found" });
      expect(search.searchLinkedInCompany).toHaveBeenCalledWith("SMITH HEATING LIMITED");
      expect(search.searchLinkedInPeople).toHaveBeenCalledWith("John Smith", "SMITH HEATING LIMITED");
    });

    it("skips no-match companies unless set to all, and does nothing when off", async () => {
      const noMatch = mockDeps({ officers: [director], appointments: [] });
      await processCompany(company, { ...noMatch.deps, linkedin: "found" });
      expect(noMatch.search.searchLinkedInCompany).not.toHaveBeenCalled();

      const all = mockDeps({ officers: [director], appointments: [] });
      const outcome = await processCompany(company, { ...all.deps, linkedin: "all" });
      expect(outcome.status).toBe("NO_MATCH");
      expect(all.search.searchLinkedInCompany).toHaveBeenCalledWith("ACME PLUMBING LTD");
      expect(all.search.searchLinkedInPeople).toHaveBeenCalledWith("John Smith", "ACME PLUMBING LTD");

      const off = mockDeps(acmeFound);
      expect((await processCompany(company, { ...off.deps, linkedin: "off" })).linkedinCompanyUrl).toBeNull();
      expect(off.search.searchLinkedInCompany).not.toHaveBeenCalled();
    });

    it("keeps the lead FOUND when LinkedIn search fails", async () => {
      const { deps, search } = mockDeps(acmeFound);
      search.searchLinkedInCompany.mockRejectedValue(new Error("serper request failed (500)"));
      search.searchLinkedInPeople.mockRejectedValue(new Error("serper request failed (500)"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const outcome = await processCompany(company, { ...deps, linkedin: "found" });
      warn.mockRestore();
      expect(outcome).toMatchObject({ status: "FOUND", facebookUrl: "https://www.facebook.com/acmeplumbing", linkedinCompanyUrl: null, errorMessage: null });
    });

    it("never searches LinkedIn for errors", async () => {
      const { deps, search } = mockDeps();
      search.searchFacebook.mockRejectedValue(new Error("boom"));
      expect((await processCompany(company, { ...deps, linkedin: "all" })).status).toBe("ERROR");
      expect(search.searchLinkedInCompany).not.toHaveBeenCalled();
    });
  });

  it("processCompanies reports each outcome as it goes", async () => {
    const { deps } = mockDeps();
    const seen: string[] = [];
    await processCompanies([company, { ...company, companyNumber: "2" }], deps, async (c, o) => {
      seen.push(`${c.companyNumber}:${o.status}`);
    });
    expect(seen).toEqual(["15000001:NO_MATCH", "2:NO_MATCH"]);
  });
});
