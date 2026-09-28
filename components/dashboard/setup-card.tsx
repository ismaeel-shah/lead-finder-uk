"use client";

import { AlertTriangle, Building2, LoaderCircle, Play, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JobSummary } from "@/lib/client/api";
import { estimateCredits, LARGE_RUN } from "./credits";
import { fmtNumber } from "./format";

interface Props {
  job: JobSummary;
  maxOwnerCompanies: number;
  busy: boolean;
  onStart: () => void;
  onRetryFetch: () => void;
}

/** Shown while a run is being fetched, failed to fetch, or is ready to start. */
export function SetupCard({ job, maxOwnerCompanies, busy, onStart, onRetryFetch }: Props) {
  if (job.status === "FETCHING") {
    return (
      <div className="bg-card relative overflow-hidden rounded-2xl border p-8 text-center shadow-xs" aria-live="polite">
        <div className="bg-dots absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
        <div className="relative">
          <div className="bg-brand-soft text-accent-foreground mx-auto flex size-14 items-center justify-center rounded-2xl">
            <LoaderCircle className="size-7 animate-spin" />
          </div>
          <h2 className="mt-5 text-lg font-semibold tracking-tight">Fetching companies from Companies House</h2>
          <p className="text-muted-foreground mt-1 text-sm">Large ranges take a few requests. You can leave this page open.</p>
          <p className="mt-5 text-4xl font-semibold tracking-tight">{fmtNumber(job.totalCompanies)}</p>
          <p className="text-muted-foreground text-sm">companies so far</p>
          <div className="bg-muted mx-auto mt-6 h-1 max-w-xs overflow-hidden rounded-full">
            <div className="bg-primary h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  if (job.status === "FAILED") {
    return (
      <div className="bg-card rounded-2xl border p-6 shadow-xs" role="alert">
        <div className="flex gap-4">
          <div className="bg-status-critical/10 text-status-critical flex size-10 shrink-0 items-center justify-center rounded-xl">
            <AlertTriangle className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold tracking-tight">Fetching stopped</h2>
            <p className="text-muted-foreground mt-1 text-sm break-words">{job.errorMessage ?? "Unknown error"}</p>
            <p className="text-muted-foreground mt-1 text-sm">{fmtNumber(job.totalCompanies)} companies were saved before it stopped.</p>
            <Button className="mt-4" variant="outline" onClick={onRetryFetch} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : <RotateCcw />} Continue fetching
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (job.status !== "READY") return null;

  const n = job.totalCompanies;
  const est = estimateCredits(n, maxOwnerCompanies);
  const large = n > LARGE_RUN;

  return (
    <div className="bg-card overflow-hidden rounded-2xl border shadow-xs">
      <div className="grid gap-0 md:grid-cols-[1fr_1.2fr]">
        <div className="bg-glow flex flex-col justify-center border-b p-6 md:border-r md:border-b-0 md:p-8">
          <div className="bg-status-good/10 text-status-good flex size-10 items-center justify-center rounded-xl">
            <Building2 className="size-5" />
          </div>
          <p className="mt-4 text-5xl font-semibold tracking-tight">{fmtNumber(n)}</p>
          <p className="text-muted-foreground mt-1">{n === 1 ? "company" : "companies"} ready to process</p>
        </div>
        <div className="flex flex-col justify-center gap-4 p-6 md:p-8">
          {n > 0 ? (
            <>
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Sparkles className="text-primary size-4" /> Estimated search credits
                </p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">≈ {fmtNumber(est.typical)}</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {fmtNumber(est.directLow)}–{fmtNumber(est.directHigh)} for direct searches, plus up to {fmtNumber(est.fallbackMax)} in the
                  worst case for the director fallback. LinkedIn adds up to 2 per lead found. Searches already cached are free.
                </p>
              </div>
              {large && (
                <p className="flex gap-2 rounded-xl border border-amber-500/25 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  This is a large run. Consider narrowing the dates or adding filters to save credits.
                </p>
              )}
              <Button size="lg" onClick={onStart} disabled={busy} className="self-start">
                {busy ? <LoaderCircle className="animate-spin" /> : <Play />} Start processing
              </Button>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">No companies match this range and these filters. Try widening the dates.</p>
          )}
        </div>
      </div>
    </div>
  );
}
