import { Badge } from "@/components/ui/badge";
import type { JobSummary, ResultRow } from "@/lib/client/api";
import { cn } from "@/lib/utils";

type Tone = "success" | "muted" | "danger" | "warning" | "info" | "outline";

const DOT: Record<Tone, string> = {
  success: "bg-status-good",
  danger: "bg-status-critical",
  warning: "bg-status-warning",
  info: "bg-primary",
  muted: "bg-status-neutral",
  outline: "bg-muted-foreground",
};

function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className="relative flex size-1.5">
      {pulse && <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", DOT[tone])} />}
      <span className={cn("relative inline-flex size-1.5 rounded-full", DOT[tone])} />
    </span>
  );
}

const RESULT: Record<ResultRow["status"], { label: string; tone: Tone }> = {
  FOUND: { label: "Found", tone: "success" },
  NO_MATCH: { label: "No match", tone: "muted" },
  ERROR: { label: "Error", tone: "danger" },
  PENDING: { label: "Queued", tone: "outline" },
  PROCESSING: { label: "Processing", tone: "info" },
};

export function ResultStatusBadge({ status }: { status: ResultRow["status"] }) {
  const s = RESULT[status];
  return (
    <Badge variant={s.tone}>
      <Dot tone={s.tone} pulse={status === "PROCESSING"} />
      {s.label}
    </Badge>
  );
}

const JOB: Record<JobSummary["status"], { label: string; tone: Tone }> = {
  FETCHING: { label: "Fetching", tone: "info" },
  READY: { label: "Ready", tone: "outline" },
  RUNNING: { label: "Running", tone: "info" },
  PAUSED: { label: "Paused", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
};

export function JobStatusBadge({ status, className }: { status: JobSummary["status"]; className?: string }) {
  const s = JOB[status];
  return (
    <Badge variant={s.tone} className={className}>
      <Dot tone={s.tone} pulse={status === "RUNNING" || status === "FETCHING"} />
      {s.label}
    </Badge>
  );
}

/** Small status dot for dense lists (the sidebar). Paired with a label via title/sr-only. */
export function JobStatusDot({ status }: { status: JobSummary["status"] }) {
  const s = JOB[status];
  return (
    <span title={s.label} className="flex items-center">
      <Dot tone={s.tone} pulse={status === "RUNNING" || status === "FETCHING"} />
      <span className="sr-only">{s.label}</span>
    </span>
  );
}

export function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07" />
    </svg>
  );
}

export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3.02c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.11A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.27A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.55.37-2.27V6.62H1.26A12 12 0 0 0 0 12c0 1.94.46 3.77 1.26 5.38l4.01-3.11Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.26 6.62l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77Z" />
    </svg>
  );
}

export function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
    </svg>
  );
}