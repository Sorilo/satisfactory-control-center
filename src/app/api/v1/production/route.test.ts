import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });

describe("GET /api/v1/production", () => {
  it("serves bounded current production with unsupported history", async () => {
    process.env.DATA_MODE = "mock";
    const response = await GET(new Request("http://app/api/v1/production?serverId=main&search=iron"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const body = await response.json();
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].itemKey).toBe("iron-rod");
    expect(body.data.history).toEqual({ state: "unsupported", reason: "production-history-not-observed" });
    expect(JSON.stringify(body)).not.toContain("ClassName");
  });

  it("returns a valid empty result for an unknown normalized item", async () => {
    process.env.DATA_MODE = "mock";
    const response = await GET(new Request("http://app/api/v1/production?serverId=main&itemKey=missing-item"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.freshness.state).toBe("live");
    expect(body.data.items).toEqual([]);
    expect(body.data.total).toBe(0);
  });

  it("rejects arbitrary upstream selectors", async () => {
    process.env.DATA_MODE = "mock";
    const response = await GET(new Request("http://app/api/v1/production?serverId=main&metric=items_produced_per_min"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_QUERY");
  });
});
