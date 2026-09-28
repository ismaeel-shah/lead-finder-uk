/**
 * Re-checks saved matches with the location checks, using saved data and the
 * search cache only (no search credits). Results found before these checks
 * existed can include same-named businesses abroad and personal profiles.
 *
 *   npm run recheck:facebook              # dry run: show what would change
 *   npm run recheck:facebook -- --apply   # remove the rejected links
 *   npm run recheck:facebook -- --requeue # instead, queue those companies to be processed again
 *
 * Checked: Google listings must have a UK address (or none); Facebook pages
 * must not be abroad or a personal profile, and with FACEBOOK_LOCATION_CHECK
 * =strict a page with no remaining Google listing must show UK evidence.
 * With --apply, a company left with no links becomes "No match". With
 * --requeue it goes back to the queue, so Resume re-processes it with the new
 * rules, including the director fallback (which may spend credits).
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { getConfigStatus } = await import("../lib/env");
  const { classifyLocation, facebookLocationAllowed, isPersonalProfile, isUkBusinessAddress } = await import("../lib/location");
  const { normaliseFacebookUrl, searchName } = await import("../lib/matching");
  const { refreshCounters } = await import("../lib/jobs");
  const { NOTES } = await import("../lib/processCompany");
  const { SERPER_LOCATION } = await import("../lib/search/serper");

  const apply = process.argv.includes("--apply");
  const requeue = process.argv.includes("--requeue");
  const mode = getConfigStatus().config?.FACEBOOK_LOCATION_CHECK ?? "strict";

  const prisma = new PrismaClient({ log: [] });
  try {
    const rows = await prisma.companyResult.findMany({
      where: { status: "FOUND" },
      select: {
        id: true,
        jobId: true,
        companyName: true,
        matchedViaCompanyName: true,
        facebookUrl: true,
        googleBusinessUrl: true,
        googleBusinessName: true,
        googleBusinessAddress: true,
        registeredAddress: true,
      },
    });

    interface Change {
      id: string;
      jobId: string;
      dropGoogle: boolean;
      dropFacebook: boolean;
      nothingLeft: boolean;
      line: string;
    }
    const changes: Change[] = [];
    let unverifiableFacebook = 0;

    for (const r of rows) {
      const name = r.matchedViaCompanyName ?? r.companyName;
      const address = r.registeredAddress as { locality?: string; postal_code?: string } | null;
      const reasons: string[] = [];

      const dropGoogle = !!r.googleBusinessUrl && !isUkBusinessAddress(r.googleBusinessAddress);
      if (dropGoogle) reasons.push(`Google listing abroad: ${r.googleBusinessAddress}`);
      const googleLeft = !!r.googleBusinessUrl && !dropGoogle;

      let dropFacebook = false;
      if (r.facebookUrl && mode !== "off") {
        const q = `site:facebook.com "${searchName(name)}"`;
        const entry = await prisma.searchCache.findFirst({ where: { type: "facebook", query: { in: [`${q} @${SERPER_LOCATION}`, q] } } });
        const hit = ((entry?.response ?? []) as { title: string; link: string; snippet: string | null }[]).find(
          (x) => normaliseFacebookUrl(x.link) === r.facebookUrl,
        );
        if (!hit) {
          unverifiableFacebook++; // no cached result to judge: leave it alone
        } else if (!facebookLocationAllowed(hit, address, name, mode === "strict" && !googleLeft)) {
          dropFacebook = true;
          const v = classifyLocation(hit, address, name);
          reasons.push(`Facebook "${hit.title}": ${isPersonalProfile(hit.snippet) ? "personal profile" : "reason" in v ? v.reason : "no UK evidence"}`);
        }
      }

      if (dropGoogle || dropFacebook) {
        const facebookLeft = !!r.facebookUrl && !dropFacebook;
        changes.push({
          id: r.id,
          jobId: r.jobId,
          dropGoogle,
          dropFacebook,
          nothingLeft: !googleLeft && !facebookLeft,
          line: `  ${r.companyName.slice(0, 40).padEnd(40)} ${reasons.join("; ").slice(0, 140)}`,
        });
      }
    }

    const noneLeft = changes.filter((c) => c.nothingLeft);
    console.log(`Checked ${rows.length} found leads (Facebook check: ${mode}).`);
    console.log(`  unchanged: ${rows.length - changes.length}`);
    console.log(`  Google listings abroad: ${changes.filter((c) => c.dropGoogle).length}`);
    console.log(`  Facebook pages rejected: ${changes.filter((c) => c.dropFacebook).length}`);
    console.log(`  leads with no link left (would become "No match"): ${noneLeft.length}`);
    console.log(`  leads that keep another link: ${changes.length - noneLeft.length}`);
    if (unverifiableFacebook) console.log(`  Facebook pages not in the cache, left unchanged: ${unverifiableFacebook}`);
    if (changes.length) console.log(`\nChanges:\n${changes.map((c) => c.line).join("\n")}`);

    if (!apply && !requeue) {
      console.log("\nDry run: nothing changed. Add --apply to remove these links, or --requeue to process those companies again.");
      return;
    }

    const googleCleared = {
      googleBusinessUrl: null,
      googleBusinessName: null,
      googleBusinessAddress: null,
      googleBusinessPhone: null,
      googleBusinessWebsite: null,
      googleBusinessScore: null,
    };
    const facebookCleared = { facebookUrl: null, facebookScore: null };
    for (const c of changes.filter((x) => !x.nothingLeft)) {
      await prisma.companyResult.update({
        where: { id: c.id },
        data: { ...(c.dropGoogle ? googleCleared : {}), ...(c.dropFacebook ? facebookCleared : {}) },
      });
    }
    const ids = noneLeft.map((c) => c.id);
    if (ids.length) {
      const reset = {
        ...googleCleared,
        ...facebookCleared,
        linkedinCompanyUrl: null,
        linkedinCompanyScore: null,
        matchSource: null,
        matchedViaCompanyName: null,
        matchedViaCompanyNumber: null,
      };
      await prisma.companyResult.updateMany({
        where: { id: { in: ids } },
        data: requeue ? { ...reset, status: "PENDING", note: null, claimedAt: null } : { ...reset, status: "NO_MATCH", note: NOTES.facebookRejected },
      });
    }

    const jobIds = [...new Set(changes.map((c) => c.jobId))];
    for (const jobId of jobIds) {
      await refreshCounters(prisma, jobId);
      // A completed run must be resumable to pick up re-queued companies.
      if (requeue && ids.length) await prisma.job.updateMany({ where: { id: jobId, status: "COMPLETED" }, data: { status: "PAUSED" } });
    }
    console.log(
      requeue
        ? `\nRe-queued ${ids.length} companies and cleaned ${changes.length - ids.length} more. Open the runs and press Resume.`
        : `\nUpdated ${changes.length} leads in ${jobIds.length} runs (${ids.length} are now "No match").`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
