"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { del, errorText, type JobListItem } from "@/lib/client/api";
import { fmtCustomFilters, fmtNumber, fmtRange } from "./format";

interface Props {
  job: JobListItem | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}

/** Confirms, then permanently deletes a run and its results. */
export function DeleteRunDialog({ job, onClose, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!job) return;
    setDeleting(true);
    setError(null);
    try {
      await del(`/jobs/${job.id}`);
      toast.success("Run deleted", { description: `${fmtRange(job.incorporatedFrom, job.incorporatedTo)} and its results were removed.` });
      onDeleted(job.id);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setDeleting(false);
    }
  }

  const custom = job ? fmtCustomFilters(job.filters) : "";
  const active = job?.status === "RUNNING" || job?.status === "FETCHING";

  return (
    <Dialog
      open={!!job}
      onOpenChange={(open) => {
        if (!open && !deleting) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        {job && (
          <>
            <div className="p-6 pb-5">
              <div className="bg-status-critical/10 text-status-critical mb-4 flex size-10 items-center justify-center rounded-xl">
                <Trash2 className="size-5" />
              </div>
              <DialogTitle className="text-lg font-semibold tracking-tight">Delete this run?</DialogTitle>
              <DialogDescription className="text-muted-foreground mt-1 text-sm">
                This permanently removes the run and all its results. It can’t be undone.
              </DialogDescription>

              <div className="bg-muted/50 mt-4 rounded-xl border px-4 py-3 text-sm">
                <p className="font-medium">{fmtRange(job.incorporatedFrom, job.incorporatedTo)}</p>
                {custom && <p className="text-muted-foreground text-xs">{custom}</p>}
                <p className="text-muted-foreground mt-1 text-xs">
                  {fmtNumber(job.totalCompanies)} {job.totalCompanies === 1 ? "company" : "companies"}
                  {job.processedCount > 0 && ` · ${fmtNumber(job.foundCount)} ${job.foundCount === 1 ? "lead" : "leads"} found`}
                </p>
              </div>

              {active && (
                <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
                  This run is still in progress. Deleting it stops it.
                </p>
              )}
              {job.foundCount > 0 && (
                <p className="text-muted-foreground mt-3 text-xs">Tip: export it to Excel first if you want to keep the leads.</p>
              )}
              <p className="text-muted-foreground mt-2 text-xs">Searches stay cached, so running the same dates again costs no search credits.</p>
              {error && (
                <p className="text-destructive bg-destructive/5 mt-3 rounded-lg px-3 py-2 text-sm" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="bg-muted/40 flex flex-col-reverse gap-2 rounded-b-2xl border-t px-6 py-4 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={onClose} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirm} disabled={deleting}>
                {deleting ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                {deleting ? "Deleting…" : "Delete run"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
