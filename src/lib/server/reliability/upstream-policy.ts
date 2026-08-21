import { UpstreamError, type UpstreamErrorCode } from "@/lib/server/http/bounded-json";

export interface BoundedRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

const RETRYABLE_CODES = new Set<UpstreamErrorCode>([
  "UPSTREAM_UNAVAILABLE",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_HTTP_ERROR",
]);

const DEFAULT_MAX_ATTEMPTS = 2;
const MAX_ATTEMPTS = 2;
const DEFAULT_BASE_DELAY_MS = 50;

function isRetryable(error: unknown): error is UpstreamError {
  return error instanceof UpstreamError && RETRYABLE_CODES.has(error.code);
}

/** One bounded retry for transient upstream failures; never retries unsafe failures. */
export async function withBoundedRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: BoundedRetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.min(
    MAX_ATTEMPTS,
    Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS))
  );
  const baseDelayMs = Math.max(0, Math.min(500, Math.floor(options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS)));
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryable(error)) throw error;
      await sleep(baseDelayMs * attempt);
    }
  }
  throw lastError;
}
