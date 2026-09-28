/**
 * Shared HTTP helper for all external API calls: per-attempt timeout,
 * exponential backoff on 429 / 5xx / network errors, and logging.
 */

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface FetchWithRetryOptions {
  /** Short name used in logs, e.g. "companies-house". */
  label: string;
  maxRetries: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Awaited before every attempt, including retries (e.g. rate limiter). */
  beforeAttempt?: () => Promise<void>;
  /** Called when the upstream answers 429. */
  onRateLimited?: () => void;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isRetryableStatus = (status: number) => status === 429 || status >= 500;

export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, retryAfterHeader: string | null): number {
  const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSec) && retryAfterSec >= 0) {
    return Math.min(maxDelayMs, retryAfterSec * 1000);
  }
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(maxDelayMs, baseDelayMs * 2 ** attempt + jitter);
}

/**
 * Performs a fetch with retries. Returns the Response for any non-retryable
 * status (including 4xx) so callers can decide how to handle it. Throws
 * HttpError / the network error once retries are exhausted.
 */
export async function fetchWithRetry(url: string, init: RequestInit, options: FetchWithRetryOptions): Promise<Response> {
  const {
    label,
    maxRetries,
    timeoutMs = 15_000,
    baseDelayMs = 1_000,
    maxDelayMs = 30_000,
    beforeAttempt,
    onRateLimited,
    fetchImpl = fetch,
    sleep = defaultSleep,
  } = options;

  for (let attempt = 0; ; attempt++) {
    await beforeAttempt?.();
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt >= maxRetries) {
        console.error(`[${label}] ${init.method ?? "GET"} ${redact(url)} failed after ${attempt + 1} attempts: ${message}`);
        throw err instanceof Error ? err : new Error(message);
      }
      const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs, null);
      console.warn(`[${label}] network error (${message}); retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
      await sleep(delay);
      continue;
    }

    if (!isRetryableStatus(response.status)) {
      if (process.env.LOG_HTTP === "1") {
        console.info(`[${label}] ${init.method ?? "GET"} ${redact(url)} -> ${response.status} (${Date.now() - startedAt}ms)`);
      }
      return response;
    }

    if (response.status === 429) onRateLimited?.();
    const body = await response.text().catch(() => "");
    if (attempt >= maxRetries) {
      console.error(`[${label}] ${redact(url)} -> ${response.status} after ${attempt + 1} attempts`);
      throw new HttpError(`${label} request failed with status ${response.status}`, response.status, body.slice(0, 500));
    }
    const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs, response.headers.get("retry-after"));
    console.warn(`[${label}] ${response.status}; retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
    await sleep(delay);
  }
}

/** Strips query-string values that might carry keys before logging. */
function redact(url: string): string {
  return url.replace(/([?&](?:key|api_key|cx)=)[^&]*/gi, "$1***");
}
