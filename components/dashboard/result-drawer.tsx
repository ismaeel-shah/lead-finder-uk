"use client";

import { Building2, CircleAlert, ExternalLink, Globe, Info, MapPin, Phone, Users } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { ResultRow } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { FacebookIcon, GoogleIcon, LinkedInIcon, ResultStatusBadge } from "./badges";
import { companiesHouseUrl, fmtAddress, fmtDate, fmtDateTime, fmtPersonName, initials } from "./format";
import { ScoreBar } from "./score-bar";

export function ResultDrawer({ row, onClose }: { row: ResultRow | null; onClose: () => void }) {
  return (
    <Sheet open={!!row} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="scrollbar-thin overflow-y-auto">{row && <DrawerBody row={row} />}</SheetContent>
    </Sheet>
  );
}

function DrawerBody({ row }: { row: ResultRow }) {
  const address = fmtAddress(row.registeredAddress);
  return (
    <>
      {/* Header */}
      <div className="bg-glow border-b px-6 pt-6 pb-5">
        <div className="flex items-start gap-4 pr-8">
          <span
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold",
              row.status === "FOUND" ? "bg-brand-soft text-accent-foreground" : "bg-muted text-muted-foreground",
            )}
            aria-hidden="true"
          >
            {initials(row.companyName)}
          </span>
          <div className="min-w-0">
            <SheetTitle className="text-lg leading-snug font-semibold tracking-tight">{row.companyName}</SheetTitle>
            <SheetDescription className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <ResultStatusBadge status={row.status} />
              <span className="font-mono text-xs">{row.companyNumber}</span>
              <span>· incorporated {fmtDate(row.incorporationDate)}</span>
            </SheetDescription>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <QuickLink href={row.facebookUrl} label="Facebook" icon={<FacebookIcon className="size-4 text-[#1877F2]" />} />
          <QuickLink href={row.googleBusinessUrl} label="Google" icon={<GoogleIcon className="size-4" />} />
          <QuickLink href={row.linkedinCompanyUrl} label="LinkedIn" icon={<LinkedInIcon className="size-4 text-[#0A66C2]" />} />
          <QuickLink href={companiesHouseUrl(row.companyNumber)} label="Companies House" icon={<Building2 className="size-4" />} />
        </div>
      </div>

      <div className="space-y-4 p-6">
        {row.errorMessage && (
          <Callout tone="critical" icon={<CircleAlert className="size-4" />}>
            {row.errorMessage}
          </Callout>
        )}
        {row.note && (
          <Callout tone="neutral" icon={<Info className="size-4" />}>
            {row.note.charAt(0).toUpperCase() + row.note.slice(1)}.
          </Callout>
        )}

        {row.facebookUrl && (
          <Panel title="Facebook page" icon={<FacebookIcon className="size-4 text-[#1877F2]" />} score={row.facebookScore}>
            <Field label="Page">
              <Ext href={row.facebookUrl}>{row.facebookUrl.replace(/^https:\/\/www\./, "")}</Ext>
            </Field>
          </Panel>
        )}

        {row.googleBusinessUrl && (
          <Panel title="Google Business" icon={<GoogleIcon className="size-4" />} score={row.googleBusinessScore}>
            <Field label="Listing">
              <Ext href={row.googleBusinessUrl}>{row.googleBusinessName ?? "Open in Google Maps"}</Ext>
            </Field>
            {row.googleBusinessAddress && (
              <Field label="Address" icon={<MapPin className="size-3.5" />}>
                {row.googleBusinessAddress}
              </Field>
            )}
            {row.googleBusinessPhone && (
              <Field label="Phone" icon={<Phone className="size-3.5" />}>
                <a className="hover:text-primary font-medium" href={`tel:${row.googleBusinessPhone.replace(/\s+/g, "")}`}>
                  {row.googleBusinessPhone}
                </a>
              </Field>
            )}
            {row.googleBusinessWebsite && (
              <Field label="Website" icon={<Globe className="size-3.5" />}>
                <Ext href={row.googleBusinessWebsite}>{row.googleBusinessWebsite.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</Ext>
              </Field>
            )}
          </Panel>
        )}

        {(row.linkedinCompanyUrl || row.linkedinDirectorUrl) && (
          <Panel title="LinkedIn" icon={<LinkedInIcon className="size-4 text-[#0A66C2]" />}>
            {row.linkedinCompanyUrl && (
              <Field label="Company page">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <Ext href={row.linkedinCompanyUrl}>{row.linkedinCompanyUrl.replace(/^https:\/\/www\./, "")}</Ext>
                  {row.linkedinCompanyScore !== null && <ScoreBar value={row.linkedinCompanyScore} />}
                </span>
              </Field>
            )}
            {row.linkedinDirectorUrl && (
              <Field label="Director">
                <span className="flex flex-col gap-1">
                  <Ext href={row.linkedinDirectorUrl}>{row.officerName ? fmtPersonName(row.officerName) : "Profile"}</Ext>
                  <span className="text-muted-foreground text-xs">
                    {row.linkedinDirectorScore !== null && row.linkedinDirectorScore >= 1
                      ? "Profile mentions their company"
                      : "Matched on name and area — check before contacting"}
                  </span>
                </span>
              </Field>
            )}
          </Panel>
        )}

        {(row.matchSource || row.officerName || row.directorNames.length > 0) && (
          <Panel title="How it was matched" icon={<Users className="text-muted-foreground size-4" />}>
            {row.matchSource && (
              <Field label="Source">{row.matchSource === "BUSINESS" ? "Direct — this company’s own name" : "Via the director’s other company"}</Field>
            )}
            {row.matchedViaCompanyName && (
              <Field label="Matched via">
                {row.matchedViaCompanyNumber ? (
                  <Ext href={companiesHouseUrl(row.matchedViaCompanyNumber)}>{row.matchedViaCompanyName}</Ext>
                ) : (
                  row.matchedViaCompanyName
                )}
              </Field>
            )}
            {row.officerName && <Field label="Director">{fmtPersonName(row.officerName)}</Field>}
            {row.directorNames.length > 1 && <Field label="All directors">{row.directorNames.map(fmtPersonName).join(", ")}</Field>}
          </Panel>
        )}

        <Panel title="Company" icon={<Building2 className="text-muted-foreground size-4" />}>
          <Field label="Registered office">{address || "–"}</Field>
          <Field label="SIC codes">
            {row.sicCodes.length ? (
              <span className="flex flex-wrap gap-1">
                {row.sicCodes.map((s) => (
                  <span key={s} className="bg-muted rounded-md px-1.5 py-0.5 font-mono text-xs">
                    {s}
                  </span>
                ))}
              </span>
            ) : (
              "–"
            )}
          </Field>
          {row.companyType && <Field label="Type">{row.companyType.toUpperCase()}</Field>}
        </Panel>

        {row.processedAt && <p className="text-muted-foreground text-center text-xs">Processed {fmtDateTime(row.processedAt)}</p>}
      </div>
    </>
  );
}

function QuickLink({ href, label, icon }: { href: string | null; label: string; icon: React.ReactNode }) {
  const cls = "flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition-all";
  if (!href) {
    return (
      <span className={cn(cls, "text-muted-foreground bg-muted/40 opacity-60")}>
        <span className="grayscale">{icon}</span>
        Not found
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn(cls, "bg-card hover:border-primary/40 shadow-xs hover:-translate-y-px hover:shadow-sm")}>
      {icon}
      {label}
    </a>
  );
}

function Panel({ title, icon, score, children }: { title: string; icon: React.ReactNode; score?: number | null; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </h3>
        {score !== undefined && score !== null && <ScoreBar value={score} />}
      </header>
      <dl className="space-y-2.5 px-4 py-3.5">{children}</dl>
    </section>
  );
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 text-sm">
      <dt className="text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Callout({ tone, icon, children }: { tone: "critical" | "neutral"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm",
        tone === "critical" ? "border-status-critical/25 bg-status-critical/5" : "bg-muted/50",
      )}
    >
      <span className={cn("mt-0.5 shrink-0", tone === "critical" ? "text-status-critical" : "text-muted-foreground")}>{icon}</span>
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
      <span className="break-all">{children}</span>
      <ExternalLink className="size-3 shrink-0" />
    </a>
  );
}
