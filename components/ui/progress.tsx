import { cn } from "@/lib/utils";

export function Progress({ value, className, label }: { value: number; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      className={cn("bg-muted relative h-1.5 w-full overflow-hidden rounded-full", className)}
    >
      <div className="bg-primary h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
    </div>
  );
}
