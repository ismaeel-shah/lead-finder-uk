import { distance } from "fastest-levenshtein";

/**
 * Name normalisation and fuzzy matching (spec Section 5). Pure functions only.
 */

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Words removed anywhere in a name before matching. Empty by default because
 * words like "the", "uk" and "services" are often meaningful; add to this
 * list to make matching looser.
 */
export const MATCH_STOPWORDS: readonly string[] = [];

/** Legal / structural suffixes removed from the end of a name, repeatedly. */
const TRAILING_SUFFIXES: readonly string[][] = [
  ["uk", "ltd"],
  ["uk", "limited"],
  ["limited"],
  ["ltd"],
  ["plc"],
  ["llp"],
  ["lp"],
  ["cic"],
  ["company"],
  ["co"],
  ["group"],
  ["holdings"],
];

/** Suffixes that are legal forms, as opposed to descriptive words like "group". */
const LEGAL_FORMS = new Set(["limited", "ltd", "plc", "llp", "lp", "cic"]);

export interface NormaliseOptions {
  stopwords?: readonly string[];
}

/**
 * Lowercases, turns "&" into "and", removes punctuation and legal suffixes:
 *   "J.K. Builders (UK) Ltd." -> "jk builders"
 */
export function normaliseCompanyName(name: string, options: NormaliseOptions = {}): string {
  const stopwords = new Set(options.stopwords ?? MATCH_STOPWORDS);

  let s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\(\s*uk\s*\)/g, " "); // "(UK)" is a suffix wherever it appears

  // Dots and apostrophes join letters ("j.k." -> "jk", "smith's" -> "smiths");
  // every other non-alphanumeric character separates words.
  s = s.replace(/[.'"‘’“”]/g, "").replace(/[^a-z0-9]+/g, " ");

  const tokens = s.split(" ").filter((t) => t && !stopwords.has(t));
  return stripTrailingSuffixes(tokens).join(" ");
}

function stripTrailingSuffixes(tokens: string[]): string[] {
  const out = [...tokens];
  for (let changed = true; changed; ) {
    changed = false;
    for (const suffix of TRAILING_SUFFIXES) {
      // Never strip a name down to nothing ("Holdings Ltd" -> "holdings").
      if (out.length <= suffix.length) continue;
      const tail = out.slice(out.length - suffix.length);
      if (tail.every((t, i) => t === suffix[i])) {
        out.splice(out.length - suffix.length);
        changed = true;
        break;
      }
    }
    // "Smith & Co" -> "smith and" -> "smith"
    if (out.length > 1 && out[out.length - 1] === "and") {
      out.pop();
      changed = true;
    }
  }
  return out;
}

/**
 * The name to put in a search query: legal forms (and a trailing "Co")
 * removed but original spelling kept, and all-caps names turned into title
 * case. "Group" / "Holdings" are kept: they make the quoted phrase more
 * specific, and matching ignores them anyway.
 *   "ACME PLUMBING LTD" -> "Acme Plumbing"
 */
export function searchName(name: string): string {
  const tokens = name.replace(/\(\s*uk\s*\)/gi, " ").trim().split(/\s+/).filter(Boolean);
  const bare = (t: string) => t.toLowerCase().replace(/[^a-z0-9&]/g, "");

  let strippedLegalForm = false;
  while (tokens.length > 1) {
    const last = bare(tokens[tokens.length - 1]!);
    if (LEGAL_FORMS.has(last)) {
      strippedLegalForm = true;
    } else if (!((last === "uk" && strippedLegalForm) || last === "co" || last === "&" || last === "")) {
      break;
    }
    tokens.pop();
  }

  const joined = tokens.join(" ").replace(/[\s,.-]+$/, "");
  const isAllCaps = joined === joined.toUpperCase() && /[A-Z]/.test(joined);
  return isAllCaps ? joined.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : joined;
}

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

/** 1 - Levenshtein distance / length of the longer string. */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - distance(a, b) / longest;
}

/** Shared words / words in the larger set. */
export function tokenSetRatio(a: string, b: string): number {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  const larger = Math.max(setA.size, setB.size);
  if (larger === 0) return 0;
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;
  return shared / larger;
}

/**
 * Similarity 0..1 between two company names: the maximum of normalised
 * Levenshtein and the token-set ratio, both on normalised names.
 *
 * Levenshtein is used rather than Jaro-Winkler because Jaro-Winkler rewards
 * shared prefixes heavily ("smith builders" vs "smith brothers" ~0.9), which
 * lets different businesses through at the default 0.85 threshold.
 */
export function similarity(a: string, b: string, options: NormaliseOptions = {}): number {
  const na = normaliseCompanyName(a, options);
  const nb = normaliseCompanyName(b, options);
  if (!na || !nb) return 0;
  const tokenSet = tokenSetRatio(na, nb);
  // "scn refrigeration" vs "ncs refrigeration" is only 2 edits apart, but the
  // short words are different acronyms, i.e. a different business. When each
  // side has a short word the other lacks, only trust the word overlap.
  if (hasConflictingShortTokens(na, nb)) return tokenSet;
  return Math.max(levenshteinSimilarity(na, nb), tokenSet);
}

const SHORT_TOKEN_MAX = 4;

/** True when both names contain a short word (acronym, initials, number) missing from the other. */
export function hasConflictingShortTokens(a: string, b: string): boolean {
  const ta = new Set(a.split(" "));
  const tb = new Set(b.split(" "));
  const shortOnly = (x: Set<string>, y: Set<string>) => [...x].some((t) => t.length <= SHORT_TOKEN_MAX && !y.has(t));
  return shortOnly(ta, tb) && shortOnly(tb, ta);
}

// ---------------------------------------------------------------------------
// Result titles
// ---------------------------------------------------------------------------

const SEPARATOR = "[|\\-–—•·:]";

/**
 * Removes Facebook's decoration from a search-result title:
 *   "Acme Plumbing | Facebook"          -> "Acme Plumbing"
 *   "Acme Plumbing - Home"              -> "Acme Plumbing"
 *   "Acme Plumbing (@acme) • Facebook"  -> "Acme Plumbing"
 *   "Acme Plumbing - Manchester"        -> "Acme Plumbing"
 *   "Acme Plumbing | Great Mongeham"    -> "Acme Plumbing"
 */
export function cleanFacebookTitle(title: string): string {
  return facebookTitleVariants(title).at(-1) ?? "";
}

/**
 * The cleaned title, plus (if different) the title with trailing " - text"
 * removed. Scoring takes the best of these, so a name that itself contains
 * " - " is not penalised by the location-stripping rule.
 */
export function facebookTitleVariants(title: string): string[] {
  let s = title.trim();
  const patterns = [
    new RegExp(`\\s*${SEPARATOR}?\\s*facebook\\s*$`, "i"),
    new RegExp(`\\s*${SEPARATOR}\\s*home\\s*$`, "i"),
    /\s*\(@[^)]*\)\s*$/, // "(@handle)"
    /\s*[|•·]\s*$/,
  ];
  for (let changed = true; changed; ) {
    changed = false;
    for (const re of patterns) {
      const next = s.replace(re, "");
      if (next !== s) {
        s = next.trim();
        changed = true;
      }
    }
  }

  // Page titles often append a location or tagline: "Acme Plumbing - Leeds",
  // "Acme Plumbing | Great Mongeham". Also try the part before the first
  // separator; scoring takes the best variant.
  const variants = [s];
  for (const sep of [/\s[-–—]\s/, /\s[|·•]\s/]) {
    const at = s.search(sep);
    if (at > 0) variants.push(s.slice(0, at).trim());
  }
  return [...new Set(variants.filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Facebook URLs
// ---------------------------------------------------------------------------

const FACEBOOK_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "en-gb.facebook.com"]);

/**
 * Path segments that mean "not a business page" (spec 5.4 plus a few more
 * non-page areas). Matched against whole segments so a page called
 * "/sharedspaces" is not mistaken for "/share".
 */
const REJECTED_SEGMENTS = new Set([
  "groups",
  "posts",
  "events",
  "photos",
  "videos",
  "login",
  "login.php",
  "sharer",
  "sharer.php",
  "share",
  "share.php",
  "dialog",
  "plugins",
  "marketplace",
  "watch",
  "reel",
  "reels",
  "stories",
  "hashtag",
  "search",
  "help",
  "policies",
  "privacy",
  "story.php",
  "permalink.php",
  "photo.php",
  "media",
]);

export interface FacebookUrlOptions {
  /** Allow personal profiles under /people/ (off by default). */
  allowPeople?: boolean;
}

/**
 * Returns the canonical page URL (https://www.facebook.com/<path>, no query
 * string), or null if the URL is not a Facebook business page. Vanity URLs
 * are cut to the page itself ("/acme/about" -> "/acme").
 */
export function normaliseFacebookUrl(rawUrl: string, options: FacebookUrlOptions = {}): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (!FACEBOOK_HOSTS.has(url.hostname.toLowerCase())) return null;

  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const lowerSegments = segments.map((s) => s.toLowerCase());
  if (lowerSegments.some((s) => REJECTED_SEGMENTS.has(s))) return null;
  const first = lowerSegments[0]!;
  if (first === "people" && !options.allowPeople) return null;

  // profile.php pages are identified only by ?id=, so keep that one parameter.
  if (first === "profile.php") {
    const id = url.searchParams.get("id");
    return id && /^\d+$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : null;
  }
  if (first.endsWith(".php")) return null;

  // Multi-segment page formats: /pages/<name>/<id>, /p/<name-id>, /people/<name>/<id>.
  const keep = first === "pages" ? 3 : first === "p" ? 2 : first === "people" ? 3 : 1;
  if (segments.length < keep) return null;
  const canonical = segments.slice(0, keep).join("/");
  return `https://www.facebook.com/${encodeURI(canonical)}`;
}

// ---------------------------------------------------------------------------
// Location bonus
// ---------------------------------------------------------------------------

export const LOCATION_BONUS = 0.05;

export interface AddressLike {
  locality?: string | null;
  postal_code?: string | null;
}

/**
 * The outward code of a UK postcode's area and district: "M1 1AA" -> "M1",
 * "B15 2TT" -> "B15", "SW1A 1AA" -> "SW1A".
 */
export function postcodeOutward(postcode: string | null | undefined): string | null {
  const compact = (postcode ?? "").toUpperCase().replace(/\s+/g, "");
  const match = /^([A-Z]{1,2}\d[A-Z\d]?)\d[A-Z]{2}$/.exec(compact);
  return match?.[1] ?? null;
}

/** True if the text mentions the registered office town or postcode district. */
export function mentionsLocation(text: string | null | undefined, address: AddressLike | null | undefined): boolean {
  if (!text || !address) return false;
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const town = address.locality?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (town && town.length >= 3 && haystack.includes(` ${town} `)) return true;
  const outward = postcodeOutward(address.postal_code);
  return !!outward && haystack.includes(` ${outward.toLowerCase()} `);
}

/**
 * Adds the location bonus WITHOUT capping. Candidates are ranked on this raw
 * value so the bonus can still separate two exact (1.0) name matches; the
 * score reported and stored is capped at 1.
 */
function withLocationBonus(score: number, text: string | null | undefined, address: AddressLike | null | undefined): number {
  return mentionsLocation(text, address) ? score + LOCATION_BONUS : score;
}

const cap = (score: number) => Math.min(1, score);

// ---------------------------------------------------------------------------
// UK address check
// ---------------------------------------------------------------------------

const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
const UK_COUNTRY = /\b(united kingdom|uk|england|scotland|wales|northern ireland|great britain|gb)\b/i;
const US_STATE_ZIP = /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/;
const CANADIAN_POSTCODE = /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i;
const FOREIGN_COUNTRY =
  /\b(usa|united states|u\.s\.a?|canada|australia|new zealand|ireland|india|pakistan|bangladesh|nigeria|south africa|united arab emirates|uae|france|germany|spain|italy|netherlands|portugal|poland)\.?\s*$/i;

/**
 * False only when an address is clearly outside the UK (a US state + ZIP, a
 * Canadian postcode, or a trailing foreign country). UK postcodes and UK
 * country names always pass, and so do addresses with no clear signal
 * (e.g. a bare town name from a Maps snippet).
 */
export function isUkAddress(address: string | null | undefined): boolean {
  const a = address?.trim();
  if (!a) return true;
  // Checked first, so "Belfast, Northern Ireland" passes before the "Ireland" rule.
  if (UK_POSTCODE.test(a) || UK_COUNTRY.test(a)) return true;
  if (US_STATE_ZIP.test(a) || CANADIAN_POSTCODE.test(a) || FOREIGN_COUNTRY.test(a)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Picking the best candidate
// ---------------------------------------------------------------------------

export interface MatchOptions extends NormaliseOptions, FacebookUrlOptions {
  threshold: number;
  /** Registered office address, for the location bonus. */
  address?: AddressLike | null;
}

export interface FacebookCandidate {
  title: string;
  link: string;
  snippet?: string | null;
}

export interface PlaceCandidate {
  title: string;
  address?: string | null;
}

export interface Match<T> {
  candidate: T;
  score: number;
}

export interface FacebookMatch<T extends FacebookCandidate> extends Match<T> {
  /** Canonical page URL. */
  url: string;
}

/** Score for one Facebook result (capped at 1), or null if its URL is not a page. */
export function scoreFacebookResult(
  companyName: string,
  result: FacebookCandidate,
  options: MatchOptions,
): { url: string; score: number } | null {
  const raw = rawFacebookScore(companyName, result, options);
  return raw && { url: raw.url, score: cap(raw.score) };
}

function rawFacebookScore(companyName: string, result: FacebookCandidate, options: MatchOptions): { url: string; score: number } | null {
  const url = normaliseFacebookUrl(result.link, options);
  if (!url) return null;
  const base = Math.max(0, ...facebookTitleVariants(result.title).map((t) => similarity(companyName, t, options)));
  return { url, score: withLocationBonus(base, result.snippet, options.address) };
}

/** Highest-scoring Facebook page at or above the threshold (ties keep search order). */
export function pickBestFacebookResult<T extends FacebookCandidate>(
  companyName: string,
  results: readonly T[],
  options: MatchOptions,
): FacebookMatch<T> | null {
  let best: (FacebookMatch<T> & { raw: number }) | null = null;
  for (const candidate of results) {
    const scored = rawFacebookScore(companyName, candidate, options);
    if (!scored || scored.score < options.threshold) continue;
    if (!best || scored.score > best.raw) best = { candidate, url: scored.url, score: cap(scored.score), raw: scored.score };
  }
  return best && { candidate: best.candidate, url: best.url, score: best.score };
}

export function scorePlace(companyName: string, place: PlaceCandidate, options: MatchOptions): number {
  return cap(rawPlaceScore(companyName, place, options));
}

function rawPlaceScore(companyName: string, place: PlaceCandidate, options: MatchOptions): number {
  return withLocationBonus(similarity(companyName, place.title, options), place.address, options.address);
}

/** Highest-scoring Google Business result at or above the threshold (ties keep search order). */
export function pickBestPlace<T extends PlaceCandidate>(
  companyName: string,
  places: readonly T[],
  options: MatchOptions,
): Match<T> | null {
  let best: (Match<T> & { raw: number }) | null = null;
  for (const candidate of places) {
    const raw = rawPlaceScore(companyName, candidate, options);
    if (raw < options.threshold) continue;
    if (!best || raw > best.raw) best = { candidate, score: cap(raw), raw };
  }
  return best && { candidate: best.candidate, score: best.score };
}
