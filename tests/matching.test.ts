import { describe, expect, it } from "vitest";
import {
  cleanFacebookTitle,
  isUkAddress,
  mentionsLocation,
  normaliseCompanyName,
  normaliseFacebookUrl,
  pickBestFacebookResult,
  pickBestPlace,
  postcodeOutward,
  searchName,
  similarity,
  tokenSetRatio,
} from "@/lib/matching";

describe("normaliseCompanyName", () => {
  // Spec Section 14
  it.each([
    ["ACME PLUMBING LTD", "acme plumbing"],
    ["Smith & Sons Limited", "smith and sons"],
    ["J.K. Builders (UK) Ltd.", "jk builders"],
  ])("%s -> %s", (input, expected) => {
    expect(normaliseCompanyName(input)).toBe(expected);
  });

  it.each([
    ["  The   Acme  Plumbing   Company  ", "the acme plumbing"],
    ["ACME UK LTD", "acme"],
    ["Acme Services UK", "acme services uk"],
    ["Provenance Potatoes Holdings Limited", "provenance potatoes"],
    ["Acme Group Holdings PLC", "acme"],
    ["Bloggs & Co", "bloggs"],
    ["Bloggs & Co. Ltd", "bloggs"],
    ["O'Brien's Café Ltd", "obriens cafe"],
    ["A-1 Roofing/Guttering!", "a 1 roofing guttering"],
    ["GreenLeaf LLP", "greenleaf"],
    ["Hope Community CIC", "hope community"],
  ])("%s -> %s", (input, expected) => {
    expect(normaliseCompanyName(input)).toBe(expected);
  });

  it("never strips a name down to nothing", () => {
    expect(normaliseCompanyName("Holdings Ltd")).toBe("holdings");
    expect(normaliseCompanyName("Company Limited")).toBe("company");
  });

  it("applies configurable stopwords", () => {
    expect(normaliseCompanyName("The Acme Services Ltd", { stopwords: ["the", "services"] })).toBe("acme");
  });
});

describe("searchName", () => {
  it.each([
    ["ACME PLUMBING LTD", "Acme Plumbing"],
    ["Smith & Sons Limited", "Smith & Sons"],
    ["J.K. Builders (UK) Ltd.", "J.K. Builders"],
    ["ACME UK LTD", "Acme"],
    ["McDonald Holdings Ltd", "McDonald Holdings"],
    ["LIMITED", "Limited"],
    ["HASTREN CO., LTD", "Hastren"],
    ["Bloggs & Co", "Bloggs"],
    ["BRITANNIA BUSINESS SCHOOL (UK) LIMITED", "Britannia Business School"],
  ])("%s -> %s", (input, expected) => {
    expect(searchName(input)).toBe(expected);
  });
});

describe("similarity", () => {
  // Spec Section 14
  it('"Acme Plumbing" vs cleaned "Acme Plumbing | Facebook" >= 0.95', () => {
    expect(similarity("Acme Plumbing", cleanFacebookTitle("Acme Plumbing | Facebook"))).toBeGreaterThanOrEqual(0.95);
  });

  it('"Acme Plumbing" vs "Apex Roofing" < 0.6', () => {
    expect(similarity("Acme Plumbing", "Apex Roofing")).toBeLessThan(0.6);
  });

  it('"Smith and Sons" vs "Smith & Sons Builders" >= 0.7', () => {
    expect(similarity("Smith and Sons", "Smith & Sons Builders")).toBeGreaterThanOrEqual(0.7);
  });

  it("ignores legal suffixes and case", () => {
    expect(similarity("ACME PLUMBING LTD", "Acme Plumbing")).toBe(1);
  });

  it("tolerates small spelling differences", () => {
    expect(similarity("Acme Plumbing", "Acme Plumbng")).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps similar-looking but different businesses below the default threshold", () => {
    expect(similarity("Smith Builders", "Smith Brothers")).toBeLessThan(0.85);
    expect(similarity("Acme Plumbing", "Acme Roofing")).toBeLessThan(0.85);
  });

  it("rejects names whose short words (acronyms, numbers) differ", () => {
    // Seen on live results: a Bristol company matched a different business.
    expect(similarity("SCN Refrigeration Ltd", "NCS Refrigeration")).toBeLessThan(0.85);
    expect(similarity("A1 Roofing", "A2 Roofing")).toBeLessThan(0.85);
    expect(similarity("JK Builders", "JKL Builders")).toBeLessThan(0.85);
  });

  it("still accepts an extra short word on one side and typos in long words", () => {
    expect(similarity("Precision Plumbing SW Ltd", "Precision Plumbing")).toBeGreaterThanOrEqual(0.85);
    expect(similarity("Acme Plumbing", "Acme Plumbng")).toBeGreaterThanOrEqual(0.9);
    expect(similarity("J.K. Builders Ltd", "JK Builders")).toBe(1);
  });

  it("returns 0 for empty names", () => {
    expect(similarity("", "Acme")).toBe(0);
  });

  it("token set ratio divides by the larger set", () => {
    expect(tokenSetRatio("smith and sons", "smith and sons builders")).toBe(0.75);
  });
});

describe("cleanFacebookTitle", () => {
  it.each([
    ["Acme Plumbing | Facebook", "Acme Plumbing"],
    ["Acme Plumbing - Facebook", "Acme Plumbing"],
    ["Acme Plumbing Facebook", "Acme Plumbing"],
    ["Acme Plumbing - Home | Facebook", "Acme Plumbing"],
    ["Acme Plumbing | Home", "Acme Plumbing"],
    ["Acme Plumbing (@acmeplumbing) • Facebook", "Acme Plumbing"],
    ["Acme Plumbing - Manchester | Facebook", "Acme Plumbing"],
  ])("%s -> %s", (input, expected) => {
    expect(cleanFacebookTitle(input)).toBe(expected);
  });

  it("matches a title with a location after | (seen on live results)", () => {
    const best = pickBestFacebookResult(
      "PROVENANCE POTATOES LIMITED",
      [{ title: "Provenance Potatoes Limited | Great Mongeham", link: "https://www.facebook.com/ProvenancePotatoesLimited" }],
      { threshold: 0.85 },
    );
    expect(best?.url).toBe("https://www.facebook.com/ProvenancePotatoesLimited");
    expect(best?.score).toBe(1);
  });

  it("still matches a name that itself contains ' - '", () => {
    const best = pickBestFacebookResult(
      "Acme - The Plumbers Ltd",
      [{ title: "Acme - The Plumbers | Facebook", link: "https://www.facebook.com/acmetheplumbers" }],
      { threshold: 0.85 },
    );
    expect(best?.score).toBe(1);
  });
});

describe("normaliseFacebookUrl", () => {
  // Spec Section 14
  it("accepts a page URL", () => {
    expect(normaliseFacebookUrl("https://facebook.com/acmeplumbing")).toBe("https://www.facebook.com/acmeplumbing");
  });

  it.each([
    "https://www.facebook.com/groups/12345/",
    "https://www.facebook.com/acmeplumbing/posts/pfbid0abc",
    "https://www.facebook.com/login/?next=x",
    "https://www.facebook.com/login.php",
    "https://www.facebook.com/sharer.php?u=x",
    "https://www.facebook.com/sharer/sharer.php?u=x",
    "https://www.facebook.com/events/123",
    "https://www.facebook.com/acme/photos/a.1/2",
    "https://www.facebook.com/acme/videos/123",
    "https://www.facebook.com/marketplace/item/1",
    "https://www.facebook.com/watch/?v=1",
    "https://www.facebook.com/story.php?story_fbid=1",
    "https://www.facebook.com/permalink.php?story_fbid=1",
    "https://www.facebook.com/people/John-Smith/100012345",
    "https://www.facebook.com/",
    "https://notfacebook.com/acme",
    "https://facebook.com.evil.example/acme",
    "not a url",
  ])("rejects %s", (url) => {
    expect(normaliseFacebookUrl(url)).toBeNull();
  });

  it("normalises host, strips query strings and sub-pages", () => {
    expect(normaliseFacebookUrl("https://m.facebook.com/acmeplumbing/?ref=page_internal")).toBe(
      "https://www.facebook.com/acmeplumbing",
    );
    expect(normaliseFacebookUrl("https://en-gb.facebook.com/acmeplumbing/about/")).toBe(
      "https://www.facebook.com/acmeplumbing",
    );
  });

  it("does not confuse page names with rejected segments", () => {
    expect(normaliseFacebookUrl("https://www.facebook.com/sharedspaces")).toBe("https://www.facebook.com/sharedspaces");
  });

  it("keeps multi-segment and profile.php page formats", () => {
    expect(normaliseFacebookUrl("https://www.facebook.com/pages/Acme-Plumbing/123456789/")).toBe(
      "https://www.facebook.com/pages/Acme-Plumbing/123456789",
    );
    expect(normaliseFacebookUrl("https://www.facebook.com/p/Acme-Plumbing-100063/")).toBe(
      "https://www.facebook.com/p/Acme-Plumbing-100063",
    );
    expect(normaliseFacebookUrl("https://www.facebook.com/profile.php?id=100063&sk=about")).toBe(
      "https://www.facebook.com/profile.php?id=100063",
    );
    expect(normaliseFacebookUrl("https://www.facebook.com/profile.php")).toBeNull();
  });

  it("allows /people/ only when enabled", () => {
    expect(normaliseFacebookUrl("https://www.facebook.com/people/Acme-Plumbing/100012345/", { allowPeople: true })).toBe(
      "https://www.facebook.com/people/Acme-Plumbing/100012345",
    );
  });
});

describe("location bonus", () => {
  const address = { locality: "Manchester", postal_code: "M1 1AA" };

  it("extracts the postcode district", () => {
    expect(postcodeOutward("M1 1AA")).toBe("M1");
    expect(postcodeOutward("b152tt")).toBe("B15");
    expect(postcodeOutward("SW1A 1AA")).toBe("SW1A");
    expect(postcodeOutward("nonsense")).toBeNull();
  });

  it("detects the town or postcode district as whole words", () => {
    expect(mentionsLocation("Plumbers in Manchester city centre", address)).toBe(true);
    expect(mentionsLocation("12 High St, M1 4BT", address)).toBe(true);
    expect(mentionsLocation("Unit M12, Leeds", address)).toBe(false);
    expect(mentionsLocation(null, address)).toBe(false);
  });

  it("lifts a borderline match over the threshold, capped at 1", () => {
    const results = [{ title: "Acme Plumbing Manchester", link: "https://www.facebook.com/acmemcr", snippet: "Plumbers in Manchester" }];
    const without = pickBestFacebookResult("Acme Plumbing Ltd", results, { threshold: 0 });
    const withBonus = pickBestFacebookResult("Acme Plumbing Ltd", results, { threshold: 0, address });
    expect(withBonus!.score).toBeCloseTo(without!.score + 0.05, 5);

    const exact = pickBestPlace("Acme Plumbing", [{ title: "Acme Plumbing", address: "Manchester" }], { threshold: 0.85, address });
    expect(exact?.score).toBe(1);
  });
});

describe("pickBestFacebookResult", () => {
  it("skips non-page URLs and wrong businesses, and picks the best match", () => {
    const results = [
      { title: "Apex Roofing | Facebook", link: "https://www.facebook.com/apexroofing" }, // ranks first, wrong business
      { title: "Acme Plumbing Fans", link: "https://www.facebook.com/groups/acmefans" }, // group
      { title: "Acme Plumbng | Facebook", link: "https://www.facebook.com/acmeplumbng" }, // close
      { title: "Acme Plumbing | Facebook", link: "https://m.facebook.com/acmeplumbing?ref=x" }, // exact
    ];
    const best = pickBestFacebookResult("ACME PLUMBING LTD", results, { threshold: 0.85 });
    expect(best?.url).toBe("https://www.facebook.com/acmeplumbing");
    expect(best?.score).toBe(1);
  });

  it("returns null when nothing passes the threshold", () => {
    const best = pickBestFacebookResult(
      "Acme Plumbing Ltd",
      [{ title: "Apex Roofing | Facebook", link: "https://www.facebook.com/apexroofing" }],
      { threshold: 0.85 },
    );
    expect(best).toBeNull();
  });
});

describe("pickBestPlace", () => {
  it("picks the highest score and keeps search order on ties", () => {
    const places = [
      { title: "Acme Plumbing", address: "Leeds", cid: "1" },
      { title: "Acme Plumbing", address: "York", cid: "2" },
      { title: "Acme Heating", cid: "3" },
    ];
    expect(pickBestPlace("Acme Plumbing Ltd", places, { threshold: 0.85 })?.candidate.cid).toBe("1");
  });

  it("uses the location bonus to choose between same-named places", () => {
    const places = [
      { title: "Acme Plumbing", address: "Leeds LS1 1AA", cid: "leeds" },
      { title: "Acme Plumbing", address: "Manchester M1 2AB", cid: "mcr" },
    ];
    const best = pickBestPlace("Acme Plumbing Ltd", places, { threshold: 0.85, address: { locality: "Manchester", postal_code: "M1 1AA" } });
    expect(best?.candidate.cid).toBe("mcr");
  });
});

describe("isUkAddress", () => {
  it.each([
    "Mongeham Farm, Northbourne Rd, Great Mongeham, Deal CT14 0HB, United Kingdom",
    "Swan Ave, Upminster RM14 1EG",
    "Belfast, Northern Ireland",
    "Leeds",
    "",
    null,
  ])("keeps %j", (address) => {
    expect(isUkAddress(address)).toBe(true);
  });

  it.each([
    "Precision Plumbing, 5 Glen Riddle Rd, Media, PA 19063", // seen on live results
    "820 Greenbrier Cir Ste 14, Chesapeake, VA 23320-1234",
    "100 Queen St W, Toronto, ON M5H 2N2",
    "12 Grafton St, Dublin, Ireland",
    "Sydney NSW, Australia",
  ])("rejects %j", (address) => {
    expect(isUkAddress(address)).toBe(false);
  });
});