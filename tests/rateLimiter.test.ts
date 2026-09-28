import { describe, expect, it } from "vitest";
import { TokenBucket, type Clock } from "@/lib/rateLimiter";

function fakeClock(): Clock & { time: number } {
  const clock = {
    time: 0,
    now: () => clock.time,
    sleep: async (ms: number) => {
      clock.time += ms;
    },
  };
  return clock;
}

describe("TokenBucket", () => {
  it("allows a burst up to capacity without waiting", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 5, refillPerSecond: 1 }, clock);
    for (let i = 0; i < 5; i++) await bucket.take();
    expect(clock.time).toBe(0);
  });

  it("waits for refill once the bucket is empty", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 2 }, clock);
    await bucket.take();
    await bucket.take();
    await bucket.take(); // needs one token at 2/s -> 500ms
    expect(clock.time).toBe(500);
  });

  it("keeps sustained throughput at the refill rate", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 20, refillPerSecond: 500 / 300 }, clock);
    for (let i = 0; i < 520; i++) await bucket.take();
    // 20 burst + 500 at 500/300s => ~300s
    expect(clock.time).toBeGreaterThanOrEqual(299_000);
    expect(clock.time).toBeLessThanOrEqual(301_000);
  });

  it("serves concurrent callers without over-issuing tokens", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 1 }, clock);
    await Promise.all(Array.from({ length: 6 }, () => bucket.take()));
    expect(clock.time).toBe(3000);
  });

  it("drain() forces callers to wait", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 10, refillPerSecond: 10 }, clock);
    bucket.drain();
    expect(bucket.available()).toBe(0);
    await bucket.take();
    expect(clock.time).toBe(100);
  });
});
