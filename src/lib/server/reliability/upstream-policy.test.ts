import { describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@/lib/server/http/bounded-json";
import { withBoundedRetry } from "./upstream-policy";

describe("bounded upstream retry policy", () => {
  it("retries one transient transport failure and then succeeds", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new UpstreamError("UPSTREAM_TIMEOUT"))
      .mockResolvedValueOnce("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withBoundedRetry(operation, { sleep, baseDelayMs: 25 })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(25);
  });

  it("does not retry schema, cancellation, or oversized-response failures", async () => {
    for (const code of ["UPSTREAM_SCHEMA_INVALID", "UPSTREAM_CANCELLED", "UPSTREAM_RESPONSE_TOO_LARGE"] as const) {
      const operation = vi.fn().mockRejectedValue(new UpstreamError(code));
      await expect(withBoundedRetry(operation)).rejects.toMatchObject({ code });
      expect(operation).toHaveBeenCalledTimes(1);
    }
  });

  it("caps a misconfigured retry count at two attempts", async () => {
    const operation = vi.fn().mockRejectedValue(new UpstreamError("UPSTREAM_UNAVAILABLE"));
    await expect(withBoundedRetry(operation, { maxAttempts: 99, sleep: vi.fn() })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
