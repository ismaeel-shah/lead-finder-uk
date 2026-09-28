import { selectOtherCompanies, selectPrimaryOfficer, type CompaniesHouseClient } from "@/lib/companiesHouse";
import { parseOfficerName, pickBestLinkedInCompany, pickBestLinkedInProfile } from "@/lib/linkedin";
import { facebookLocationAllowed } from "@/lib/location";
import { pickBestFacebookResult, pickBestPlace, type AddressLike, type MatchOptions } from "@/lib/matching";
import type { PlaceResult, SearchProvider } from "@/lib/search/types";

/**
 * Per-company processing (spec Section 7). Pure with respect to storage:
 * returns the fields to save on the CompanyResult row, and never throws.
 */

export type ProcessStatus = "FOUND" | "NO_MATCH" | "ERROR";
export type MatchSourceValue = "BUSINESS" | "OWNER_OTHER_BUSINESS";

export interface CompanyInput {
  companyNumber: string;
  companyName: string;
  registeredAddress: AddressLike | null;
}

/** Every field is always set, so re-processing a row clears stale values. */
export interface ProcessOutcome {
  status: ProcessStatus;
  facebookUrl: string | null;
  facebookScore: number | null;
  googleBusinessUrl: string | null;
  googleBusinessName: string | null;
  googleBusinessAddress: string | null;
  googleBusinessPhone: string | null;
  googleBusinessWebsite: string | null;
  googleBusinessScore: number | null;
  linkedinCompanyUrl: string | null;
  linkedinCompanyScore: number | null;
  linkedinDirectorUrl: string | null;
  linkedinDirectorScore: number | null;
  matchSource: MatchSourceValue | null;
  matchedViaCompanyName: string | null;
  matchedViaCompanyNumber: string | null;
  officerName: string | null;
  officerId: string | null;
  directorNames: string[];
  note: string | null;
  errorMessage: string | null;
}

export interface ProcessDeps {
  companiesHouse: Pick<CompaniesHouseClient, "getOfficers" | "getOfficerAppointments">;
  search: SearchProvider;
  matchThreshold: number;
  maxOwnerCompanies: number;
  allowPeoplePages?: boolean;
  /** LinkedIn search: for found leads, for every company, or off (the default when omitted). */
  linkedin?: "found" | "all" | "off";
  /**
   * Facebook location check: "strict" drops foreign pages and profiles, and
   * needs UK evidence when there is no Google listing; "lenient" only drops
   * foreign pages and profiles; "off" (the default when omitted) does neither.
   */
  facebookLocationCheck?: "strict" | "lenient" | "off";
}

export const NOTES = {
  noOfficers: "no active officers",
  noOfficerLink: "no active officer with an appointments link",
  noOtherCompanies: "owner has no other companies",
  noOwnerMatch: "no match on owner's companies",
  facebookRejected: "facebook page with this name is outside the uk or unconfirmed",
} as const;

const EMPTY: ProcessOutcome = {
  status: "NO_MATCH",
  facebookUrl: null,
  facebookScore: null,
  googleBusinessUrl: null,
  googleBusinessName: null,
  googleBusinessAddress: null,
  googleBusinessPhone: null,
  googleBusinessWebsite: null,
  googleBusinessScore: null,
  linkedinCompanyUrl: null,
  linkedinCompanyScore: null,
  linkedinDirectorUrl: null,
  linkedinDirectorScore: null,
  matchSource: null,
  matchedViaCompanyName: null,
  matchedViaCompanyNumber: null,
  officerName: null,
  officerId: null,
  directorNames: [],
  note: null,
  errorMessage: null,
};

interface Discovery {
  facebook: { url: string; score: number } | null;
  place: { place: PlaceResult; score: number } | null;
}

export async function processCompany(company: CompanyInput, deps: ProcessDeps): Promise<ProcessOutcome> {
  // Filled in as we go so an error outcome still shows how far we got.
  const owner: Pick<ProcessOutcome, "officerName" | "officerId" | "directorNames"> = {
    officerName: null,
    officerId: null,
    directorNames: [],
  };
  // The registered office drives the location bonus. It is also used for
  // the owner's other companies, which are usually in the same area.
  const matchOptions: MatchOptions = {
    threshold: deps.matchThreshold,
    address: company.registeredAddress,
    allowPeople: deps.allowPeoplePages,
  };

  let outcome: ProcessOutcome;
  try {
    outcome = await findLead(company, deps, owner, matchOptions);
  } catch (err) {
    return { ...EMPTY, ...owner, status: "ERROR", errorMessage: errorMessage(err) };
  }
  return withLinkedIn(outcome, company, deps, matchOptions);
}

/** Section 7: direct search, then the owner fallback. Throws on unexpected errors. */
async function findLead(
  company: CompanyInput,
  deps: ProcessDeps,
  owner: Pick<ProcessOutcome, "officerName" | "officerId" | "directorNames">,
  matchOptions: MatchOptions,
): Promise<ProcessOutcome> {
  {
    // 1. Direct search
    const direct = await discover(company.companyName, deps, matchOptions);
    if (direct.facebook || direct.place) {
      // The director is what makes a lead actionable, so look them up for
      // direct matches too. Best effort: one free Companies House request,
      // and a failure here never turns a found lead into an error.
      const director = await lookupDirector(company.companyNumber, deps);
      return { ...EMPTY, ...director, ...discoveryFields(direct), status: "FOUND", matchSource: "BUSINESS" };
    }

    // 2. Owner fallback: one level deep only. We look up the primary
    //    officer's other companies, but never those companies' officers.
    const officers = await deps.companiesHouse.getOfficers(company.companyNumber);
    const selection = selectPrimaryOfficer(officers);
    if (!selection) {
      const anyActive = officers.some((o) => !o.resignedOn);
      return { ...EMPTY, status: "NO_MATCH", note: anyActive ? NOTES.noOfficerLink : NOTES.noOfficers };
    }
    owner.officerName = selection.primary.name;
    owner.officerId = selection.primary.officerId;
    owner.directorNames = selection.activeNames;

    const appointments = await deps.companiesHouse.getOfficerAppointments(selection.primary.officerId);
    const others = selectOtherCompanies(appointments, company.companyNumber, deps.maxOwnerCompanies);
    if (others.length === 0) {
      return { ...EMPTY, ...owner, status: "NO_MATCH", note: NOTES.noOtherCompanies };
    }

    for (const other of others) {
      if (!other.companyName) continue;
      const found = await discover(other.companyName, deps, matchOptions);
      if (found.facebook || found.place) {
        // Stop at the first of the owner's companies that matches.
        return {
          ...EMPTY,
          ...owner,
          ...discoveryFields(found),
          status: "FOUND",
          matchSource: "OWNER_OTHER_BUSINESS",
          matchedViaCompanyName: other.companyName,
          matchedViaCompanyNumber: other.companyNumber,
        };
      }
    }

    return { ...EMPTY, ...owner, status: "NO_MATCH", note: NOTES.noOwnerMatch };
  }
}

/**
 * Adds the LinkedIn company page and the director's profile (spec extension).
 * Runs for found leads, or for every non-error company with `linkedin: "all"`.
 * Best effort: a failed LinkedIn search never changes the lead's status.
 */
async function withLinkedIn(
  outcome: ProcessOutcome,
  company: CompanyInput,
  deps: ProcessDeps,
  matchOptions: MatchOptions,
): Promise<ProcessOutcome> {
  const mode = deps.linkedin ?? "off";
  const wanted = outcome.status === "FOUND" ? mode !== "off" : outcome.status === "NO_MATCH" && mode === "all";
  if (!wanted) return outcome;

  // The business that was actually found online is the best name to search.
  const businessName = outcome.matchedViaCompanyName ?? company.companyName;
  const person = outcome.officerName ? parseOfficerName(outcome.officerName) : null;
  const options = { ...matchOptions, threshold: deps.matchThreshold };

  const [companyPage, profile] = await Promise.all([
    deps.search
      .searchLinkedInCompany(businessName)
      .then((results) => pickBestLinkedInCompany(businessName, results, options))
      .catch((err: unknown) => {
        console.warn(`[process] LinkedIn company search failed for ${company.companyNumber}: ${errorMessage(err)}`);
        return null;
      }),
    person
      ? deps.search
          .searchLinkedInPeople(`${person.first} ${person.last}`, businessName)
          .then((results) =>
            pickBestLinkedInProfile(person, [company.companyName, ...(outcome.matchedViaCompanyName ? [outcome.matchedViaCompanyName] : [])], results, options),
          )
          .catch((err: unknown) => {
            console.warn(`[process] LinkedIn profile search failed for ${company.companyNumber}: ${errorMessage(err)}`);
            return null;
          })
      : Promise.resolve(null),
  ]);

  return {
    ...outcome,
    linkedinCompanyUrl: companyPage?.url ?? null,
    linkedinCompanyScore: companyPage ? round(companyPage.score) : null,
    linkedinDirectorUrl: profile?.url ?? null,
    linkedinDirectorScore: profile ? round(profile.score) : null,
  };
}

type DirectorFields = Pick<ProcessOutcome, "officerName" | "officerId" | "directorNames">;

/** Primary director and all active director names, or empty fields if unavailable. */
async function lookupDirector(companyNumber: string, deps: ProcessDeps): Promise<DirectorFields> {
  try {
    const officers = await deps.companiesHouse.getOfficers(companyNumber);
    const selection = selectPrimaryOfficer(officers);
    if (selection) {
      return { officerName: selection.primary.name, officerId: selection.primary.officerId, directorNames: selection.activeNames };
    }
    // No appointments link: still show who the active officers are.
    const active = officers.filter((o) => !o.resignedOn);
    const directors = active.filter((o) => o.role.toLowerCase() === "director");
    const names = (directors.length > 0 ? directors : active).map((o) => o.name);
    return { officerName: names[0] ?? null, officerId: null, directorNames: names };
  } catch (err) {
    console.warn(`[process] could not fetch directors for ${companyNumber}: ${errorMessage(err)}`);
    return { officerName: null, officerId: null, directorNames: [] };
  }
}

async function discover(name: string, deps: ProcessDeps, options: MatchOptions): Promise<Discovery> {
  const [fbResults, places] = await Promise.all([deps.search.searchFacebook(name), deps.search.searchBusinessProfile(name)]);
  // Google listings are already restricted to UK addresses.
  const place = pickBestPlace(name, places, options);
  // Same-named pages abroad are common (seen live: US, Peru, India, Jamaica).
  // Foreign pages and personal profiles are always dropped; with no Google
  // listing to back it up, a page must also show UK evidence ("strict").
  const check = deps.facebookLocationCheck ?? "off";
  const candidates =
    check === "off"
      ? fbResults
      : fbResults.filter((r) => facebookLocationAllowed(r, options.address, name, check === "strict" && !place));
  const fb = pickBestFacebookResult(name, candidates, options);
  return {
    facebook: fb && { url: fb.url, score: fb.score },
    place: place && { place: place.candidate, score: place.score },
  };
}

function discoveryFields(d: Discovery): Partial<ProcessOutcome> {
  const p = d.place?.place;
  return {
    facebookUrl: d.facebook?.url ?? null,
    facebookScore: d.facebook ? round(d.facebook.score) : null,
    googleBusinessUrl: p ? placeUrl(p) : null,
    googleBusinessName: p?.title ?? null,
    googleBusinessAddress: p?.address ?? null,
    googleBusinessPhone: p?.phoneNumber ?? null,
    googleBusinessWebsite: p?.website ?? null,
    googleBusinessScore: d.place ? round(d.place.score) : null,
  };
}

/** Maps link for a place; a Maps search link when the provider gave no cid. */
export function placeUrl(place: PlaceResult): string {
  if (place.mapsUrl) return place.mapsUrl;
  const query = [place.title, place.address].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 1000) || "Unknown error";
}

/**
 * Processes companies one after another. A failing company becomes an ERROR
 * outcome and the rest still run. `onOutcome` lets the caller persist each
 * result as soon as it is ready.
 */
export async function processCompanies<T extends CompanyInput>(
  companies: readonly T[],
  deps: ProcessDeps,
  onOutcome?: (company: T, outcome: ProcessOutcome) => Promise<void>,
): Promise<Array<{ company: T; outcome: ProcessOutcome }>> {
  const results: Array<{ company: T; outcome: ProcessOutcome }> = [];
  for (const company of companies) {
    const outcome = await processCompany(company, deps);
    await onOutcome?.(company, outcome);
    results.push({ company, outcome });
  }
  return results;
}
