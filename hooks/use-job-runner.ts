"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError, errorText, post, type BatchResult, type FetchStepResult, type JobSummary } from "@/lib/client/api";

const POLL_MS = 3000;
const MAX_BACKOFF_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Loads a job and drives it. There is no server-side background worker: while
 * the job is FETCHING or RUNNING, this hook keeps calling /fetch or /process.
 * Closing the tab therefore pauses the work; reopening the job resumes it.
 */
export function useJobRunner(jobId: string | null) {
  const [job, setJob] = useState<JobSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Problem reported by the fetch/process loop (null when healthy). */
  const [driverError, setDriverError] = useState<{ message: string; retrying: boolean } | null>(null);
  const [restartKey, setRestartKey] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const jobIdRef = useRef(jobId);
  jobIdRef.current = jobId;

  const refresh = useCallback(async () => {
    if (!jobId) return;
    try {
      const { job } = await api<{ job: JobSummary }>(`/jobs/${jobId}`);
      if (jobIdRef.current === jobId) {
        setJob(job);
        setLoadError(null);
      }
    } catch (err) {
      if (jobIdRef.current === jobId) setLoadError(errorText(err));
    }
  }, [jobId]);

  // Load when the selected job changes.
  useEffect(() => {
    setJob(null);
    setDriverError(null);
    setLoadError(null);
    if (!jobId) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [jobId, refresh]);

  const status = job?.status;
  const active = status === "RUNNING" || status === "FETCHING";

  // Poll the summary every 3 seconds while work is in progress.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [active, refresh]);

  // Drive the fetch or process loop.
  useEffect(() => {
    if (!jobId || (status !== "FETCHING" && status !== "RUNNING")) return;
    let cancelled = false;
    const mode = status;

    (async () => {
      let delay = 1000;
      while (!cancelled) {
        try {
          if (mode === "FETCHING") {
            const res = await post<{ job: JobSummary; fetch: FetchStepResult }>(`/jobs/${jobId}/fetch`);
            if (cancelled) return;
            setJob(res.job);
            setDriverError(null);
            if (res.fetch.done || res.job.status !== "FETCHING") return;
          } else {
            const res = await post<BatchResult>(`/jobs/${jobId}/process`);
            if (cancelled) return;
            setDriverError(null);
            await refresh();
            if (res.status !== "RUNNING" || res.remaining === 0) return;
          }
          delay = 1000;
        } catch (err) {
          if (cancelled) return;
          const retryable = err instanceof ApiClientError && err.retryable;
          setDriverError({ message: errorText(err), retrying: retryable });
          if (!retryable) {
            await refresh(); // e.g. a fetch that failed is now FAILED
            return;
          }
          await sleep(delay);
          delay = Math.min(delay * 2, MAX_BACKOFF_MS);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId, status, restartKey, refresh]);

  const action = useCallback(
    /** Resolves true on success; failures are also reported through `driverError`. */
    async (name: "pause" | "resume" | "retry-errors" | "fetch"): Promise<boolean> => {
      if (!jobId) return false;
      setBusyAction(name);
      setDriverError(null);
      try {
        if (name === "fetch") {
          const res = await post<{ job: JobSummary }>(`/jobs/${jobId}/fetch`);
          setJob(res.job);
        } else {
          const res = await post<{ job: JobSummary }>(`/jobs/${jobId}/${name}`);
          setJob(res.job);
        }
        setRestartKey((k) => k + 1);
        return true;
      } catch (err) {
        setDriverError({ message: errorText(err), retrying: false });
        return false;
      } finally {
        setBusyAction(null);
      }
    },
    [jobId],
  );

  return {
    job,
    setJob,
    loading,
    loadError,
    driverError,
    busyAction,
    refresh,
    /** Restart a loop that stopped on an error. */
    restart: () => {
      setDriverError(null);
      setRestartKey((k) => k + 1);
    },
    pause: () => action("pause"),
    resume: () => action("resume"),
    retryErrors: () => action("retry-errors"),
    retryFetch: () => action("fetch"),
  };
}
