import type { CompanyResult } from "@prisma/client";
import { formatDate } from "@/lib/dates";

/** Column order from spec Section 11, plus LinkedIn columns appended at the end. */
export const CSV_HEADER = [
  "company_name",
  "company_number",
  "incorporation_date",
  "status",
  "facebook_url",
  "google_business_url",
  "google_business_name",
  "google_business_address",
  "google_business_phone",
  "google_business_website",
  "match_source",
  "matched_via_company",
  "matched_via_company_number",
  "officer_name",
  "facebook_score",
  "google_business_score",
  "note",
  "linkedin_company_url",
  "linkedin_director_url",
] as const;

/** UTF-8 byte order mark, so Excel detects the encoding. */
export const BOM = "﻿";

/**
 * Quotes a field when it contains a comma, quote or line break, doubling
 * inner quotes (RFC 4180). Values starting with = + - @ (or tab / CR) get a
 * leading apostrophe so spreadsheets do not run them as formulas; several
 * fields come from third-party search results.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(values: readonly (string | number | null | undefined)[]): string {
  return `${values.map(csvField).join(",")}\r\n`;
}

const MATCH_SOURCE = { BUSINESS: "business", OWNER_OTHER_BUSINESS: "owner_other_business" } as const;

type CsvRow = Pick<
  CompanyResult,
  | "companyName"
  | "companyNumber"
  | "incorporationDate"
  | "status"
  | "facebookUrl"
  | "googleBusinessUrl"
  | "googleBusinessName"
  | "googleBusinessAddress"
  | "googleBusinessPhone"
  | "googleBusinessWebsite"
  | "matchSource"
  | "matchedViaCompanyName"
  | "matchedViaCompanyNumber"
  | "officerName"
  | "facebookScore"
  | "googleBusinessScore"
  | "note"
  | "errorMessage"
  | "linkedinCompanyUrl"
  | "linkedinDirectorUrl"
>;

export function resultToCsvLine(r: CsvRow): string {
  return csvLine([
    r.companyName,
    r.companyNumber,
    formatDate(r.incorporationDate),
    r.status.toLowerCase(),
    r.facebookUrl,
    r.googleBusinessUrl,
    r.googleBusinessName,
    r.googleBusinessAddress,
    r.googleBusinessPhone,
    r.googleBusinessWebsite,
    r.matchSource ? MATCH_SOURCE[r.matchSource] : null,
    r.matchedViaCompanyName,
    r.matchedViaCompanyNumber,
    r.officerName,
    r.facebookScore,
    r.googleBusinessScore,
    // Errors have no note; put the message there so the export explains them.
    r.note ?? (r.errorMessage ? `error: ${r.errorMessage}` : null),
    r.linkedinCompanyUrl,
    r.linkedinDirectorUrl,
  ]);
}

export function csvFilename(from: string, to: string): string {
  return from === to ? `leads-${from}.csv` : `leads-${from}_to_${to}.csv`;
}
