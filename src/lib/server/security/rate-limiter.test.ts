import { describe, expect, it } from "vitest";
import { TokenBucketLimiter } from "./rate-limiter";

describe("TokenBucketLimiter", () => {
  it("bounds bursts per key and reports a retry delay", () => {
    const limiter = new TokenBucketLimiter({ capacity: 2, refillPerSecond: 1 });
    expect(limiter.consume("client", 0)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.consume("client", 0)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.consume("client", 0)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.consume("other", 0).allowed).toBe(true);
  });

  it("refills over time without exceeding capacity", () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSecond: 0.5 });
    expect(limiter.consume("client", 1_000).allowed).toBe(true);
    expect(limiter.consume("client", 2_000).allowed).toBe(false);
    expect(limiter.consume("client", 3_000).allowed).toBe(true);
  });

  it("rejects invalid limiter configuration", () => {
    expect(() => new TokenBucketLimiter({ capacity: 0, refillPerSecond: 1 })).toThrow();
    expect(() => new TokenBucketLimiter({ capacity: 1, refillPerSecond: -1 })).toThrow();
  });
});
