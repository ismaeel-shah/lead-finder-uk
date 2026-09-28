import { CircleAlert, CircleCheck, CircleDashed, Coins } from "lucide-react";
import type { JobSummary } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { fmtNumber } from "./format";

/** Headline numbers for a run. Each tile pairs its status colour with an icon and a label. */
export function KpiTiles({ job }: { job: JobSummary }) {
  const processed = job.processedCount;
  const rate = (n: number) => (processed > 0 ? `${Math.round((n / processed) * 100)}% of processed` : "—");
  const direct = job.foundCount - job.viaOwnerCount;

  const tiles = [
    {
      label: "Leads found",
      value: job.foundCount,
      sub: job.foundCount > 0 ? `${fmtNumber(direct)} direct · ${fmtNumber(job.viaOwnerCount)} via owner` : rate(job.foundCount),
      Icon: CircleCheck,
      icon: "text-status-good bg-status-good/10",
    },
    {
      label: "No match",
      value: job.noMatchCount,
      sub: rate(job.noMatchCount),
      Icon: CircleDashed,
      icon: "text-status-neutral bg-status-neutral/12",
    },
    {
      label: "Errors",
      value: job.errorCount,
      sub: job.errorCount > 0 ? "Retry them from the toolbar" : "None so far",
      Icon: CircleAlert,
      icon: "text-status-critical bg-status-critical/10",
    },
    {
      label: "Search credits",
      value: job.searchCreditsUsed,
      sub: processed > 0 ? `${(job.searchCreditsUsed / processed).toFixed(1)} per company` : "Cached searches are free",
      Icon: Coins,
      icon: "text-primary bg-primary/10",
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map(({ label, value, sub, Icon, icon }) => (
        <div key={label} className="bg-card rounded-2xl border p-4 shadow-xs sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground text-[13px] font-medium">{label}</dt>
            <span className={cn("flex size-7 items-center justify-center rounded-lg", icon)}>
              <Icon className="size-4" />
            </span>
          </div>
          <dd className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{fmtNumber(value)}</dd>
          <dd className="text-muted-foreground mt-1 truncate text-xs">{sub}</dd>
        </div>
      ))}
    </dl>
  );
}
