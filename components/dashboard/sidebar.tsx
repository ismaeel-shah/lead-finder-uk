"use client";

import { ChevronRight, KeyRound, LogOut, Plus, Radar, Trash2 } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { post, type JobListItem, type KeysSummary } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { JobStatusDot } from "./badges";
import { fmtCompact, fmtCustomFilters, fmtNumber, fmtRange, fmtRelative } from "./format";

interface Props {
  jobs: JobListItem[] | null;
  error: string | null;
  selectedId: string | null;
  passwordEnabled: boolean;
  onSelect: (id: string) => void;
  onNewRun: () => void;
  onDelete: (job: JobListItem) => void;
  keys: KeysSummary | null;
  onOpenKeys: () => void;
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30",
        className,
      )}
    >
      <Radar className="size-[18px]" />
    </div>
  );
}

export function Sidebar({ jobs, error, selectedId, passwordEnabled, onSelect, onNewRun, onDelete, keys, onOpenKeys }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <BrandMark />
        <div className="min-w-0">
          <p className="text-[15px] leading-tight font-semibold tracking-tight">Lead Finder</p>
          <p className="text-muted-foreground text-xs">New UK companies</p>
        </div>
      </div>

      <div className="px-3">
        <Button onClick={onNewRun} className="w-full justify-start" size="lg">
          <Plus /> New run
          <kbd className="bg-primary-foreground/15 ml-auto hidden rounded px-1.5 py-0.5 font-mono text-[10px] font-medium lg:inline">N</kbd>
        </Button>
      </div>

      <div className="text-muted-foreground mt-6 mb-1.5 flex items-center justify-between px-5 text-[11px] font-semibold tracking-wider uppercase">
        Runs
        {jobs && jobs.length > 0 && <span className="font-mono tracking-normal">{jobs.length}</span>}
      </div>

      <nav aria-label="Runs" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {error && <p className="text-destructive px-2 py-2 text-xs">{error}</p>}
        {!jobs && !error && (
          <div className="space-y-2 px-1">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        )}
        {jobs && jobs.length === 0 && (
          <p className="text-muted-foreground px-2 py-6 text-center text-xs">Your runs will appear here.</p>
        )}
        <ul className="space-y-0.5">
          {jobs?.map((job) => {
            const pct = job.totalCompanies ? (job.processedCount / job.totalCompanies) * 100 : 0;
            const active = job.id === selectedId;
            const custom = fmtCustomFilters(job.filters);
            return (
              <li key={job.id} className="group relative">
                <button
                  onClick={() => onSelect(job.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "w-full rounded-xl py-2.5 pr-9 pl-3 text-left transition-colors",
                    active ? "bg-brand-soft" : "hover:bg-accent/70",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <JobStatusDot status={job.status} />
                    <span className={cn("truncate text-[13px] font-medium", active && "text-accent-foreground")}>
                      {fmtRange(job.incorporatedFrom, job.incorporatedTo)}
                    </span>
                  </div>
                  {custom && <p className="text-muted-foreground mt-0.5 truncate pl-3.5 text-[11px] font-medium">{custom}</p>}
                  <div className="text-muted-foreground mt-1 flex items-center justify-between gap-2 pl-3.5 text-[11px]">
                    <span>{fmtRelative(job.createdAt)}</span>
                    <span className="tabular-nums">
                      {job.processedCount > 0 ? `${fmtCompact(job.foundCount)} found · ` : ""}
                      {fmtCompact(job.totalCompanies)} {job.totalCompanies === 1 ? "company" : "companies"}
                    </span>
                  </div>
                  {job.totalCompanies > 0 && job.processedCount > 0 && job.processedCount < job.totalCompanies && (
                    <div className="bg-muted mt-2 ml-3.5 h-1 overflow-hidden rounded-full">
                      <div className="bg-primary/70 h-full rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </button>
                {/* A sibling, not nested: a button can't contain another button. */}
                <button
                  onClick={() => onDelete(job)}
                  aria-label={`Delete run ${fmtRange(job.incorporatedFrom, job.incorporatedTo)}`}
                  title="Delete run"
                  className="text-muted-foreground hover:text-status-critical hover:bg-status-critical/10 focus-visible:ring-ring/40 absolute top-2 right-2 rounded-lg p-1.5 opacity-0 transition-all group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:outline-none [@media(hover:none)]:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-sidebar-border space-y-2 border-t p-3">
        <button
          onClick={onOpenKeys}
          className="hover:bg-accent/70 flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors"
        >
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg",
              keys && keys.usable === 0 ? "bg-status-critical/10 text-status-critical" : "bg-brand-soft text-accent-foreground",
            )}
          >
            <KeyRound className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium">Search API keys</span>
            <span className={cn("block truncate text-[11px]", keys && keys.usable === 0 ? "text-status-critical" : "text-muted-foreground")}>
              {!keys
                ? "Loading…"
                : keys.total === 0
                  ? "No key yet — add one"
                  : keys.usable === 0
                    ? "All keys out of credits"
                    : `${keys.usable} active${keys.credits !== null ? ` · ${fmtNumber(keys.credits)} credits` : ""}`}
            </span>
          </span>
          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
        </button>
        <ThemeToggle />
        {passwordEnabled && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground w-full justify-start"
            onClick={async () => {
              await post("/logout").catch(() => undefined);
              window.location.assign("/login");
            }}
          >
            <LogOut /> Sign out
          </Button>
        )}
      </div>
    </div>
  );
}
