import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { explain, writeLeadsWorkbook, xlsxFilename, type ExportJob, type ExportRow } from "@/lib/xlsx";

const base: ExportRow = {
  companyName: "PRECISION PLUMBING SW LTD",
  companyNumber: "17440194",
  incorporationDate: new Date("2026-09-05T00:00:00Z"),
  registeredAddress: { address_line_1: "8 Tyne House", locality: "Bristol", postal_code: "BS35 2NP" },
  sicCodes: ["43220"],
  status: "FOUND",
  facebookUrl: "https://www.facebook.com/p/Precision-Plumbing-61557539574713",
  facebookScore: 0.857,
  googleBusinessUrl: null,
  googleBusinessName: null,
  googleBusinessAddress: null,
  googleBusinessPhone: "+44 117 000 0000",
  googleBusinessWebsite: "https://www.precisionplumbing.example/",
  googleBusinessScore: null,
  linkedinCompanyUrl: "https://www.linkedin.com/company/precision-plumbing-sw",
  linkedinDirectorUrl: "https://www.linkedin.com/in/thomas-milward",
  linkedinDirectorScore: 0.9,
  matchSource: "BUSINESS",
  matchedViaCompanyName: null,
  officerName: "MILWARD, Thomas Andrew",
  directorNames: ["MILWARD, Thomas Andrew", "SELWOOD, Joshua Shaun"],
  note: null,
  errorMessage: null,
};

const noMatch: ExportRow = {
  ...base,
  companyName: "SCN REFRIGERATION LTD",
  companyNumber: "17432525",
  status: "NO_MATCH",
  facebookUrl: null,
  facebookScore: null,
  googleBusinessPhone: null,
  googleBusinessWebsite: null,
  linkedinCompanyUrl: null,
  linkedinDirectorUrl: null,
  linkedinDirectorScore: null,
  matchSource: null,
  officerName: "CRISP, Cassandra",
  directorNames: ["CRISP, Cassandra"],
  note: "owner has no other companies",
};

const job: ExportJob = {
  incorporatedFrom: "2026-09-01",
  incorporatedTo: "2026-09-07",
  filters: { company_type: "ltd", company_status: "active", sic_codes: "43220", location: "Bristol" },
  totalCompanies: 2,
  processedCount: 2,
  foundCount: 1,
  noMatchCount: 1,
  errorCount: 0,
  searchCreditsUsed: 9,
  viaOwnerCount: 0,
};

async function* once(rows: ExportRow[]) {
  yield rows;
}

async function build(rowsFound: ExportRow[], rowsAll: ExportRow[]): Promise<ExcelJS.Workbook> {
  const out = new PassThrough();
  const parts: Buffer[] = [];
  out.on("data", (b: Buffer) => parts.push(b));
  const done = new Promise((r) => out.on("end", r));
  await writeLeadsWorkbook(out, job, { found: () => once(rowsFound), all: () => once(rowsAll) }, new Date("2026-09-27T12:00:00Z"));
  await done;
  const wb = new ExcelJS.Workbook();
  // exceljs types its Buffer against older @types/node.
  await wb.xlsx.load(Buffer.concat(parts) as unknown as ExcelJS.Buffer);
  return wb;
}

describe("Excel export", () => {
  it("has Summary, Leads and All companies sheets", async () => {
    const wb = await build([base], [base, noMatch]);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Leads", "All companies"]);

    const summary = wb.getWorksheet("Summary")!;
    const cells = summary.getColumn(2).values.filter(Boolean).map(String);
    expect(cells).toContain("Lead Finder — lead export");
    expect(cells).toContain("Companies incorporated 1 Sept – 7 Sept 2026");
    expect(cells.some((c) => c.startsWith("Filters: Active · LTD · SIC 43220 · Bristol"))).toBe(true);
  });

  it("formats the Leads sheet: header, links, people, confidence, frozen header and filters", async () => {
    const ws = (await build([base], [base, noMatch])).getWorksheet("Leads")!;
    const header = ws.getRow(1).values as string[];
    expect(header.slice(1, 5)).toEqual(["Company", "Company no.", "Incorporated", "Director"]);
    expect(ws.getRow(1).getCell(1).fill).toMatchObject({ fgColor: { argb: "FF4F46E5" } });

    const row = ws.getRow(2);
    const col = (name: string) => row.getCell(header.indexOf(name));
    expect(col("Company").value).toBe("PRECISION PLUMBING SW LTD");
    expect(col("Company no.").value).toMatchObject({
      text: "17440194",
      hyperlink: "https://find-and-update.company-information.service.gov.uk/company/17440194",
    });
    expect(col("Director").value).toBe("Thomas Andrew Milward");
    expect(col("Other directors").value).toBe("Joshua Shaun Selwood");
    expect(col("How found").value).toBe("Direct");
    expect(col("Facebook").value).toMatchObject({ text: "Facebook page", hyperlink: base.facebookUrl });
    expect(col("Website").value).toMatchObject({ text: "precisionplumbing.example" });
    expect(col("Director LinkedIn").value).toMatchObject({ text: "Profile (check)" });
    expect(col("Confidence").value).toBeCloseTo(0.857);
    expect(col("Confidence").numFmt).toBe("0%");
    expect(col("Incorporated").numFmt).toBe("d mmm yyyy");

    expect(ws.views[0]).toMatchObject({ state: "frozen", xSplit: 1, ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
  });

  it("colours the result and explains every outcome on All companies", async () => {
    const ws = (await build([base], [base, noMatch])).getWorksheet("All companies")!;
    const header = ws.getRow(1).values as string[];
    const result = header.indexOf("Result");
    const details = header.indexOf("Details");
    expect(ws.getRow(2).getCell(result).value).toBe("Lead found");
    expect(ws.getRow(2).getCell(result).fill).toMatchObject({ fgColor: { argb: "FFDCFCE7" } });
    expect(ws.getRow(3).getCell(result).value).toBe("No match");
    expect(ws.getRow(3).getCell(details).value).toBe("Not online yet, and the director has no other companies to check");
  });

  it("says so when there are no leads", async () => {
    const ws = (await build([], [noMatch])).getWorksheet("Leads")!;
    expect(ws.getRow(2).getCell(1).value).toBe("No leads found yet in this run.");
  });

  it("explains errors, pending rows and via-owner leads in plain English", () => {
    expect(explain({ ...base, status: "ERROR", errorMessage: "search failed" })).toContain("Could not be checked: search failed");
    expect(explain({ ...base, status: "PENDING" })).toBe("Not processed yet");
    expect(explain({ ...base, matchSource: "OWNER_OTHER_BUSINESS", matchedViaCompanyName: "SMITH HEATING LTD" })).toBe(
      "Found through SMITH HEATING LTD, run by the same director",
    );
    expect(explain({ ...noMatch, note: null })).toBe("No Facebook or Google page found");
  });

  it("names the file after the date range", () => {
    expect(xlsxFilename("2026-09-01", "2026-09-07")).toBe("leads-2026-09-01_to_2026-09-07.xlsx");
  });
});
