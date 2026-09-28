/** Single-series meter for a 0..1 match score; the number is always shown beside it. */
export function ScoreBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="bg-muted h-1.5 w-14 overflow-hidden rounded-full">
        <div className="bg-primary h-full rounded-full" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="text-[13px] font-medium tabular-nums">{value.toFixed(2)}</span>
    </div>
  );
}
