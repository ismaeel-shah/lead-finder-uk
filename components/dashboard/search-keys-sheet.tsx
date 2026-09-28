"use client";

import { ArrowDown, ArrowUp, CircleAlert, KeyRound, LoaderCircle, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { api, del, errorText, post } from "@/lib/client/api";
import type { KeysResponse, PublicKey } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { fmtNumber, fmtRelative } from "./format";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after any change, so the sidebar summary can refresh. */
  onChanged: () => void;
}

export function SearchKeysSheet({ open, onOpenChange, onChanged }: Props) {
  const [data, setData] = useState<KeysResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    try {
      setData(await api<KeysResponse>(`/settings/search-keys${refresh ? "?refresh=1" : ""}`));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    if (open) void load(true);
  }, [open, load]);

  async function run(id: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(id);
    try {
      await fn();
      if (success) toast.success(success);
      await load();
      onChanged();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  const patch = (id: string, body: object) => api(`/settings/search-keys/${id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="scrollbar-thin overflow-y-auto sm:max-w-lg">
        <div className="bg-glow border-b px-6 pt-6 pb-5">
          <div className="bg-brand-soft text-accent-foreground mb-4 flex size-10 items-center justify-center rounded-xl">
            <KeyRound className="size-5" />
          </div>
          <SheetTitle className="text-lg font-semibold tracking-tight">Search API keys</SheetTitle>
          <SheetDescription className="text-muted-foreground mt-1 text-sm">
            Keys are used from top to bottom. When one runs out of credits, the next one takes over automatically, and a run only
            pauses when every key is empty.
          </SheetDescription>
          {data && data.summary.total > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <SummaryTile label="Keys ready" value={`${data.summary.usable} of ${data.summary.total}`} warn={data.summary.usable === 0} />
              <SummaryTile label="Credits available" value={data.summary.credits === null ? "–" : fmtNumber(data.summary.credits)} warn={data.summary.credits === 0} />
            </div>
          )}
        </div>

        <div className="space-y-4 p-6">
          {error && (
            <p className="text-destructive bg-destructive/5 rounded-lg px-3 py-2 text-sm" role="alert">
              {error}
            </p>
          )}
          {!data && !error && (
            <div className="space-y-2">
              <Skeleton className="h-24 rounded-2xl" />
              <Skeleton className="h-24 rounded-2xl" />
            </div>
          )}

          {data && data.keys.length === 0 && (
            <div className="text-muted-foreground rounded-2xl border border-dashed px-4 py-8 text-center text-sm">
              No keys yet. Add your first Serper key below.
            </div>
          )}

          {data && data.keys.length > 0 && (
            <ol className="space-y-2">
              {data.keys.map((k, i) => (
                <KeyCard
                  key={k.id}
                  k={k}
                  position={i + 1}
                  first={i === 0}
                  last={i === data.keys.length - 1}
                  busy={busy === k.id}
                  onMove={(move) => run(k.id, () => patch(k.id, { move }))}
                  onToggle={() => run(k.id, () => patch(k.id, { enabled: !k.enabled }), k.enabled ? "Key turned off" : "Key turned on")}
                  onCheck={() => run(k.id, () => post(`/settings/search-keys/${k.id}/check`), "Balance updated")}
                  onDelete={() => run(k.id, () => del(`/settings/search-keys/${k.id}`), "Key removed")}
                />
              ))}
            </ol>
          )}

          {data && <AddKeyForm ready={data.encryptionReady} onAdded={async () => { await load(); onChanged(); }} />}

          <p className="text-muted-foreground flex gap-2 text-xs">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            Keys are encrypted in the database and never sent to the browser; only the last four characters are shown. Checking a
            balance is free and uses no search credit.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SummaryTile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={cn("bg-card rounded-xl border px-3 py-2.5", warn && "border-status-critical/30 bg-status-critical/5")}>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={cn("mt-0.5 text-lg font-semibold tabular-nums", warn && "text-status-critical")}>{value}</p>
    </div>
  );
}

function statusBadge(k: PublicKey) {
  if (k.unavailable) return <Badge variant="danger">Unavailable</Badge>;
  if (!k.enabled) return <Badge variant="outline">Off</Badge>;
  if (k.status === "EXHAUSTED") return <Badge variant="warning">Out of credits</Badge>;
  if (k.status === "INVALID") return <Badge variant="danger">Invalid</Badge>;
  return <Badge variant="success">Active</Badge>;
}

interface KeyCardProps {
  k: PublicKey;
  position: number;
  first: boolean;
  last: boolean;
  busy: boolean;
  onMove: (dir: "up" | "down") => void;
  onToggle: () => void;
  onCheck: () => void;
  onDelete: () => void;
}

function KeyCard({ k, position, first, last, busy, onMove, onToggle, onCheck, onDelete }: KeyCardProps) {
  const [confirming, setConfirming] = useState(false);
  const muted = !k.enabled || !!k.unavailable || k.status !== "ACTIVE";
  return (
    <li className={cn("bg-card rounded-2xl border p-4 shadow-xs transition-opacity", !k.enabled && "opacity-70")}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold tabular-nums",
            muted ? "bg-muted text-muted-foreground" : "bg-brand-soft text-accent-foreground",
          )}
          title="Order of use"
        >
          {position}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold">{k.label}</p>
            {statusBadge(k)}
          </div>
          <p className="text-muted-foreground mt-0.5 font-mono text-xs">•••• {k.last4}</p>
        </div>
        <div className="flex shrink-0 items-center">
          <Button variant="ghost" size="icon-sm" onClick={() => onMove("up")} disabled={busy || first} aria-label="Move up" title="Use earlier">
            <ArrowUp />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => onMove("down")} disabled={busy || last} aria-label="Move down" title="Use later">
            <ArrowDown />
          </Button>
        </div>
      </div>

      <dl className="text-muted-foreground mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div>
          <dt className="inline">Credits left: </dt>
          <dd className="text-foreground inline font-medium tabular-nums">{k.balance === null ? "unknown" : fmtNumber(Math.max(0, k.balance))}</dd>
          {k.balanceAt && <span> · {fmtRelative(k.balanceAt)}</span>}
        </div>
        <div>
          <dt className="inline">Searches by this app: </dt>
          <dd className="text-foreground inline font-medium tabular-nums">{fmtNumber(k.requestsCount)}</dd>
        </div>
        {k.source === "env" && <p className="col-span-2">Set in .env as SERPER_API_KEY.</p>}
      </dl>

      {(k.unavailable || (k.lastError && k.status !== "ACTIVE")) && (
        <p className="border-status-critical/20 bg-status-critical/5 mt-3 flex gap-2 rounded-lg border px-2.5 py-2 text-xs">
          <CircleAlert className="text-status-critical mt-px size-3.5 shrink-0" />
          {k.unavailable ?? k.lastError}
          {k.status === "EXHAUSTED" && !k.unavailable && " — it’s used again automatically once topped up."}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
        <Button variant="outline" size="sm" onClick={onCheck} disabled={busy || !!k.unavailable}>
          {busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} Check balance
        </Button>
        <Button variant="ghost" size="sm" onClick={onToggle} disabled={busy}>
          {k.enabled ? "Turn off" : "Turn on"}
        </Button>
        <div className="ml-auto">
          {confirming ? (
            <span className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={onDelete} disabled={busy}>
                Remove
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-status-critical"
              onClick={() => setConfirming(true)}
              disabled={busy}
              aria-label={`Remove ${k.label}`}
              title="Remove key"
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

function AddKeyForm({ ready, onAdded }: { ready: boolean; onAdded: () => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await post<{ key: PublicKey }>("/settings/search-keys", { label: label.trim() || undefined, key: key.trim() });
      toast.success("Key added", {
        description:
          res.key.status === "ACTIVE"
            ? `${fmtNumber(res.key.balance ?? 0)} credits available.`
            : "It has no credits right now; it will be used once topped up.",
      });
      setLabel("");
      setKey("");
      await onAdded();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-dashed p-4" noValidate>
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Plus className="size-4" /> Add a Serper key
      </p>
      <p className="text-muted-foreground mt-1 text-xs">
        Get one at serper.dev (API key page). It’s checked with Serper before it’s saved, which is free.
      </p>
      {!ready && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
          Set APP_SECRET in .env (a long random value) and restart the app to save keys here.
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1.4fr]">
        <div className="space-y-1.5">
          <Label htmlFor="key-label">Name (optional)</Label>
          <Input id="key-label" placeholder="e.g. Account 2" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="key-value">API key</Label>
          <Input
            id="key-value"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste the key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-invalid={!!error}
          />
        </div>
      </div>
      {error && (
        <p className="text-destructive bg-destructive/5 mt-3 rounded-lg px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" className="mt-3 w-full sm:w-auto" disabled={saving || !ready || key.trim().length < 10}>
        {saving ? <LoaderCircle className="animate-spin" /> : <KeyRound />} {saving ? "Checking key…" : "Check & add key"}
      </Button>
    </form>
  );
}
