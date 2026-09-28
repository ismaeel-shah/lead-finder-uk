/**
 * Smoke test for the Companies House client against the live API.
 *
 *   npm run test:ch               # companies incorporated yesterday
 *   npm run test:ch -- 2026-09-01 # a specific date
 *
 * Prints 5 companies, then runs the owner-fallback lookups for the first one.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const {
    getCompaniesHouseClient,
    selectOtherCompanies,
    selectPrimaryOfficer,
  } = await import("../lib/companiesHouse");

  const date = process.argv[2] ?? yesterdayInLondon();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);

  const client = getCompaniesHouseClient();
  console.log(`Fetching 5 companies incorporated on ${date}...\n`);
  const page = await client.searchNewCompaniesPage({ incorporatedFrom: date, incorporatedTo: date }, 0, 5);
  console.log(`Total hits reported: ${page.hits ?? "unknown"}\n`);

  if (page.items.length === 0) {
    console.log("No companies found. Try another date: npm run test:ch -- YYYY-MM-DD");
    return;
  }

  console.table(
    page.items.map((c) => ({
      number: c.companyNumber,
      name: c.companyName,
      created: c.dateOfCreation,
      type: c.companyType,
      status: c.companyStatus,
      postcode: c.registeredOfficeAddress?.postal_code ?? "",
      sic: c.sicCodes.join(","),
    })),
  );

  const first = page.items[0]!;
  console.log(`\nOfficers of ${first.companyName} (${first.companyNumber}):`);
  const officers = await client.getOfficers(first.companyNumber);
  console.table(officers.map((o) => ({ name: o.name, role: o.role, appointed: o.appointedOn, resigned: o.resignedOn ?? "", id: o.officerId })));

  const selection = selectPrimaryOfficer(officers);
  if (!selection) {
    console.log("No active officer with an appointments link.");
    return;
  }
  console.log(`\nPrimary officer: ${selection.primary.name} (${selection.primary.officerId})`);
  const appointments = await client.getOfficerAppointments(selection.primary.officerId);
  const others = selectOtherCompanies(appointments, first.companyNumber, 10);
  console.log(`Other companies (${others.length}):`);
  console.table(others.map((a) => ({ number: a.companyNumber, name: a.companyName, status: a.companyStatus, appointed: a.appointedOn })));
}

function yesterdayInLondon(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
}

main().catch((err: unknown) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
