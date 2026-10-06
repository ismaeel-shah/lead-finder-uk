import { nicheById } from "@/lib/niches";

const numberFormat = new Intl.NumberFormat("en-GB");
const compactFormat = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const shortDateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const fmtNumber = (n: number) => numberFormat.format(n);
export const fmtCompact = (n: number) => (n < 10_000 ? numberFormat.format(n) : compactFormat.format(n));

/** "2026-09-26" -> "26 Sept 2026" */
export const fmtDate = (ymd: string) => dateFormat.format(new Date(`${ymd}T00:00:00Z`));

export const fmtDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));

export const fmtScore = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toFixed(2));

export function fmtRange(from: string, to: string): string {
  if (from === to) return fmtDate(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${sameYear ? shortDateFormat.format(new Date(`${from}T00:00:00Z`)) : fmtDate(from)} – ${fmtDate(to)}`;
}

/** "3 min ago", "yesterday", or a date. */
export function fmtRelative(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return fmtDateTime(iso);
}

/** Joins a Companies House address object into one line. */
export function fmtAddress(address: unknown): string {
  if (!address || typeof address !== "object") return "";
  const a = address as Record<string, unknown>;
  return ["care_of", "po_box", "premises", "address_line_1", "address_line_2", "locality", "region", "postal_code", "country"]
    .map((k) => a[k])
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .join(", ");
}

/** "BARRATT, Ellie Mariah" -> "Ellie Mariah Barratt" (Companies House lists surname first). */
export function fmtPersonName(name: string): string {
  const [surname, rest] = name.split(",").map((s) => s.trim());
  const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());
  return rest ? `${rest} ${titleCase(surname ?? "")}` : titleCase(name);
}

/** "ACME PLUMBING LTD" -> "AP" (legal suffixes ignored). */
export function initials(name: string): string {
  const words = name
    .replace(/\b(limited|ltd|plc|llp|lp|cic|the)\b\.?/gi, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?").slice(0, 2);
}

type Filters = Record<string, string | null | undefined>;

/** Full description of a run's filters: "Active · LTD · Plumbing, heating & electrical · Bristol". */
export function fmtFilters(filters: unknown): string {
  const f = (filters ?? {}) as Filters;
  const status = f.company_status && f.company_status !== "active" ? f.company_status : "Active";
  const parts = [status.charAt(0).toUpperCase() + status.slice(1), (f.company_type ?? "ltd").toUpperCase()];
  const niche = nicheById(f.niche);
  if (niche) parts.push(niche.label);
  if (f.sic_codes) parts.push(`SIC ${f.sic_codes}`);
  if (f.name_includes) parts.push(`name contains “${f.name_includes}”`);
  if (f.location) parts.push(f.location);
  return parts.join(" · ");
}

/** Only the filters that differ from the defaults, or "" (for compact lists). */
export function fmtCustomFilters(filters: unknown): string {
  const f = (filters ?? {}) as Filters;
  const parts: string[] = [];
  const niche = nicheById(f.niche);
  if (niche) parts.push(niche.label);
  if (f.name_includes) parts.push(`“${f.name_includes}”`);
  if (f.location) parts.push(f.location);
  if (f.sic_codes) parts.push(`SIC ${f.sic_codes}`);
  if (f.company_type && f.company_type !== "ltd") parts.push(f.company_type.toUpperCase());
  if (f.company_status && f.company_status !== "active") parts.push(f.company_status);
  return parts.join(" · ");
}

export const sentenceCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const companiesHouseUrl = (companyNumber: string) =>
  `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(companyNumber)}`;
