export interface TokenBucketOptions {
  capacity: number;
  refillPerSecond: number;
  maxEntries?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  updatedAtMs: number;
}

export class TokenBucketLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly maxEntries: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor({ capacity, refillPerSecond, maxEntries = 10_000 }: TokenBucketOptions) {
    if (!Number.isFinite(capacity) || capacity <= 0 || !Number.isFinite(refillPerSecond) || refillPerSecond <= 0 || !Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error("Invalid token bucket configuration");
    }
    this.capacity = capacity;
    this.refillPerMs = refillPerSecond / 1000;
    this.maxEntries = maxEntries;
  }

  consume(key: string, nowMs = Date.now()): RateLimitDecision {
    const safeKey = key.slice(0, 128) || "unknown";
    let bucket = this.buckets.get(safeKey);
    if (!bucket) {
      this.makeRoom();
      bucket = { tokens: this.capacity, updatedAtMs: nowMs };
      this.buckets.set(safeKey, bucket);
    } else {
      // Refresh insertion order so the first key remains the least recently used.
      this.buckets.delete(safeKey);
      this.buckets.set(safeKey, bucket);
    }

    const elapsedMs = Math.max(0, nowMs - bucket.updatedAtMs);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedMs * this.refillPerMs);
    bucket.updatedAtMs = nowMs;


    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const waitMs = (1 - bucket.tokens) / this.refillPerMs;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
  }

  private makeRoom(): void {
    if (this.buckets.size < this.maxEntries) return;
    const oldestKey = this.buckets.keys().next().value as string | undefined;
    if (oldestKey !== undefined) this.buckets.delete(oldestKey);
  }
}

export function getClientKey(request: Request, trustProxyHeaders = false): string {
  if (!trustProxyHeaders) return "shared";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}
