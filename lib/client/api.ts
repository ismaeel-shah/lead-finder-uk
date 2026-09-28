import type { getJobSummary, listJobs, listResults, BatchResult, FetchStepResult } from "@/lib/jobs";
import type { listKeys, PublicKey } from "@/lib/searchKeys";

// Response shapes, derived from the server functions so they cannot drift.
export type JobSummary = Awaited<ReturnType<typeof getJobSummary>>;
export type JobListItem = Awaited<ReturnType<typeof listJobs>>[number];
export type ResultsPage = Awaited<ReturnType<typeof listResults>>;
export type ResultRow = ResultsPage["items"][number];
export type { BatchResult, FetchStepResult, PublicKey };
export type KeysResponse = Awaited<ReturnType<typeof listKeys>>;
export type KeysSummary = KeysResponse["summary"];

export type ResultsTab = "all" | "found" | "via_owner" | "no_match" | "error";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  /** 502/503 and network failures are worth retrying; anything else needs the user. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError(0, "Could not reach the server. Check your connection.");
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body (e.g. a platform timeout page)
  }
  if (response.status === 401 && path !== "/login" && typeof window !== "undefined") {
    // Session expired or password changed: reload so the middleware sends us to /login.
    window.location.reload();
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : response.status === 504
          ? "The server took too long to respond."
          : `Request failed (${response.status})`;
    throw new ApiClientError(response.status, message);
  }
  return body as T;
}

export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
