"use client";

import { AlertTriangle, FileSpreadsheet, FileText, KeyRound, LoaderCircle, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { JobSummary } from "@/lib/client/api";
import { OUT_OF_CREDITS_MESSAGE } from "@/lib/search/types";
import { JobStatusBadge } from "./badges";
import { fmtFilters, fmtNumber, fmtRange, fmtRelative } from "./format";
import { KpiTiles } from "./kpi-tiles";
import { ResultsTable } from "./results-table";
import { SetupCard } from "./setup-card";
import { StatusMeter } from "./status-meter";

interface Props {
  job: JobSummary;
  maxOwnerCompanies: number;
  busyAction: string | null;
  driverError: { message: string; retrying: boolean } | null;
  onPause: () => void;
  onResume: () => void;
  onRetryErrors: () => void;
  onRetryFetch: () => void;
  onRestart: () => void;
  onOpenKeys: () => void;
}

export function JobView({ job, maxOwnerCompanies, busyAction, driverError, onPause, onResume, onRetryErrors, onRetryFetch, onRestart, onOpenKeys }: Props) {
  const setup = job.status === "FETCHING" || job.status === "FAILED" || job.status === "READY";
  const busy = busyAction !== null;
  const pct = job.totalCompanies > 0 ? Math.round((job.processedCount / job.totalCompanies) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{fmtRange(job.incorporatedFrom, job.incorporatedTo)}</h1>
            <JobStatusBadge status={job.status} />
          </div>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {fmtFilters(job.filters)} · created {fmtRelative(job.createdAt)}
          </p>
        </div>
        {!setup && (
          <div className="flex flex-wrap gap-2">
            {job.status === "RUNNING" && (
              <Button variant="outline" onClick={onPause} disabled={busy}>
                {busyAction === "pause" ? <LoaderCircle className="animate-spin" /> : <Pause />} Pause
              </Button>
            )}
            {job.status === "PAUSED" && (
              <Button onClick={onResume} disabled={busy}>
                {busyAction === "resume" ? <LoaderCircle className="animate-spin" /> : <Play />} Resume
              </Button>
            )}
            {job.errorCount > 0 && (
              <Button variant="outline" onClick={onRetryErrors} disabled={busy}>
                {busyAction === "retry-errors" ? <LoaderCircle className="animate-spin" /> : <RotateCcw />} Retry {fmtNumber(job.errorCount)}{" "}
                {job.errorCount === 1 ? "error" : "errors"}
              </Button>
            )}
            <div className="bg-card flex rounded-lg border shadow-xs">
              <Button variant="ghost" asChild className="rounded-r-none">
                <a href={`/api/jobs/${job.id}/export.xlsx`} download title="Formatted workbook with Summary, Leads and All companies sheets">
                  <FileSpreadsheet className="text-emerald-600 dark:text-emerald-400" /> Export Excel
                </a>
              </Button>
              <span className="bg-border w-px" aria-hidden="true" />
              <Button variant="ghost" asChild className="text-muted-foreground rounded-l-none px-3">
                <a href={`/api/jobs/${job.id}/export.csv`} download title="Raw data (CSV) for importing into other tools">
                  <FileText /> CSV
                </a>
              </Button>
            </div>
          </div>
        )}
      </header>

      {job.status === "PAUSED" && job.errorMessage && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-400/10 dark:text-amber-100" role="alert">
          <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-300" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">Paused automatically.</span> {job.errorMessage}
          </span>
          {(job.errorMessage === OUT_OF_CREDITS_MESSAGE || /credits/i.test(job.errorMessage)) && (
            <Button size="sm" variant="outline" onClick={onOpenKeys}>
              <KeyRound /> Manage keys
            </Button>
          )}
          <Button size="sm" onClick={onResume} disabled={busy}>
            <Play /> Resume
          </Button>
        </div>
      )}

      {driverError && (
        <div
          className="border-status-critical/25 bg-status-critical/5 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm"
          role="alert"
        >
          <AlertTriangle className="text-status-critical size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {driverError.message}
            {driverError.retrying && <span className="text-muted-foreground"> Retrying automatically…</span>}
          </span>
          {!driverError.retrying && (
            <Button size="sm" variant="outline" onClick={onRestart}>
              Try again
            </Button>
          )}
        </div>
      )}

      {setup ? (
        <SetupCard job={job} maxOwnerCompanies={maxOwnerCompanies} busy={busy} onStart={onResume} onRetryFetch={onRetryFetch} />
      ) : (
        <>
          <section className="bg-card rounded-2xl border p-5 shadow-xs sm:p-6" aria-label="Progress">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-muted-foreground text-[13px] font-medium">Progress</p>
                <p className="mt-0.5 text-2xl font-semibold tracking-tight">
                  {pct}%<span className="text-muted-foreground ml-2 text-sm font-normal">
                    {fmtNumber(job.processedCount)} of {fmtNumber(job.totalCompanies)} companies
                  </span>
                </p>
              </div>
              {job.status === "RUNNING" && (
                <p className="text-primary flex items-center gap-1.5 text-xs font-medium">
                  <LoaderCircle className="size-3.5 animate-spin" /> Processing — keep this tab open
                </p>
              )}
              {job.status === "PAUSED" && <p className="text-muted-foreground text-xs">Paused. Resume to continue where it stopped.</p>}
              {job.status === "COMPLETED" && <p className="text-muted-foreground text-xs">All companies processed.</p>}
            </div>
            <StatusMeter job={job} />
          </section>
          <KpiTiles job={job} />
        </>
      )}

      {job.totalCompanies > 0 && job.status !== "FETCHING" && <ResultsTable job={job} />}
    </div>
  );
}

export function JobViewSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-28 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-96 w-full rounded-2xl" />
    </div>
  );
}
