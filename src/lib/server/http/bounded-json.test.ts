import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  parseUpstream,
  requestBoundedJson,
  UpstreamError,
  type Fetcher,
} from "./bounded-json";

const jsonResponse = (value: unknown, init?: ResponseInit) => {
  const body = JSON.stringify(value);
  return new Response(body, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
};

describe("bounded JSON transport", () => {
  it("rejects redirects and preserves caller-owned headers", async () => {
    const fetcher = vi.fn<Fetcher>(async (_input, init) => {
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("X-Test-Authorization")).toBe("opaque");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return jsonResponse({ ok: true });
    });
    await expect(
      requestBoundedJson({
        url: "http://private/read",
        headers: { "X-Test-Authorization": "opaque" },
        fetcher,
        timeoutMs: 100,
        maxResponseBytes: 1_000,
      })
    ).resolves.toEqual({ ok: true });
  });

  it("maps non-success HTTP status without leaking the URL or response", async () => {
    const fetcher = vi.fn<Fetcher>(async () =>
      jsonResponse({ token: "secret", detail: "private" }, { status: 503 })
    );
    const error = await requestBoundedJson({
      url: "http://private:9090/api",
      fetcher,
      timeoutMs: 100,
      maxResponseBytes: 1_000,
    }).catch((caught: unknown) => caught);
    expect(error).toEqual(expect.objectContaining({ code: "UPSTREAM_HTTP_ERROR" }));
    expect(String(error)).not.toMatch(/private|9090|secret|503/);
  });

  it("rejects a declared body above the byte cap", async () => {
    const fetcher = vi.fn<Fetcher>(async () =>
      new Response("[]", { headers: { "content-length": "5000" } })
    );
    await expect(
      requestBoundedJson({
        url: "http://private/read",
        fetcher,
        timeoutMs: 100,
        maxResponseBytes: 100,
      })
    ).rejects.toMatchObject({ code: "UPSTREAM_RESPONSE_TOO_LARGE" });
  });

  it("cancels a streamed body immediately after crossing the byte cap", async () => {
    let cancellations = 0;
    const fetcher = vi.fn<Fetcher>(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(80));
          controller.enqueue(new Uint8Array(80));
        },
        cancel() {
          cancellations += 1;
        },
      });
      return new Response(body);
    });
    await expect(
      requestBoundedJson({
        url: "http://private/read",
        fetcher,
        timeoutMs: 100,
        maxResponseBytes: 100,
      })
    ).rejects.toMatchObject({ code: "UPSTREAM_RESPONSE_TOO_LARGE" });
    await vi.waitFor(() => expect(cancellations).toBe(1));
  });

  it("maps malformed JSON to a stable schema-invalid code", async () => {
    const fetcher = vi.fn<Fetcher>(async () => new Response("{not-json"));
    await expect(
      requestBoundedJson({
        url: "http://private/read",
        fetcher,
        timeoutMs: 100,
        maxResponseBytes: 1_000,
      })
    ).rejects.toMatchObject({ code: "UPSTREAM_SCHEMA_INVALID" });
  });

  it("distinguishes transport timeout from caller cancellation", async () => {
    const abortingFetcher = vi.fn<Fetcher>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );
    await expect(
      requestBoundedJson({
        url: "http://private/read",
        fetcher: abortingFetcher,
        timeoutMs: 1,
        maxResponseBytes: 1_000,
      })
    ).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT" });

    const caller = new AbortController();
    const pendingRequest = requestBoundedJson({
        url: "http://private/read",
        fetcher: abortingFetcher,
        timeoutMs: 100,
        maxResponseBytes: 1_000,
        signal: caller.signal,
      });
    caller.abort();
    await expect(pendingRequest).rejects.toMatchObject({
      code: "UPSTREAM_CANCELLED",
    });
  });

  it("uses a strict caller schema and emits only sanitized typed errors", () => {
    const schema = z.object({ id: z.string() }).strict();
    expect(parseUpstream(schema, { id: "0" })).toEqual({ id: "0" });
    expect(() => parseUpstream(schema, { id: "0", token: "secret" })).toThrow(
      expect.objectContaining({ code: "UPSTREAM_SCHEMA_INVALID" })
    );
    const error = new UpstreamError("UPSTREAM_UNAVAILABLE");
    expect(error.message).toBe("UPSTREAM_UNAVAILABLE");
    expect(JSON.stringify(error)).not.toContain("secret");
  });
});
