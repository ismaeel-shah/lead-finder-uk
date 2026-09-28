export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface TokenBucketOptions {
  /** Maximum burst size. */
  capacity: number;
  /** Sustained rate. */
  refillPerSecond: number;
}

/**
 * Token bucket rate limiter.
 *
 * The bucket starts full and refills continuously. Each request takes one
 * token; when the bucket is empty, callers wait until a token has refilled.
 * Callers are chained through a promise queue so tokens are handed out in
 * FIFO order and concurrent callers can never both take the last token.
 *
 * In any window of length T, at most `capacity + refillPerSecond * T`
 * requests can pass. Size both so that stays under the upstream limit.
 *
 * Note: state is per process. On Vercel each serverless instance has its own
 * bucket, so this protects a single instance; 429 backoff covers the rest.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private queue: Promise<void> = Promise.resolve();
  private readonly refillPerMs: number;

  constructor(
    private readonly options: TokenBucketOptions,
    private readonly clock: Clock = realClock,
  ) {
    this.tokens = options.capacity;
    this.lastRefill = clock.now();
    this.refillPerMs = options.refillPerSecond / 1000;
  }

  /** Resolves once a token has been taken. */
  take(): Promise<void> {
    const next = this.queue.then(() => this.acquire());
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Empties the bucket, e.g. after the upstream answers 429, so queued callers slow down. */
  drain(): void {
    this.refill();
    this.tokens = 0;
  }

  /** Current token count (for tests and diagnostics). */
  available(): number {
    this.refill();
    return this.tokens;
  }

  private async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil((1 - this.tokens) / this.refillPerMs);
      await this.clock.sleep(waitMs);
    }
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.options.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefill = now;
    }
  }
}
