"use client";

import { AlertTriangle, KeyRound, Menu, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";
import { useJobRunner } from "@/hooks/use-job-runner";
import { api, errorText, type JobListItem, type JobSummary, type KeysResponse, type KeysSummary } from "@/lib/client/api";
import { DeleteRunDialog } from "./delete-run-dialog";
import { fmtNumber } from "./format";
import { JobView, JobViewSkeleton } from "./job-view";
import { NewRunDialog } from "./new-run-dialog";
import { SearchKeysSheet } from "./search-keys-sheet";
import { BrandMark, Sidebar } from "./sidebar";
import { Welcome } from "./welcome";

interface Props {
  today: string;
  maxOwnerCompanies: number;
  configProblems: string[];
  missingSearchKey: boolean;
  passwordEnabled: boolean;
}

const HISTORY_REFRESH_MS = 15_000;

/** The selected run lives in ?job=<id>, so reloading or reopening the link returns to it. */
function readJobParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("job");
}

export function Dashboard({ today, maxOwnerCompanies, configProblems, missingSearchKey, passwordEnabled }: Props) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobListItem[] | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [newRunOpen, setNewRunOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [keys, setKeys] = useState<KeysSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<JobListItem | null>(null);
  const runner = useJobRunner(jobId);
  const { job } = runner;

  useEffect(() => {
    setJobId(readJobParam());
    const onPop = () => setJobId(readJobParam());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // "N" opens a new run (unless the user is typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key.toLowerCase() !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      e.preventDefault();
      setNewRunOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectJob = useCallback((id: string | null) => {
    setJobId(id);
    setNavOpen(false);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("job", id);
    else url.searchParams.delete("job");
    window.history.pushState(null, "", url);
    window.scrollTo({ top: 0 });
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const res = await api<{ jobs: JobListItem[] }>("/jobs");
      setJobs(res.jobs);
      setJobsError(null);
    } catch (err) {
      setJobsError(errorText(err));
    }
  }, []);

  const loadKeys = useCallback(async () => {
    try {
      setKeys((await api<KeysResponse>("/settings/search-keys")).summary);
    } catch {
      // The sidebar shows "Loading…"; the keys panel shows the error when opened.
    }
  }, []);

  const active = job?.status === "RUNNING" || job?.status === "FETCHING";
  useEffect(() => {
    void loadJobs();
  }, [loadJobs, job?.status, job?.id]);
  // Balances change while a run spends credits; refresh with the run list.
  useEffect(() => {
    void loadKeys();
  }, [loadKeys, job?.status, job?.searchCreditsUsed]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(loadJobs, HISTORY_REFRESH_MS);
    return () => clearInterval(t);
  }, [active, loadJobs]);

  // Celebrate the end of a run once, when it happens while the page is open.
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!job) return;
    const prev = lastStatus.current;
    lastStatus.current = `${job.id}:${job.status}`;
    if (prev === `${job.id}:RUNNING` && job.status === "COMPLETED") {
      toast.success("Run complete", {
        description: `${fmtNumber(job.foundCount)} ${job.foundCount === 1 ? "lead" : "leads"} found in ${fmtNumber(job.totalCompanies)} ${job.totalCompanies === 1 ? "company" : "companies"}.`,
      });
    }
    if (prev === `${job.id}:RUNNING` && job.status === "PAUSED" && job.errorMessage) {
      toast.warning("Run paused", { description: job.errorMessage });
    }
    if (prev === `${job.id}:FETCHING` && job.status === "READY") {
      toast.success(`${fmtNumber(job.totalCompanies)} companies fetched`, { description: "Review the estimate, then start processing." });
    }
  }, [job]);

  const onCreated = (created: JobSummary) => {
    runner.setJob(created);
    selectJob(created.id);
    void loadJobs();
    if (created.status === "READY") {
      toast.success(`${fmtNumber(created.totalCompanies)} companies fetched`, { description: "Review the estimate, then start processing." });
    }
  };

  const withToast = (fn: () => Promise<boolean>, success: string) => async () => {
    if (await fn()) toast.success(success);
  };

  const sidebar = (
    <Sidebar
      jobs={jobs}
      error={jobsError}
      selectedId={jobId}
      passwordEnabled={passwordEnabled}
      onSelect={selectJob}
      onNewRun={() => {
        setNavOpen(false);
        setNewRunOpen(true);
      }}
      onDelete={(j) => {
        setNavOpen(false);
        setPendingDelete(j);
      }}
      keys={keys}
      onOpenKeys={() => {
        setNavOpen(false);
        setKeysOpen(true);
      }}
    />
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="bg-sidebar border-sidebar-border sticky top-0 hidden h-screen w-72 shrink-0 border-r lg:block">{sidebar}</aside>

      {/* Mobile navigation */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="bg-sidebar p-0" hideClose>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>

      <div className="bg-glow flex min-w-0 flex-1 flex-col bg-no-repeat">
        <header className="bg-background/80 sticky top-0 z-30 flex items-center gap-3 border-b px-4 py-3 backdrop-blur-md lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setNavOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <BrandMark className="size-8" />
          <span className="font-semibold tracking-tight">Lead Finder</span>
          <Button size="icon" className="ml-auto" onClick={() => setNewRunOpen(true)} aria-label="New run">
            <Plus />
          </Button>
        </header>

        {configProblems.length > 0 && (
          <div className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-8">
            <div className="flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-50 p-4 text-amber-950 dark:bg-amber-400/10 dark:text-amber-100" role="alert">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-300" />
              <div className="min-w-0 text-sm">
                <p className="font-semibold">Setup needed</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {configProblems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <p className="mt-1.5 opacity-80">Add these to your .env file (or Vercel project settings), then restart the app.</p>
              </div>
            </div>
          </div>
        )}

        {missingSearchKey && keys?.total === 0 && (
          <div className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-8">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-400/10 dark:text-amber-100" role="alert">
              <KeyRound className="size-5 shrink-0 text-amber-600 dark:text-amber-300" />
              <p className="min-w-0 flex-1">
                <span className="font-semibold">Add a search API key.</span> Runs need a Serper key to look companies up online.
              </p>
              <Button size="sm" onClick={() => setKeysOpen(true)}>
                <Plus /> Add key
              </Button>
            </div>
          </div>
        )}

        <main className="flex-1">
          {!jobId && <Welcome jobs={jobs} onNewRun={() => setNewRunOpen(true)} />}
          {jobId && !job && runner.loading && <JobViewSkeleton />}
          {jobId && !job && !runner.loading && runner.loadError && (
            <div className="mx-auto max-w-md px-4 py-24 text-center">
              <p className="font-semibold">Couldn’t open this run</p>
              <p className="text-muted-foreground mt-1 text-sm">{runner.loadError}</p>
              <Button variant="outline" className="mt-5" onClick={() => selectJob(null)}>
                Back to start
              </Button>
            </div>
          )}
          {job && (
            <JobView
              job={job}
              maxOwnerCompanies={maxOwnerCompanies}
              busyAction={runner.busyAction}
              driverError={runner.driverError}
              onPause={withToast(runner.pause, "Run paused")}
              onResume={withToast(runner.resume, job.status === "READY" ? "Processing started" : "Run resumed")}
              onRetryErrors={withToast(runner.retryErrors, "Errors queued for retry")}
              onRetryFetch={runner.retryFetch}
              onRestart={runner.restart}
              onOpenKeys={() => setKeysOpen(true)}
            />
          )}
        </main>
      </div>

      <SearchKeysSheet open={keysOpen} onOpenChange={setKeysOpen} onChanged={loadKeys} />
      <NewRunDialog open={newRunOpen} onOpenChange={setNewRunOpen} today={today} onCreated={onCreated} />
      <DeleteRunDialog
        job={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onDeleted={(id) => {
          setJobs((list) => list?.filter((j) => j.id !== id) ?? list);
          if (id === jobId) selectJob(null);
          void loadJobs();
        }}
      />
    </div>
  );
}
