/** YYYY-MM-DD for "today" in the UK, whatever the server's time zone. */
export function todayInLondon(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Midnight UTC Date for a YYYY-MM-DD string (how dates are stored). */
export function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** YYYY-MM-DD for a stored date. */
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}
