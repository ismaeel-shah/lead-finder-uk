"use client";

import { Building2, Plus, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JobListItem } from "@/lib/client/api";
import { FacebookIcon, GoogleIcon } from "./badges";
import { fmtCompact } from "./format";

const STEPS = [
  {
    Icon: Building2,
    title: "Fetch new companies",
    body: "Pull every company incorporated in your date range straight from Companies House.",
  },
  {
    Icon: Search,
    title: "Find them online",
    body: "Search for each company’s Facebook page and Google Business profile, and keep only confident matches.",
  },
  {
    Icon: Users,
    title: "Follow the director",
    body: "No luck? We look up the director’s other, older businesses and check those instead.",
  },
];

export function Welcome({ jobs, onNewRun }: { jobs: JobListItem[] | null; onNewRun: () => void }) {
  const totals = (jobs ?? []).reduce(
    (acc, j) => ({ runs: acc.runs + 1, companies: acc.companies + j.totalCompanies, found: acc.found + j.foundCount }),
    { runs: 0, companies: 0, found: 0 },
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-8 sm:py-16">
      <div className="text-center">
        <div className="bg-card text-muted-foreground mx-auto mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs shadow-xs">
          <FacebookIcon className="size-3.5 text-[#1877F2]" />
          <GoogleIcon className="size-3.5" />
          Facebook &amp; Google Business discovery
        </div>
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
          Turn brand-new UK companies into{" "}
          <span className="bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 bg-clip-text text-transparent">warm leads</span>
        </h1>
        <p className="text-muted-foreground mx-auto mt-4 max-w-xl text-balance sm:text-lg">
          Pick a date range. Lead Finder fetches every new incorporation and finds where each business lives online.
        </p>
        <Button size="lg" className="mt-8" onClick={onNewRun}>
          <Plus /> Start a new run
        </Button>
      </div>

      {totals.runs > 0 && (
        <dl className="mx-auto mt-12 grid max-w-2xl grid-cols-3 divide-x rounded-2xl border bg-card text-center shadow-xs">
          {[
            ["Runs", totals.runs],
            ["Companies scanned", totals.companies],
            ["Leads found", totals.found],
          ].map(([label, value]) => (
            <div key={label} className="px-3 py-5">
              <dd className="text-2xl font-semibold tracking-tight sm:text-3xl">{fmtCompact(value as number)}</dd>
              <dt className="text-muted-foreground mt-1 text-xs sm:text-sm">{label}</dt>
            </div>
          ))}
        </dl>
      )}

      <ol className="mt-12 grid gap-4 sm:grid-cols-3">
        {STEPS.map(({ Icon, title, body }, i) => (
          <li key={title} className="bg-card relative rounded-2xl border p-5 shadow-xs">
            <span className="text-muted-foreground/60 absolute top-4 right-5 font-mono text-xs">0{i + 1}</span>
            <div className="bg-brand-soft text-accent-foreground mb-4 flex size-10 items-center justify-center rounded-xl">
              <Icon className="size-5" />
            </div>
            <h3 className="font-semibold tracking-tight">{title}</h3>
            <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
