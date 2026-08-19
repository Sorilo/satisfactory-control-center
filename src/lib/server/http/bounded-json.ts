import { z } from "zod";

export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type UpstreamErrorCode =
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_CANCELLED"
  | "UPSTREAM_HTTP_ERROR"
  | "UPSTREAM_RESPONSE_TOO_LARGE"
  | "UPSTREAM_SCHEMA_INVALID";

/** Public-safe error with no upstream URL, payload, status, or credentials. */
export class UpstreamError extends Error {
  readonly code: UpstreamErrorCode;

  constructor(code: UpstreamErrorCode) {
    super(code);
    this.name = "UpstreamError";
    this.code = code;
  }
}

export interface BoundedJsonRequestOptions {
  url: string | URL;
  headers?: HeadersInit;
  fetcher?: Fetcher;
  timeoutMs: number;
  maxResponseBytes: number;
  signal?: AbortSignal;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort; the stable size error remains authoritative.
  }
}

async function readBodyWithinLimit(
  response: Response,
  maxResponseBytes: number
): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxResponseBytes) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the stable size error even if upstream cancellation fails.
      }
      throw new UpstreamError("UPSTREAM_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Fetch and decode one bounded JSON document. Redirects are rejected, both
 * declared and streamed bytes are capped, and transport details are collapsed
 * into stable sanitized codes.
 */
export async function requestBoundedJson(
  options: BoundedJsonRequestOptions
): Promise<unknown> {
  if (options.signal?.aborted) {
    throw new UpstreamError("UPSTREAM_CANCELLED");
  }

  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  let callerCancelled = false;
  const onCallerAbort = () => {
    callerCancelled = true;
    controller.abort();
  };
  options.signal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);

  try {
    const response = await fetcher(options.url, {
      headers: options.headers,
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await cancelBody(response);
      throw new UpstreamError("UPSTREAM_HTTP_ERROR");
    }

    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      const bytes = Number(declaredLength);
      if (Number.isFinite(bytes) && bytes > options.maxResponseBytes) {
        await cancelBody(response);
        throw new UpstreamError("UPSTREAM_RESPONSE_TOO_LARGE");
      }
    }

    const bytes = await readBodyWithinLimit(response, options.maxResponseBytes);
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new UpstreamError("UPSTREAM_SCHEMA_INVALID");
    }
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (callerCancelled || options.signal?.aborted) {
      throw new UpstreamError("UPSTREAM_CANCELLED");
    }
    if (timedOut) throw new UpstreamError("UPSTREAM_TIMEOUT");
    throw new UpstreamError("UPSTREAM_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}

/** Parse already-decoded upstream data with a caller-owned allowlist schema. */
export function parseUpstream<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new UpstreamError("UPSTREAM_SCHEMA_INVALID");
  }
  return parsed.data;
}
