import { describe, expect, it } from "vitest";
import { createRequestContext } from "./request-context";

describe("request context", () => {
  it("generates a bounded correlation id without trusting client input", () => {
    const context = createRequestContext(
      new Request("http://localhost/api/v1/overview", {
        headers: { "x-request-id": "client-controlled" },
      }),
      "/api/v1/overview"
    );

    expect(context).toMatchObject({ route: "/api/v1/overview" });
    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(context.requestId).not.toBe("client-controlled");
  });

  it("keeps optional public server ids bounded and omits invalid values", () => {
    const valid = createRequestContext(new Request("http://localhost"), "/api", "main_2");
    const invalid = createRequestContext(new Request("http://localhost"), "/api", "http://private");
    expect(valid.serverId).toBe("main_2");
    expect(invalid.serverId).toBeUndefined();
  });
});
