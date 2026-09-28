import { mentionsLocation, normaliseCompanyName, similarity, type AddressLike, type NormaliseOptions } from "@/lib/matching";

/**
 * LinkedIn discovery from search-engine results (spec-style, like Facebook):
 * we never fetch LinkedIn itself, only judge the links a search returns.
 */

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/** www.linkedin.com, linkedin.com and country mirrors such as uk.linkedin.com. */
function isLinkedInHost(host: string): boolean {
  return /^([a-z]{2,3}\.|www\.)?linkedin\.com$/i.test(host);
}

function parse(rawUrl: string): { segments: string[] } | null {
  try {
    const url = new URL(rawUrl.trim());
    if (!isLinkedInHost(url.hostname)) return null;
    const segments = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    return { segments };
  } catch {
    return null;
  }
}

const SLUG = /^[A-Za-z0-9][A-Za-z0-9\-_.%]*$/;

/** https://www.linkedin.com/company/<slug>, or null if not a company page. Sub-pages are cut back. */
export function normaliseLinkedInCompanyUrl(rawUrl: string): string | null {
  const p = parse(rawUrl);
  if (!p || p.segments[0]?.toLowerCase() !== "company") return null;
  const slug = p.segments[1];
  return slug && SLUG.test(slug) ? `https://www.linkedin.com/company/${encodeURIComponent(slug)}` : null;
}

/** https://www.linkedin.com/in/<slug>, or null if not a personal profile. */
export function normaliseLinkedInProfileUrl(rawUrl: string): string | null {
  const p = parse(rawUrl);
  if (!p || p.segments[0]?.toLowerCase() !== "in") return null;
  const slug = p.segments[1];
  return slug && SLUG.test(slug) ? `https://www.linkedin.com/in/${encodeURIComponent(slug)}` : null;
}

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

/** Strips LinkedIn's decoration: "Acme Ltd | LinkedIn", "Acme - LinkedIn", "Acme on LinkedIn". */
export function cleanLinkedInTitle(title: string): string {
  return title
    .replace(/\s*[|\-–—·]\s*linkedin\s*$/i, "")
    .replace(/\s+on\s+linkedin\s*$/i, "")
    .trim();
}

/** "Thomas Milward - Owner - Precision Plumbing SW Ltd | LinkedIn" -> ["Thomas Milward", "Owner", "Precision Plumbing SW Ltd"] */
export function linkedInTitleParts(title: string): string[] {
  return cleanLinkedInTitle(title)
    .split(/\s[-–—|]\s/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface PersonName {
  first: string;
  last: string;
}

/**
 * Companies House lists officers as "SURNAME, Forenames": "MILWARD, Thomas Andrew"
 * -> { first: "Thomas", last: "Milward" }. Titles like "Dr" are dropped.
 */
export function parseOfficerName(name: string): PersonName | null {
  const [surnamePart, forenamePart] = name.split(",").map((s) => s.trim());
  const cap = (s: string) => s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());
  const forenames = (forenamePart ?? "")
    .split(/\s+/)
    .filter((w) => w && !/^(mr|mrs|ms|miss|dr|sir|prof)\.?$/i.test(w));
  if (!surnamePart || forenames.length === 0) return null;
  return { first: cap(forenames[0]!), last: cap(surnamePart) };
}

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** True when a profile's name part contains both the first name and surname as whole words. */
export function nameMatches(profileName: string, person: PersonName): boolean {
  const words = new Set(fold(profileName).split(" "));
  const last = fold(person.last).split(" ");
  return words.has(fold(person.first)) && last.every((w) => words.has(w));
}

// ---------------------------------------------------------------------------
// Picking results
// ---------------------------------------------------------------------------

export interface LinkedInCandidate {
  title: string;
  link: string;
  snippet?: string | null;
}

export interface LinkedInMatch<T extends LinkedInCandidate> {
  candidate: T;
  url: string;
  score: number;
}

/** Best company page whose name matches at or above the threshold (ties keep search order). */
export function pickBestLinkedInCompany<T extends LinkedInCandidate>(
  companyName: string,
  results: readonly T[],
  options: NormaliseOptions & { threshold: number; address?: AddressLike | null },
): LinkedInMatch<T> | null {
  let best: (LinkedInMatch<T> & { raw: number }) | null = null;
  for (const candidate of results) {
    const url = normaliseLinkedInCompanyUrl(candidate.link);
    if (!url) continue;
    const parts = linkedInTitleParts(candidate.title);
    const base = Math.max(0, ...[cleanLinkedInTitle(candidate.title), ...parts].map((t) => similarity(companyName, t, options)));
    const raw = mentionsLocation(candidate.snippet, options.address) ? base + 0.05 : base;
    if (raw < options.threshold) continue;
    if (!best || raw > best.raw) best = { candidate, url, score: Math.min(1, raw), raw };
  }
  return best && { candidate: best.candidate, url: best.url, score: best.score };
}

/** Scores for a director profile: tied to one of their companies, or only to the area. */
export const PROFILE_SCORE_COMPANY = 1;
export const PROFILE_SCORE_LOCATION = 0.9;

/**
 * A director's profile is accepted only when the name matches exactly (first
 * name + surname) AND the result is tied to them some other way: one of their
 * companies appears in the title/snippet, or failing that, the registered
 * office town / postcode district does. A bare name match is never enough.
 */
export function pickBestLinkedInProfile<T extends LinkedInCandidate>(
  person: PersonName,
  companyNames: readonly string[],
  results: readonly T[],
  options: NormaliseOptions & { threshold: number; address?: AddressLike | null },
): LinkedInMatch<T> | null {
  const companies = companyNames.map((c) => normaliseCompanyName(c, options)).filter(Boolean);
  let best: LinkedInMatch<T> | null = null;
  for (const candidate of results) {
    const url = normaliseLinkedInProfileUrl(candidate.link);
    if (!url) continue;
    const [namePart = "", ...rest] = linkedInTitleParts(candidate.title);
    if (!nameMatches(namePart, person)) continue;

    const context = ` ${fold([...rest, candidate.snippet ?? ""].join(" "))} `;
    const companyTied =
      companies.some((c) => context.includes(` ${fold(c)} `)) ||
      rest.some((part) => companyNames.some((c) => similarity(c, part, options) >= options.threshold));
    const score = companyTied ? PROFILE_SCORE_COMPANY : mentionsLocation(candidate.snippet, options.address) ? PROFILE_SCORE_LOCATION : 0;
    if (score === 0) continue;
    if (!best || score > best.score) best = { candidate, url, score };
  }
  return best;
}
