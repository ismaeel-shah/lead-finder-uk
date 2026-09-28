export const LARGE_RUN = 2000;

/**
 * Search credits: ~2 per company direct (3 when Places is empty and the
 * organic fallback runs), up to 3 per owner company in the fallback.
 */
export function estimateCredits(companies: number, maxOwnerCompanies: number) {
  return {
    directLow: companies * 2,
    directHigh: companies * 3,
    fallbackMax: companies * 3 * maxOwnerCompanies,
    /** Measured on live data: about 4 per company including fallbacks. */
    typical: companies * 4,
  };
}
