"use client";

import { ArrowRight, CalendarRange, ChevronDown, LoaderCircle, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { errorText, post, type FetchStepResult, type JobSummary } from "@/lib/client/api";
import { addDays } from "@/lib/dates";
import { cn } from "@/lib/utils";

const COMPANY_TYPES = [
  ["ltd", "Private limited (Ltd)"],
  ["plc", "Public limited (PLC)"],
  ["llp", "Limited liability partnership (LLP)"],
  ["private-limited-guarant-nsc", "Limited by guarantee"],
  ["private-limited-guarant-nsc-limited-exemption", "Limited by guarantee (exempt)"],
  ["private-unlimited", "Private unlimited"],
  ["limited-partnership", "Limited partnership"],
] as const;

const COMPANY_STATUSES = [
  ["active", "Active"],
  ["dissolved", "Dissolved"],
  ["liquidation", "Liquidation"],
  ["administration", "Administration"],
] as const;

function presets(today: string) {
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = addDays(monthStart, -1);
  return [
    { id: "today", label: "Today", from: today, to: today },
    { id: "yesterday", label: "Yesterday", from: addDays(today, -1), to: addDays(today, -1) },
    { id: "7d", label: "Last 7 days", from: addDays(today, -6), to: today },
    { id: "mtd", label: "This month", from: monthStart, to: today },
    { id: "lm", label: "Last month", from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
  ];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  onCreated: (job: JobSummary) => void;
}

export function NewRunDialog({ open, onOpenChange, today, onCreated }: Props) {
  const ranges = presets(today);
  const [from, setFrom] = useState(ranges[1]!.from);
  const [to, setTo] = useState(ranges[1]!.to);
  const [companyType, setCompanyType] = useState("ltd");
  const [companyStatus, setCompanyStatus] = useState("active");
  const [sicCodes, setSicCodes] = useState("");
  const [location, setLocation] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const activePreset = ranges.find((r) => r.from === from && r.to === to)?.id;
  const dateError = !from || !to ? "Choose both dates." : from > to ? "The start date must be on or before the end date." : to > today ? "The end date can’t be in the future." : null;
  const sicError = sicCodes.trim() && !/^[0-9,\s]+$/.test(sicCodes) ? "SIC codes must be numbers separated by commas." : null;
  const filterCount = [companyType !== "ltd", companyStatus !== "active", !!sicCodes.trim(), !!location.trim()].filter(Boolean).length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (dateError || sicError) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await post<{ job: JobSummary; fetch: FetchStepResult }>("/jobs", {
        incorporatedFrom: from,
        incorporatedTo: to,
        companyType,
        companyStatus,
        sicCodes: sicCodes.trim() || undefined,
        location: location.trim() || undefined,
      });
      onCreated(res.job);
      onOpenChange(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-xl">
        <form onSubmit={submit} noValidate>
          <div className="border-b p-6 pb-5">
            <div className="bg-brand-soft text-accent-foreground mb-4 flex size-10 items-center justify-center rounded-xl">
              <CalendarRange className="size-5" />
            </div>
            <DialogTitle className="text-lg font-semibold tracking-tight">Start a new run</DialogTitle>
            <DialogDescription className="text-muted-foreground mt-1 text-sm">
              Choose when the companies were incorporated. We’ll fetch them from Companies House, then look for their Facebook and
              Google Business pages.
            </DialogDescription>
          </div>

          <div className="space-y-5 p-6">
            <div className="space-y-2.5">
              <Label>Incorporation date</Label>
              <div className="flex flex-wrap gap-1.5">
                {ranges.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setFrom(r.from);
                      setTo(r.to);
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[13px] font-medium transition-colors",
                      activePreset === r.id
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-card text-foreground/80 hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="from" className="text-muted-foreground text-xs font-normal">
                    From
                  </Label>
                  <Input id="from" type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} aria-invalid={!!dateError} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="to" className="text-muted-foreground text-xs font-normal">
                    To
                  </Label>
                  <Input id="to" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} aria-invalid={!!dateError} />
                </div>
              </div>
            </div>

            <div className="rounded-xl border">
              <button
                type="button"
                onClick={() => setShowFilters((s) => !s)}
                aria-expanded={showFilters}
                className="hover:bg-accent/50 flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors"
              >
                <SlidersHorizontal className="text-muted-foreground size-4" />
                Filters
                {filterCount > 0 && (
                  <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-[11px] leading-5">{filterCount}</span>
                )}
                <span className="text-muted-foreground ml-auto text-xs font-normal">
                  {companyType === "ltd" && companyStatus === "active" ? "Active Ltd companies" : "Custom"}
                </span>
                <ChevronDown className={cn("text-muted-foreground size-4 transition-transform", showFilters && "rotate-180")} />
              </button>
              {showFilters && (
                <div className="grid grid-cols-1 gap-3 border-t p-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="type">Company type</Label>
                    <NativeSelect id="type" value={companyType} onChange={(e) => setCompanyType(e.target.value)}>
                      {COMPANY_TYPES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="status">Status</Label>
                    <NativeSelect id="status" value={companyStatus} onChange={(e) => setCompanyStatus(e.target.value)}>
                      {COMPANY_STATUSES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sic">SIC codes</Label>
                    <Input id="sic" placeholder="e.g. 43220, 43210" value={sicCodes} onChange={(e) => setSicCodes(e.target.value)} aria-invalid={!!sicError} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="location">Location</Label>
                    <Input id="location" placeholder="e.g. Manchester" value={location} onChange={(e) => setLocation(e.target.value)} />
                  </div>
                </div>
              )}
            </div>

            {(dateError || sicError || error) && (
              <p className="text-destructive bg-destructive/5 rounded-lg px-3 py-2 text-sm" role="alert">
                {dateError ?? sicError ?? error}
              </p>
            )}
          </div>

          <div className="bg-muted/40 flex flex-col-reverse gap-2 rounded-b-2xl border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !!dateError || !!sicError}>
              {submitting ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
              {submitting ? "Fetching companies…" : "Fetch companies"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
