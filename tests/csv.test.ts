import { describe, expect, it } from "vitest";
import { BOM, CSV_HEADER, csvField, csvFilename, csvLine, resultToCsvLine } from "@/lib/csv";

describe("csvField", () => {
  it.each([
    ["plain", "plain"],
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ["line1\nline2", '"line1\nline2"'],
    ["cr\r\n", '"cr\r\n"'],
    ["", ""],
  ])("%j -> %j", (input, expected) => {
    expect(csvField(input)).toBe(expected);
  });

  it("writes nulls as empty and numbers as-is", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
    expect(csvField(0.857)).toBe("0.857");
  });

  it("neutralises values a spreadsheet would run as formulas", () => {
    expect(csvField("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField("+44 7493 701629")).toBe("'+44 7493 701629");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvField("-1")).toBe("'-1");
  });
});

describe("CSV rows", () => {
  it("has the spec's header in order", () => {
    expect(csvLine(CSV_HEADER)).toBe(
      "company_name,company_number,incorporation_date,status,facebook_url,google_business_url,google_business_name,google_business_address,google_business_phone,google_business_website,match_source,matched_via_company,matched_via_company_number,officer_name,facebook_score,google_business_score,note,linkedin_company_url,linkedin_director_url\r\n",
    );
    expect(BOM).toBe("﻿");
  });

  const base = {
    companyName: "SMITH, JONES & CO LTD",
    companyNumber: "12345678",
    incorporationDate: new Date("2026-09-01T00:00:00Z"),
    status: "FOUND" as const,
    facebookUrl: "https://www.facebook.com/smithjones",
    googleBusinessUrl: null,
    googleBusinessName: null,
    googleBusinessAddress: null,
    googleBusinessPhone: null,
    googleBusinessWebsite: null,
    matchSource: "OWNER_OTHER_BUSINESS" as const,
    matchedViaCompanyName: "SMITH BUILDERS LTD",
    matchedViaCompanyNumber: "01234567",
    officerName: "SMITH, John",
    facebookScore: 0.95,
    googleBusinessScore: null,
    note: null,
    errorMessage: null,
    linkedinCompanyUrl: "https://www.linkedin.com/company/smith-jones",
    linkedinDirectorUrl: null,
  };

  it("maps a result to one line with YYYY-MM-DD dates and lowercase codes", () => {
    expect(resultToCsvLine(base)).toBe(
      '"SMITH, JONES & CO LTD",12345678,2026-09-01,found,https://www.facebook.com/smithjones,,,,,,owner_other_business,SMITH BUILDERS LTD,01234567,"SMITH, John",0.95,,,https://www.linkedin.com/company/smith-jones,\r\n',
    );
  });

  it("uses match_source business and puts error messages in the note", () => {
    const line = resultToCsvLine({ ...base, status: "ERROR", matchSource: null, errorMessage: "Serper request failed (500)" });
    expect(line.endsWith(",error: Serper request failed (500),https://www.linkedin.com/company/smith-jones,\r\n")).toBe(true);
    expect(resultToCsvLine({ ...base, matchSource: "BUSINESS" })).toContain(",business,");
  });

  it("names the file after the date range", () => {
    expect(csvFilename("2026-09-01", "2026-09-07")).toBe("leads-2026-09-01_to_2026-09-07.csv");
    expect(csvFilename("2026-09-01", "2026-09-01")).toBe("leads-2026-09-01.csv");
  });
});
