import { describe, expect, it } from "vitest";
import {
  cleanLinkedInTitle,
  linkedInTitleParts,
  nameMatches,
  normaliseLinkedInCompanyUrl,
  normaliseLinkedInProfileUrl,
  parseOfficerName,
  pickBestLinkedInCompany,
  pickBestLinkedInProfile,
  PROFILE_SCORE_COMPANY,
  PROFILE_SCORE_LOCATION,
} from "@/lib/linkedin";

describe("LinkedIn URLs", () => {
  it("normalises company pages", () => {
    expect(normaliseLinkedInCompanyUrl("https://uk.linkedin.com/company/precision-plumbing-sw/about?trk=x")).toBe(
      "https://www.linkedin.com/company/precision-plumbing-sw",
    );
    expect(normaliseLinkedInCompanyUrl("https://linkedin.com/company/acme")).toBe("https://www.linkedin.com/company/acme");
  });

  it.each([
    "https://www.linkedin.com/in/thomas-milward",
    "https://www.linkedin.com/company/",
    "https://www.linkedin.com/jobs/view/123",
    "https://www.linkedin.com/posts/acme_activity-1",
    "https://notlinkedin.com/company/acme",
    "https://linkedin.com.evil.example/company/acme",
    "nonsense",
  ])("rejects %s as a company page", (url) => {
    expect(normaliseLinkedInCompanyUrl(url)).toBeNull();
  });

  it("normalises profiles and rejects everything else", () => {
    expect(normaliseLinkedInProfileUrl("https://uk.linkedin.com/in/thomas-milward-12ab34/?originalSubdomain=uk")).toBe(
      "https://www.linkedin.com/in/thomas-milward-12ab34",
    );
    expect(normaliseLinkedInProfileUrl("https://www.linkedin.com/pub/dir/Thomas/Milward")).toBeNull();
    expect(normaliseLinkedInProfileUrl("https://www.linkedin.com/company/acme")).toBeNull();
  });
});

describe("LinkedIn titles", () => {
  it("strips LinkedIn's decoration", () => {
    expect(cleanLinkedInTitle("Precision Plumbing SW | LinkedIn")).toBe("Precision Plumbing SW");
    expect(cleanLinkedInTitle("Acme Ltd - LinkedIn")).toBe("Acme Ltd");
    expect(cleanLinkedInTitle("Thomas Milward on LinkedIn")).toBe("Thomas Milward");
  });

  it("splits profile titles into name, headline and company", () => {
    expect(linkedInTitleParts("Thomas Milward - Owner - Precision Plumbing SW Ltd | LinkedIn")).toEqual([
      "Thomas Milward",
      "Owner",
      "Precision Plumbing SW Ltd",
    ]);
  });
});

describe("officer names", () => {
  it("parses Companies House 'SURNAME, Forenames'", () => {
    expect(parseOfficerName("MILWARD, Thomas Andrew")).toEqual({ first: "Thomas", last: "Milward" });
    expect(parseOfficerName("O'BRIEN, Dr Sean")).toEqual({ first: "Sean", last: "O'Brien" });
    expect(parseOfficerName("SMITH-JONES, Amy")).toEqual({ first: "Amy", last: "Smith-Jones" });
    expect(parseOfficerName("ACME NOMINEES LIMITED")).toBeNull(); // corporate officer
  });

  it("matches first name and surname as whole words", () => {
    const person = { first: "Thomas", last: "Milward" };
    expect(nameMatches("Thomas Milward", person)).toBe(true);
    expect(nameMatches("Thomas A. Milward", person)).toBe(true);
    expect(nameMatches("Tom Milward", person)).toBe(false);
    expect(nameMatches("Thomas Milwards", person)).toBe(false);
    expect(nameMatches("Amy Smith Jones", { first: "Amy", last: "Smith-Jones" })).toBe(true);
  });
});

describe("pickBestLinkedInCompany", () => {
  const opts = { threshold: 0.85 };

  it("picks the matching company page and ignores other pages and profiles", () => {
    const best = pickBestLinkedInCompany(
      "PRECISION PLUMBING SW LTD",
      [
        { title: "Precision Plumbing Inc. | LinkedIn", link: "https://www.linkedin.com/company/precision-plumbing-inc" },
        { title: "Thomas Milward - Precision Plumbing SW | LinkedIn", link: "https://www.linkedin.com/in/thomas-milward" },
        { title: "Precision Plumbing SW Ltd | LinkedIn", link: "https://uk.linkedin.com/company/precision-plumbing-sw" },
      ],
      opts,
    );
    expect(best?.url).toBe("https://www.linkedin.com/company/precision-plumbing-sw");
    expect(best?.score).toBe(1);
  });

  it("returns null when no page is close enough", () => {
    expect(
      pickBestLinkedInCompany("SCN Refrigeration Ltd", [{ title: "NCS Refrigeration | LinkedIn", link: "https://www.linkedin.com/company/ncs" }], opts),
    ).toBeNull();
  });
});

describe("pickBestLinkedInProfile", () => {
  const person = { first: "Thomas", last: "Milward" };
  const opts = { threshold: 0.85, address: { locality: "Bristol", postal_code: "BS35 2NP" } };

  it("accepts a profile that names one of the director's companies", () => {
    const best = pickBestLinkedInProfile(
      person,
      ["PRECISION PLUMBING SW LTD"],
      [
        { title: "Thomas Milward - Sales Manager - Unrelated Corp | LinkedIn", link: "https://www.linkedin.com/in/other-thomas" },
        { title: "Thomas Milward - Director - Precision Plumbing SW | LinkedIn", link: "https://uk.linkedin.com/in/thomas-milward-abc" },
      ],
      opts,
    );
    expect(best?.url).toBe("https://www.linkedin.com/in/thomas-milward-abc");
    expect(best?.score).toBe(PROFILE_SCORE_COMPANY);
  });

  it("finds the company in the snippet too", () => {
    const best = pickBestLinkedInProfile(
      person,
      ["PRECISION PLUMBING SW LTD"],
      [{ title: "Thomas Milward | LinkedIn", link: "https://www.linkedin.com/in/tm", snippet: "Owner at Precision Plumbing SW. Gas Safe engineer." }],
      opts,
    );
    expect(best?.score).toBe(PROFILE_SCORE_COMPANY);
  });

  it("falls back to the registered office area with a lower score", () => {
    const best = pickBestLinkedInProfile(
      person,
      ["PRECISION PLUMBING SW LTD"],
      [{ title: "Thomas Milward - Plumber | LinkedIn", link: "https://www.linkedin.com/in/tm", snippet: "Bristol, England, United Kingdom" }],
      opts,
    );
    expect(best?.score).toBe(PROFILE_SCORE_LOCATION);
  });

  it("never accepts a bare name match, a different person, or a non-profile link", () => {
    expect(
      pickBestLinkedInProfile(
        person,
        ["PRECISION PLUMBING SW LTD"],
        [
          { title: "Thomas Milward - Accountant | LinkedIn", link: "https://www.linkedin.com/in/tm", snippet: "Leeds, England" },
          { title: "Tom Milward - Precision Plumbing SW | LinkedIn", link: "https://www.linkedin.com/in/tom" },
          { title: "Thomas Milward - Precision Plumbing SW | LinkedIn", link: "https://www.linkedin.com/company/pp" },
        ],
        opts,
      ),
    ).toBeNull();
  });
});
