import type { CompanyResult } from "@prisma/client";
import ExcelJS from "exceljs";
import type { Writable } from "node:stream";
import { companiesHouseUrl, fmtAddress, fmtFilters, fmtPersonName, fmtRange } from "@/components/dashboard/format";
import { PROFILE_SCORE_COMPANY } from "@/lib/linkedin";

/**
 * Formatted Excel export: a Summary sheet (what this run is and how to read
 * the file), a Leads sheet (found companies only — where to start) and an All
 * companies sheet (every row, with the reason when nothing was found).
 * Written with the streaming writer so very large runs stay within memory.
 */

export type ExportRow = Pick<
  CompanyResult,
  | "companyName"
  | "companyNumber"
  | "incorporationDate"
  | "registeredAddress"
  | "sicCodes"
  | "status"
  | "facebookUrl"
  | "facebookScore"
  | "googleBusinessUrl"
  | "googleBusinessName"
  | "googleBusinessAddress"
  | "googleBusinessPhone"
  | "googleBusinessWebsite"
  | "googleBusinessScore"
  | "linkedinCompanyUrl"
  | "linkedinDirectorUrl"
  | "linkedinDirectorScore"
  | "matchSource"
  | "matchedViaCompanyName"
  | "officerName"
  | "directorNames"
  | "note"
  | "errorMessage"
>;

export interface ExportJob {
  incorporatedFrom: string;
  incorporatedTo: string;
  filters: unknown;
  totalCompanies: number;
  processedCount: number;
  foundCount: number;
  noMatchCount: number;
  errorCount: number;
  searchCreditsUsed: number;
  viaOwnerCount: number;
}

export interface ExportRows {
  /** Found companies, in display order, in chunks. */
  found: () => AsyncIterable<ExportRow[]>;
  /** Every company, in display order, in chunks. */
  all: () => AsyncIterable<ExportRow[]>;
}

// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------

const BRAND = "FF4F46E5";
const INK = "FF0F172A";
const MUTED = "FF64748B";
const BAND = "FFF8FAFC";
const LINE = "FFE2E8F0";

const STATUS: Record<CompanyResult["status"], { label: string; fill: string; font: string }> = {
  FOUND: { label: "Lead found", fill: "FFDCFCE7", font: "FF166534" },
  NO_MATCH: { label: "No match", fill: "FFF1F5F9", font: "FF475569" },
  ERROR: { label: "Error", fill: "FFFEE2E2", font: "FF991B1B" },
  PENDING: { label: "Not processed yet", fill: "FFFEF3C7", font: "FF92400E" },
  PROCESSING: { label: "Not processed yet", fill: "FFFEF3C7", font: "FF92400E" },
};

const FONT = "Calibri";
const solid = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const linkFont: Partial<ExcelJS.Font> = { name: FONT, size: 11, color: { argb: BRAND }, underline: true };

type Value = ExcelJS.CellValue;

interface Column {
  header: string;
  width: number;
  /** Cell value for a row. */
  value: (r: ExportRow) => Value;
  numFmt?: string;
  bold?: boolean;
  wrap?: boolean;
  /** Per-cell style override (e.g. the coloured status). */
  style?: (r: ExportRow) => Partial<ExcelJS.Style> | undefined;
}

// ---------------------------------------------------------------------------
// Friendly values
// ---------------------------------------------------------------------------

const link = (text: string, url: string | null | undefined): Value => (url ? { text, hyperlink: url } : "");

const domain = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

const confidence = (r: ExportRow): number | "" => {
  const best = Math.max(r.facebookScore ?? 0, r.googleBusinessScore ?? 0);
  return r.status === "FOUND" && best > 0 ? best : "";
};

const howFound = (r: ExportRow) =>
  r.matchSource === "BUSINESS" ? "Direct" : r.matchSource === "OWNER_OTHER_BUSINESS" ? "Via director's other company" : "";

const director = (r: ExportRow) => (r.officerName ? fmtPersonName(r.officerName) : "");

const otherDirectors = (r: ExportRow) =>
  r.directorNames
    .filter((n) => n !== r.officerName)
    .map(fmtPersonName)
    .join(", ");

const NOTE_TEXT: Record<string, string> = {
  "no active officers": "No active directors listed at Companies House",
  "no active officer with an appointments link": "Director details unavailable at Companies House",
  "owner has no other companies": "Not online yet, and the director has no other companies to check",
  "no match on owner's companies": "Nothing found for this company or the director's other companies",
  "facebook page with this name is outside the uk or unconfirmed": "A Facebook page with this name exists, but it is abroad or not confirmed as UK",
};

/** Plain-English reason for the row's outcome. */
export function explain(r: ExportRow): string {
  if (r.status === "ERROR") return `Could not be checked: ${r.errorMessage ?? "unknown error"}. Use “Retry errors”.`;
  if (r.status === "PENDING" || r.status === "PROCESSING") return "Not processed yet";
  if (r.status === "FOUND") {
    return r.matchSource === "OWNER_OTHER_BUSINESS"
      ? `Found through ${r.matchedViaCompanyName ?? "another company"}, run by the same director`
      : "Found under its own name";
  }
  return (r.note && NOTE_TEXT[r.note]) ?? (r.note ? r.note.charAt(0).toUpperCase() + r.note.slice(1) : "No Facebook or Google page found");
}

const directorLinkedIn = (r: ExportRow): Value =>
  link(r.linkedinDirectorScore !== null && r.linkedinDirectorScore < PROFILE_SCORE_COMPANY ? "Profile (check)" : "Profile", r.linkedinDirectorUrl);

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const COMPANY: Column = { header: "Company", width: 40, value: (r) => r.companyName, bold: true };
const NUMBER: Column = { header: "Company no.", width: 13, value: (r) => link(r.companyNumber, companiesHouseUrl(r.companyNumber)) };
const INCORPORATED: Column = { header: "Incorporated", width: 14, value: (r) => r.incorporationDate, numFmt: "d mmm yyyy" };
const DIRECTOR: Column = { header: "Director", width: 26, value: director };
const FACEBOOK: Column = { header: "Facebook", width: 16, value: (r) => link("Facebook page", r.facebookUrl) };
const GOOGLE: Column = { header: "Google listing", width: 30, value: (r) => link(r.googleBusinessName ?? "Google Maps", r.googleBusinessUrl) };
const PHONE: Column = { header: "Phone", width: 17, value: (r) => r.googleBusinessPhone ?? "" };
const WEBSITE: Column = {
  header: "Website",
  width: 28,
  value: (r) => (r.googleBusinessWebsite ? link(domain(r.googleBusinessWebsite), r.googleBusinessWebsite) : ""),
};
const LI_COMPANY: Column = { header: "Company LinkedIn", width: 17, value: (r) => link("LinkedIn page", r.linkedinCompanyUrl) };
const LI_DIRECTOR: Column = { header: "Director LinkedIn", width: 17, value: directorLinkedIn };
const CONFIDENCE: Column = { header: "Confidence", width: 12, value: confidence, numFmt: "0%" };
const REGISTERED: Column = { header: "Registered office", width: 48, value: (r) => fmtAddress(r.registeredAddress), wrap: true };
const SIC: Column = { header: "SIC codes", width: 12, value: (r) => r.sicCodes.join(", ") };

const LEADS_COLUMNS: Column[] = [
  COMPANY,
  NUMBER,
  INCORPORATED,
  DIRECTOR,
  { header: "Other directors", width: 30, value: otherDirectors, wrap: true },
  { header: "How found", width: 26, value: howFound },
  { header: "Online as", width: 32, value: (r) => r.matchedViaCompanyName ?? r.companyName },
  FACEBOOK,
  GOOGLE,
  PHONE,
  WEBSITE,
  { header: "Business address", width: 44, value: (r) => r.googleBusinessAddress ?? "", wrap: true },
  LI_COMPANY,
  LI_DIRECTOR,
  CONFIDENCE,
  REGISTERED,
  SIC,
];

const ALL_COLUMNS: Column[] = [
  COMPANY,
  NUMBER,
  INCORPORATED,
  {
    header: "Result",
    width: 18,
    value: (r) => STATUS[r.status].label,
    bold: true,
    style: (r) => ({ fill: solid(STATUS[r.status].fill), font: { name: FONT, size: 11, bold: true, color: { argb: STATUS[r.status].font } } }),
  },
  { header: "Details", width: 58, value: explain, wrap: true },
  DIRECTOR,
  FACEBOOK,
  GOOGLE,
  PHONE,
  WEBSITE,
  LI_COMPANY,
  LI_DIRECTOR,
  CONFIDENCE,
  REGISTERED,
  SIC,
];

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function colLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

async function writeTable(
  wb: ExcelJS.stream.xlsx.WorkbookWriter,
  name: string,
  tabColor: string,
  columns: Column[],
  chunks: AsyncIterable<ExportRow[]>,
  emptyMessage: string,
): Promise<void> {
  const ws = wb.addWorksheet(name, {
    views: [{ state: "frozen", xSplit: 1, ySplit: 1, zoomScale: 100 }],
    properties: { tabColor: { argb: tabColor }, defaultRowHeight: 20 },
  });
  ws.columns = columns.map((c) => ({ width: c.width }));
  ws.autoFilter = { from: "A1", to: `${colLetter(columns.length)}1` };

  const header = ws.addRow(columns.map((c) => c.header));
  header.height = 30;
  header.eachCell((cell) => {
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = solid(BRAND);
    cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    cell.border = { bottom: { style: "thin", color: { argb: BRAND } } };
  });
  header.commit();

  let index = 0;
  for await (const chunk of chunks) {
    for (const r of chunk) {
      const row = ws.addRow(columns.map((c) => c.value(r)));
      const banded = index % 2 === 1;
      columns.forEach((col, i) => {
        const cell = row.getCell(i + 1);
        const isLink = typeof cell.value === "object" && cell.value !== null && "hyperlink" in cell.value;
        cell.font = isLink ? linkFont : { name: FONT, size: 11, bold: col.bold, color: { argb: INK } };
        cell.alignment = { vertical: "top", wrapText: col.wrap, indent: 1 };
        cell.border = { bottom: { style: "hair", color: { argb: LINE } } };
        if (banded) cell.fill = solid(BAND);
        if (col.numFmt) cell.numFmt = col.numFmt;
        const extra = col.style?.(r);
        if (extra) Object.assign(cell, extra);
      });
      row.commit();
      index++;
    }
  }

  if (index === 0) {
    const row = ws.addRow([emptyMessage]);
    row.getCell(1).font = { name: FONT, size: 11, italic: true, color: { argb: MUTED } };
    row.commit();
  }
  ws.commit();
}

function writeSummary(wb: ExcelJS.stream.xlsx.WorkbookWriter, job: ExportJob, now: Date): void {
  const ws = wb.addWorksheet("Summary", {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: INK } },
  });
  ws.columns = [{ width: 3 }, { width: 46 }, { width: 16 }, { width: 70 }];

  const text = (values: Value[], font: Partial<ExcelJS.Font>, height?: number) => {
    const row = ws.addRow(values);
    row.eachCell((c) => (c.font = { name: FONT, ...font }));
    if (height) row.height = height;
    row.commit();
    return row;
  };
  const gap = () => ws.addRow([]).commit();
  const pct = (n: number) => (job.processedCount > 0 ? n / job.processedCount : 0);

  gap();
  text(["", "Lead Finder — lead export"], { size: 20, bold: true, color: { argb: BRAND } }, 34);
  text(["", `Companies incorporated ${fmtRange(job.incorporatedFrom, job.incorporatedTo)}`], { size: 12, color: { argb: INK } });
  text(["", `Filters: ${fmtFilters(job.filters)}`], { size: 11, color: { argb: MUTED } });
  text(
    ["", `Exported ${new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/London" }).format(now)}`],
    { size: 11, color: { argb: MUTED } },
  );
  gap();

  const section = (title: string) => {
    const row = ws.addRow(["", title]);
    row.height = 24;
    const cell = row.getCell(2);
    cell.font = { name: FONT, size: 13, bold: true, color: { argb: INK } };
    cell.border = { bottom: { style: "medium", color: { argb: BRAND } } };
    row.getCell(3).border = { bottom: { style: "medium", color: { argb: BRAND } } };
    row.getCell(4).border = { bottom: { style: "medium", color: { argb: BRAND } } };
    row.commit();
  };

  const stat = (label: string, value: number, share?: number, highlight?: { fill: string; font: string }, sub = false) => {
    const row = ws.addRow(["", label, value, share === undefined ? "" : share]);
    row.height = 22;
    row.getCell(2).font = { name: FONT, size: sub ? 10 : 11, color: { argb: sub ? MUTED : INK } };
    row.getCell(2).alignment = { indent: sub ? 2 : 0, vertical: "middle" };
    row.getCell(3).font = { name: FONT, size: 12, bold: true, color: { argb: highlight?.font ?? INK } };
    row.getCell(3).numFmt = "#,##0";
    row.getCell(3).alignment = { horizontal: "right" };
    row.getCell(4).numFmt = '0%" of processed"';
    row.getCell(4).font = { name: FONT, size: 11, color: { argb: MUTED } };
    if (highlight) [2, 3].forEach((c) => (row.getCell(c).fill = solid(highlight.fill)));
    [2, 3, 4].forEach((c) => (row.getCell(c).border = { bottom: { style: "hair", color: { argb: LINE } } }));
    row.commit();
  };

  section("At a glance");
  stat("Companies in this run", job.totalCompanies);
  stat("Leads found", job.foundCount, pct(job.foundCount), { fill: STATUS.FOUND.fill, font: STATUS.FOUND.font });
  stat("found under their own name", job.foundCount - job.viaOwnerCount, undefined, undefined, true);
  stat("found through the director's other company", job.viaOwnerCount, undefined, undefined, true);
  stat("No online presence found", job.noMatchCount, pct(job.noMatchCount));
  stat("Errors (retry from the dashboard)", job.errorCount, undefined, job.errorCount ? { fill: STATUS.ERROR.fill, font: STATUS.ERROR.font } : undefined);
  if (job.totalCompanies > job.processedCount) stat("Not processed yet", job.totalCompanies - job.processedCount);
  stat("Search credits used", job.searchCreditsUsed);
  gap();

  section("How to read this file");
  const guide: [string, string][] = [
    ["Leads sheet", "Only the companies we found online. Start here."],
    ["All companies sheet", "Every company in the run, with the reason when nothing was found."],
    ["Confidence", "How closely the name on Facebook / Google matches the company. 100% is an exact match; check generic names below 90% before contacting."],
    ["Via director's other company", "The new company isn't online yet. The links belong to an older business run by the same director — often the best way to reach them."],
    ["Director LinkedIn “Profile (check)”", "Matched on the director's name and area only; confirm it's the right person."],
    ["Links", "Blue text is clickable. Company numbers open the Companies House record."],
    ["Filters", "Every sheet has filter buttons in the header row; the first column and header stay in view while scrolling."],
  ];
  for (const [term, meaning] of guide) {
    const row = ws.addRow(["", term, "", meaning]);
    ws.mergeCells(`B${row.number}:C${row.number}`);
    row.getCell(2).font = { name: FONT, size: 11, bold: true, color: { argb: INK } };
    row.getCell(4).font = { name: FONT, size: 11, color: { argb: MUTED } };
    row.getCell(4).alignment = { wrapText: true, vertical: "top" };
    row.getCell(2).alignment = { vertical: "top" };
    row.height = meaning.length > 90 ? 32 : 20;
    row.commit();
  }
  gap();
  text(
    ["", "Sources: Companies House public register; public Google search results. Any outreach must follow UK GDPR and PECR (record and respect opt-outs)."],
    { size: 9, italic: true, color: { argb: MUTED } },
  );
  ws.commit();
}

/** Writes the workbook to `out` and resolves when it is complete. */
export async function writeLeadsWorkbook(out: Writable, job: ExportJob, rows: ExportRows, now = new Date()): Promise<void> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  wb.creator = "Lead Finder";
  wb.created = now;
  writeSummary(wb, job, now);
  await writeTable(wb, "Leads", "FF16A34A", LEADS_COLUMNS, rows.found(), "No leads found yet in this run.");
  await writeTable(wb, "All companies", BRAND, ALL_COLUMNS, rows.all(), "No companies in this run.");
  await wb.commit();
}

export function xlsxFilename(from: string, to: string): string {
  return from === to ? `leads-${from}.xlsx` : `leads-${from}_to_${to}.xlsx`;
}
