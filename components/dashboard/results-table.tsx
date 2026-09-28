"use client";

import { ChevronLeft, ChevronRight, Inbox, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorText, type JobSummary, type ResultRow, type ResultsPage, type ResultsTab } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { FacebookIcon, GoogleIcon, LinkedInIcon, ResultStatusBadge } from "./badges";
import { fmtDate, fmtNumber, fmtPersonName, initials, sentenceCase } from "./format";
import { ResultDrawer } from "./result-drawer";
import { ScoreBar } from "./score-bar";

const PAGE_SIZE = 50;

const TABS: { id: ResultsTab; label: string; count: (j: JobSummary) => number }[] = [
  { id: "all", label: "All", count: (j) => j.totalCompanies },
  { id: "found", label: "Found", count: (j) => j.foundCount },
  { id: "via_owner", label: "Via owner", count: (j) => j.viaOwnerCount },
  { id: "no_match", label: "No match", count: (j) => j.noMatchCount },
  { id: "error", label: "Errors", count: (j) => j.errorCount },
];

export function ResultsTable({ job }: { job: JobSummary }) {
  const [tab, setTab] = useState<ResultsTab>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ResultsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ResultRow | null>(null);
  const requestId = useRef(0);

  // Debounce the name search.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset when switching runs.
  useEffect(() => {
    setTab("all");
    setSearchInput("");
    setSearch("");
    setPage(1);
    setData(null);
    setSelected(null);
  }, [job.id]);

  // Load results; re-runs quietly (no skeleton) as processing moves on.
  const progressKey = `${job.processedCount}:${job.totalCompanies}:${job.status}`;
  const queryKey = `${job.id}|${tab}|${search}|${page}`;
  const lastQueryKey = useRef<string | null>(null);
  useEffect(() => {
    const id = ++requestId.current;
    if (lastQueryKey.current !== queryKey) setLoading(true);
    lastQueryKey.current = queryKey;
    const params = new URLSearchParams({ status: tab, page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) params.set("search", search);
    api<ResultsPage>(`/jobs/${job.id}/results?${params.toString()}`)
      .then((res) => {
        if (id !== requestId.current) return;
        setData(res);
        setError(null);
        setSelected((s) => (s ? (res.items.find((r) => r.id === s.id) ?? s) : s));
      })
      .catch((err) => id === requestId.current && setError(errorText(err)))
      .finally(() => id === requestId.current && setLoading(false));
  }, [queryKey, progressKey, job.id, tab, search, page]);

  const pageCount = data?.pageCount ?? 1;

  return (
    <section className="bg-card overflow-hidden rounded-2xl border shadow-xs" aria-label="Results">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
        <div role="tablist" aria-label="Filter results" className="scrollbar-thin bg-muted -mx-1 flex gap-0.5 overflow-x-auto rounded-xl p-1 lg:mx-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setPage(1);
              }}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all",
                tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <span className={cn("text-[11px] tabular-nums", tab === t.id ? "text-primary" : "text-muted-foreground/80")}>
                {fmtNumber(t.count(job))}
              </span>
            </button>
          ))}
        </div>
        <div className="relative w-full lg:w-72">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search companies…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 pr-8 pl-9"
            aria-label="Search company name"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-destructive border-b px-5 py-3 text-sm">{error}</p>}

      {/* Phones: a card list, so links and status are visible without sideways scrolling. */}
      <ul className="divide-y sm:hidden">
        {loading && !data
          ? Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="size-10 rounded-xl" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
              </li>
            ))
          : data?.items.map((row) => <ResultCard key={row.id} row={row} onOpen={() => setSelected(row)} />)}
      </ul>

      <div className="hidden sm:block">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Company</TableHead>
            <TableHead className="hidden lg:table-cell">Incorporated</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Links</TableHead>
            <TableHead className="hidden md:table-cell">Match</TableHead>
            <TableHead className="hidden xl:table-cell">Director</TableHead>
            <TableHead className="hidden sm:table-cell">Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && !data
            ? Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} />)
            : data?.items.map((row) => <ResultTableRow key={row.id} row={row} onOpen={() => setSelected(row)} />)}
        </TableBody>
      </Table>
      </div>
      {!loading && data && data.items.length === 0 && <EmptyState tab={tab} search={search} job={job} />}

      {data && data.total > 0 && (
        <div className="flex items-center justify-between gap-2 border-t px-5 py-3 text-sm">
          <span className="text-muted-foreground text-[13px]">
            <span className="text-foreground font-medium tabular-nums">
              {fmtNumber((data.page - 1) * data.pageSize + 1)}–{fmtNumber(Math.min(data.page * data.pageSize, data.total))}
            </span>{" "}
            of {fmtNumber(data.total)}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <span className="text-muted-foreground px-2 text-[13px] tabular-nums">
              {page} / {pageCount}
            </span>
            <Button variant="ghost" size="icon-sm" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      <ResultDrawer row={selected} onClose={() => setSelected(null)} />
    </section>
  );
}

function ResultTableRow({ row, onOpen }: { row: ResultRow; onOpen: () => void }) {
  const score = Math.max(row.facebookScore ?? 0, row.googleBusinessScore ?? 0);
  return (
    <TableRow
      className="hover:bg-accent/40 focus-visible:bg-accent/60 cursor-pointer outline-none"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      aria-label={`Details for ${row.companyName}`}
    >
      <TableCell className="max-w-[20rem]">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-semibold",
              row.status === "FOUND" ? "bg-brand-soft text-accent-foreground" : "bg-muted text-muted-foreground",
            )}
            aria-hidden="true"
          >
            {initials(row.companyName)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.companyName}</p>
            <p className="text-muted-foreground font-mono text-[11px]">{row.companyNumber}</p>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground hidden whitespace-nowrap lg:table-cell">{fmtDate(row.incorporationDate)}</TableCell>
      <TableCell>
        <ResultStatusBadge status={row.status} />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <LinkChip href={row.facebookUrl} label={`Facebook page for ${row.companyName}`}>
            <FacebookIcon className="size-4 text-[#1877F2]" />
          </LinkChip>
          <LinkChip href={row.googleBusinessUrl} label={`Google Business profile for ${row.companyName}`}>
            <GoogleIcon className="size-4" />
          </LinkChip>
          <LinkChip href={row.linkedinCompanyUrl} label={`LinkedIn page for ${row.companyName}`}>
            <LinkedInIcon className="size-4 text-[#0A66C2]" />
          </LinkChip>
        </div>
      </TableCell>
      <TableCell className="hidden max-w-[14rem] md:table-cell">
        {row.matchSource === "BUSINESS" && <span className="text-[13px]">Direct</span>}
        {row.matchSource === "OWNER_OTHER_BUSINESS" && (
          <div className="min-w-0">
            <span className="text-accent-foreground bg-brand-soft rounded-md px-1.5 py-0.5 text-[11px] font-medium">Via owner</span>
            <p className="text-muted-foreground mt-1 truncate text-xs">{row.matchedViaCompanyName}</p>
          </div>
        )}
        {!row.matchSource && row.note && <span className="text-muted-foreground line-clamp-1 text-xs">{sentenceCase(row.note)}</span>}
      </TableCell>
      <TableCell className="text-muted-foreground hidden max-w-[14rem] text-[13px] xl:table-cell">
        {row.officerName && (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{fmtPersonName(row.officerName)}</span>
            {row.linkedinDirectorUrl && (
              <a
                href={row.linkedinDirectorUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label={`LinkedIn profile of ${fmtPersonName(row.officerName)}`}
                title={`LinkedIn profile of ${fmtPersonName(row.officerName)}`}
                className="shrink-0 rounded text-[#0A66C2] transition-opacity hover:opacity-75"
              >
                <LinkedInIcon className="size-3.5" />
              </a>
            )}
          </span>
        )}
      </TableCell>
      <TableCell className="hidden sm:table-cell">{row.status === "FOUND" && <ScoreBar value={score} />}</TableCell>
    </TableRow>
  );
}

function ResultCard({ row, onOpen }: { row: ResultRow; onOpen: () => void }) {
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        aria-label={`Details for ${row.companyName}`}
        className="active:bg-accent/60 flex items-start gap-3 px-4 py-3.5 outline-none"
      >
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl text-xs font-semibold",
            row.status === "FOUND" ? "bg-brand-soft text-accent-foreground" : "bg-muted text-muted-foreground",
          )}
          aria-hidden="true"
        >
          {initials(row.companyName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.companyName}</p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {row.matchSource === "OWNER_OTHER_BUSINESS"
              ? `Via ${row.matchedViaCompanyName ?? "owner"}`
              : row.matchSource === "BUSINESS"
                ? "Direct match"
                : row.note
                  ? sentenceCase(row.note)
                  : fmtDate(row.incorporationDate)}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <ResultStatusBadge status={row.status} />
            {row.status === "FOUND" && <ScoreBar value={Math.max(row.facebookScore ?? 0, row.googleBusinessScore ?? 0)} />}
          </div>
        </div>
        {(row.facebookUrl || row.googleBusinessUrl || row.linkedinCompanyUrl) && (
          <div className="flex shrink-0 gap-1.5">
            {row.facebookUrl && (
              <LinkChip href={row.facebookUrl} label={`Facebook page for ${row.companyName}`}>
                <FacebookIcon className="size-4 text-[#1877F2]" />
              </LinkChip>
            )}
            {row.googleBusinessUrl && (
              <LinkChip href={row.googleBusinessUrl} label={`Google Business profile for ${row.companyName}`}>
                <GoogleIcon className="size-4" />
              </LinkChip>
            )}
            {row.linkedinCompanyUrl && (
              <LinkChip href={row.linkedinCompanyUrl} label={`LinkedIn page for ${row.companyName}`}>
                <LinkedInIcon className="size-4 text-[#0A66C2]" />
              </LinkChip>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function LinkChip({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  if (!href) {
    return (
      <span className="bg-muted/60 flex size-8 items-center justify-center rounded-lg opacity-30 grayscale" aria-hidden="true">
        {children}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
      className="bg-card hover:border-primary/40 flex size-8 items-center justify-center rounded-lg border shadow-xs transition-all hover:-translate-y-px hover:shadow-sm"
    >
      {children}
    </a>
  );
}

function SkeletonRow() {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <Skeleton className="h-3.5 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-16 rounded-full" />
      </TableCell>
      <TableCell>
        <div className="flex gap-1.5">
          <Skeleton className="size-8" />
          <Skeleton className="size-8" />
          <Skeleton className="size-8" />
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <Skeleton className="h-3.5 w-16" />
      </TableCell>
      <TableCell className="hidden xl:table-cell">
        <Skeleton className="h-3.5 w-24" />
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Skeleton className="h-3.5 w-20" />
      </TableCell>
    </TableRow>
  );
}

function EmptyState({ tab, search, job }: { tab: ResultsTab; search: string; job: JobSummary }) {
  let title = "Nothing here";
  let body = "No companies match this filter.";
  if (search) {
    title = "No matching companies";
    body = `No company names contain “${search}”.`;
  } else if (tab !== "all" && job.processedCount === 0) {
    title = "Nothing processed yet";
    body = "Results appear here as processing runs.";
  } else if (tab === "error") {
    title = "No errors";
    body = "Every processed company went through cleanly.";
  }
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
        <Inbox className="size-6" />
      </div>
      <p className="mt-2 font-medium">{title}</p>
      <p className="text-muted-foreground text-sm">{body}</p>
    </div>
  );
}
