"use client";

import { useState } from "react";
import type { JobSummary } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { fmtNumber } from "./format";

/**
 * Stacked meter of where every company in the run stands. Status colours
 * (good / neutral / critical) are paired with labels and counts in the legend,
 * so colour never carries meaning alone. Queued work is the empty track.
 */
export function StatusMeter({ job }: { job: JobSummary }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = Math.max(job.totalCompanies, 1);
  const queued = Math.max(0, job.totalCompanies - job.processedCount);

  const segments = [
    { id: "found", label: "Found", value: job.foundCount, fill: "bg-status-good" },
    { id: "no_match", label: "No match", value: job.noMatchCount, fill: "bg-status-neutral" },
    { id: "error", label: "Errors", value: job.errorCount, fill: "bg-status-critical" },
  ];
  const shown = segments.filter((s) => s.value > 0);
  const pct = (n: number) => (n / total) * 100;
  const fmtPct = (n: number) => {
    const p = pct(n);
    return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
  };

  return (
    <div>
      <div className="relative">
        <div
          className="bg-muted flex h-3 w-full gap-[2px] overflow-hidden rounded-full"
          role="img"
          aria-label={`${fmtNumber(job.foundCount)} found, ${fmtNumber(job.noMatchCount)} no match, ${fmtNumber(job.errorCount)} errors, ${fmtNumber(queued)} queued`}
        >
          {shown.map((s) => (
            <div
              key={s.id}
              onMouseEnter={() => setHover(s.id)}
              onMouseLeave={() => setHover(null)}
              className={cn(
                "h-full min-w-[3px] transition-[width,opacity] duration-700 ease-out first:rounded-l-full",
                s.fill,
                hover && hover !== s.id && "opacity-40",
              )}
              style={{ width: `${pct(s.value)}%` }}
            />
          ))}
        </div>
        {hover && (
          <div className="bg-popover text-popover-foreground pointer-events-none absolute -top-10 left-1/2 z-10 -translate-x-1/2 rounded-lg border px-2.5 py-1 text-xs whitespace-nowrap shadow-lg">
            {(() => {
              const s = segments.find((x) => x.id === hover)!;
              return (
                <>
                  <span className="font-medium">{s.label}</span> · {fmtNumber(s.value)} ({fmtPct(s.value)})
                </>
              );
            })()}
          </div>
        )}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
        {segments.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-1.5"
            onMouseEnter={() => s.value > 0 && setHover(s.id)}
            onMouseLeave={() => setHover(null)}
          >
            <span className={cn("size-2 rounded-full", s.fill)} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-medium tabular-nums">{fmtNumber(s.value)}</span>
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="bg-muted size-2 rounded-full ring-1 ring-black/10 ring-inset dark:ring-white/15" />
          <span className="text-muted-foreground">Queued</span>
          <span className="font-medium tabular-nums">{fmtNumber(queued)}</span>
        </li>
      </ul>
    </div>
  );
}
