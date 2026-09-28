import { describe, expect, it } from "vitest";
import { classifyLocation, facebookLocationAllowed, facebookTitleLocation, isPersonalProfile, isUkBusinessAddress } from "@/lib/location";

// Every case below is a real Facebook result that was matched during a live run.
const bristol = { locality: "Bristol", postal_code: "BS35 2NP" };
const kind = (title: string, snippet: string, name: string, address: object | null = null) =>
  classifyLocation({ title, snippet }, address, name).kind;

describe("facebookTitleLocation", () => {
  it("reads the town Facebook appends to page titles", () => {
    expect(facebookTitleLocation("Precision Plumbing | Bristol")).toBe("Bristol");
    expect(facebookTitleLocation("Rise Tennis Academy | Franklin TN")).toBe("Franklin TN");
    expect(facebookTitleLocation("Acme Plumbing - Home")).toBeNull();
    expect(facebookTitleLocation("Acme | Facebook")).toBeNull();
  });
});

describe("classifyLocation — pages abroad", () => {
  it.each([
    ["Rise Tennis Academy | Franklin TN", "Spring Clinic and Summer Camp Registration Now Open!!", "RISE TENNIS ACADEMY LTD"],
    ["All-Pro Contractors | Detroit MI", "All-Pro Contractors, Detroit. 41 likes.", "ALL PRO CONTRACTORS LIMITED"],
    ["Bee Carbon | Piracicaba SP", "Entendam o porque do nome Bee Carbon Studio Car!", "BEECARBON LTD"],
    ["Cedar Gardens - Home", "Cedar Gardens, Trenton, NJ. 69 likes · 1586 were here.", "CEDAR GARDENS LIMITED"],
    ["AGM Drywall | Lima", "AGM Drywall: especialistas en drywall en Perú.", "AGM DRYWALL LTD"],
    ["Saw interiors | Delhi", "CDC style office completed in 20 days", "SAW INTERIORS LTD"],
    ["Neptune Creative | Black River", "Neptune Creative, Black River. 525 likes. LARGE FORMAT PRINTING.", "NEPTUNE CREATIVE LTD"],
    ["Honey Badger Creative", "Honey Badger Creative is a Boise-based creative agency.", "HONEYBADGER CREATIVE LTD"],
    ["4CAFE (@4cafeoficial)", "Page · Restaurant. 4cafe.com.mx. Posts.", "4CAFE LTD"],
    ["Digger's Cafe | Truro NS", "Downtown Truro, Nova Scotia", "DIGGERS CAFE LTD"],
    ["Precision Plumbing", "Plumbing in Media. Call (610) 440-3326", "PRECISION PLUMBING SW LTD"],
    ["XEN (@wearexen)", "Progressive Metal band from Australia (no longer active)", "XEN LTD"],
  ])("%s is foreign", (title, snippet, name) => {
    expect(kind(title, snippet, name)).toBe("foreign");
  });
});

describe("classifyLocation — UK pages", () => {
  it.each([
    ["Precision Plumbing | Bristol", "Precision Plumbing SW Ltd has availability for everyday plumbing", "PRECISION PLUMBING SW LTD", bristol],
    ["Anglian Plumbing & Heating - Home", "Anglian Plumbing & Heating, King's Lynn, UK. 1 like.", "ANGLIAN PLUMBING & HEATING LIMITED", null],
    ["Crighton Repair & Service (@CrightonRS)", "Crighton Repair & Service, Burntwood. 77 followers", "CRIGHTON REPAIR & SERVICE LTD", null],
    ["SMITH Scaffolding | Newton Abbot", "Smith Scaffolding is a family-run scaffolding company", "SMITH SCAFFOLDING LIMITED", null],
    ["Pristine Smart Repairs", "Pristine vehicle smart repairs mobile based in Cardiff and surrounding areas.", "PRISTINE SMART REPAIRS LTD", null],
    ["Acme Plumbing", "Call 07700 900123 for a quote", "ACME PLUMBING LTD", null],
    ["Acme Plumbing", "Visit acmeplumbing.co.uk", "ACME PLUMBING LTD", null],
  ])("%s is UK", (title, snippet, name, address) => {
    expect(kind(title, snippet, name, address)).toBe("uk");
  });

  it("lets UK evidence beat a country named in passing", () => {
    expect(kind("Taste of Jamaica | Birmingham", "Authentic food from Jamaica", "TASTE OF JAMAICA LTD")).toBe("uk");
    expect(kind("Bella Cucina", "Family recipes from Italy, served in Leeds", "BELLA CUCINA LTD")).toBe("uk");
  });

  it("does not read 'New York' as York or 'for sale' as Sale", () => {
    expect(kind("Acme Studio", "Based in New York", "ACME STUDIO LTD")).toBe("foreign");
    expect(kind("Acme Motors", "Used cars for sale", "ACME MOTORS LTD")).toBe("unknown");
  });

  it("ignores place words that are part of the company's own name", () => {
    expect(kind("Paris Nails", "Nail salon. 120 likes.", "PARIS NAILS LTD")).toBe("unknown");
  });
});

describe("personal profiles", () => {
  it.each([
    "Yan Lucas Ferreira is on Facebook. Join Facebook to connect with Yan Lucas Ferreira and others you may know.",
    "Andrade Brothers ; Lives in London, United Kingdom ; Works at Painting and Decorating",
    "Profile photo of Elizabeth. Elizabeth Connor. Nurse in the community.",
  ])("recognises %s", (snippet) => {
    expect(isPersonalProfile(snippet)).toBe(true);
  });

  it("does not flag business pages", () => {
    expect(isPersonalProfile("Our team works at sites across Kent. 200 likes.")).toBe(false);
    expect(isPersonalProfile("Precision Plumbing SW Ltd has availability for everyday plumbing")).toBe(false);
  });
});

describe("isUkBusinessAddress (Google listings)", () => {
  it.each([
    "1 New St, Musselburgh EH21 6HY",
    "Ste 49, 186 St Albans Rd, Watford WD24 4AS",
    "151 Sydney St, Greater, London SW3 6NT",
    "Mongeham Farm, Northbourne Rd, Great Mongeham, Deal CT14 0HB, United Kingdom",
    "Leeds",
    "237-239 Chillingham Rd", // Newcastle upon Tyne, street only
    "433 Ranglet Rd", // Preston, street only
    null,
    "",
  ])("keeps %j", (address) => {
    expect(isUkBusinessAddress(address)).toBe(true);
  });

  it.each([
    "Precision   Plumbing, 5 Glen Riddle Rd, Media, PA 19063",
    "MVPG G88, 310国道 Gongyi, Zhengzhou, Henan, China, 451285",
    "17 Retirement Rd, Kingston, Jamaica",
    "1, Moldova",
    "Edificio Altius Medical, Manzana 801 Solar 3, 090506 Guayaquil, Ecuador",
    "Skopje, North Macedonia",
    "Mala Raduča 24, 22202, Primošten, Croatia",
    "B1884BBE, C. 6 3658, B1884BBE Berazategui, Provincia de Buenos Aires, Argentina",
  ])("rejects %j", (address) => {
    expect(isUkBusinessAddress(address)).toBe(false);
  });
});

describe("facebookLocationAllowed", () => {
  const unknownPage = { title: "Aura & Olive", snippet: "Aura & Olive. 1 like. Beauty, cosmetic & personal care." };
  const foreignPage = { title: "Saw interiors | Delhi", snippet: "Office fit-out" };
  const ukPage = { title: "Precision Plumbing | Bristol", snippet: "Plumbing and heating" };
  const profile = { title: "Monty Kale", snippet: "Monty Kale is on Facebook. Join Facebook to connect with Monty Kale" };

  it("needs UK evidence for a Facebook-only match", () => {
    expect(facebookLocationAllowed(ukPage, bristol, "PRECISION PLUMBING SW LTD", true)).toBe(true);
    expect(facebookLocationAllowed(unknownPage, null, "AURA & OLIVE LTD", true)).toBe(false);
  });

  it("accepts an unknown location when a Google listing backs the lead up", () => {
    expect(facebookLocationAllowed(unknownPage, null, "AURA & OLIVE LTD", false)).toBe(true);
  });

  it("never accepts pages abroad or personal profiles", () => {
    expect(facebookLocationAllowed(foreignPage, null, "SAW INTERIORS LTD", false)).toBe(false);
    expect(facebookLocationAllowed(profile, null, "MONTY KALE LIMITED", false)).toBe(false);
  });
});
