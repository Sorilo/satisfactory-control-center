import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });

describe("GET /api/v1/overview", () => {
  it("serves a normalized mock overview", async () => {
    process.env.DATA_MODE = "mock";
    const response = await GET(new Request("http://app/api/v1/overview?serverId=main"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.apiVersion).toBe("v1");
    expect(body.serverId).toBe("main");
    expect(body.freshness.state).toBe("live");
    expect(body.data.players.online).toBeGreaterThan(0);
  });

  it("rejects malformed IDs without leaking registry details", async () => {
    process.env.DATA_MODE = "mock";
    const response = await GET(new Request("http://app/api/v1/overview?serverId=http%3A%2F%2F169.254.169.254"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_SERVER_ID");
    expect(JSON.stringify(body)).not.toMatch(/169\.254|Main World/);
  });

  it("returns 404 for a valid but unknown opaque ID", async () => {
    process.env.DATA_MODE = "mock";
    const response = await GET(new Request("http://app/api/v1/overview?serverId=unknown-world"));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("SERVER_NOT_FOUND");
  });

  it("returns a sanitized 503 when runtime configuration is invalid", async () => {
    process.env.DATA_MODE = "live";
    delete process.env.FRM_BASE_URL;
    delete process.env.SERVERS_JSON;
    const response = await GET(new Request("http://app/api/v1/overview?serverId=main"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("CONFIGURATION_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toMatch(/FRM_BASE_URL|live data mode/i);
  });
});
