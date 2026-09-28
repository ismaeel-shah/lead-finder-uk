import { Dashboard } from "@/components/dashboard/dashboard";
import { appPassword } from "@/lib/auth";
import { todayInLondon } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { getConfigStatus } from "@/lib/env";

// Read env on every request so config problems show up without a rebuild.
export const dynamic = "force-dynamic";

/** Serper keys can come from .env or from Settings (the database). */
async function hasSearchKey(envKey: string | undefined): Promise<boolean> {
  if (envKey) return true;
  try {
    return (await prisma.searchApiKey.count({ where: { provider: "serper", enabled: true } })) > 0;
  } catch {
    return true; // database problems are reported separately
  }
}

export default async function DashboardPage() {
  const { config, problems } = getConfigStatus();
  const missingSearchKey = config?.SEARCH_PROVIDER !== "google_cse" && !(await hasSearchKey(config?.SERPER_API_KEY));
  return (
    <Dashboard
      today={todayInLondon()}
      maxOwnerCompanies={config?.MAX_OWNER_COMPANIES ?? 10}
      configProblems={problems}
      missingSearchKey={missingSearchKey}
      passwordEnabled={appPassword() !== null}
    />
  );
}
