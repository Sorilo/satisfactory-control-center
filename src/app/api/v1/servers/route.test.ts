import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });

describe("GET /api/v1/servers", () => {
  it("returns only public metadata with safe cache rules", async () => {
    process.env.DATA_MODE = "mock";
    process.env.DEFAULT_SERVER_NAME = "Satisfriendery";
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toMatch(/public/);
    const body = await response.json();
    expect(body).toEqual({ defaultServerId: "main", servers: [{ id: "main", displayName: "Satisfriendery" }] });
    expect(JSON.stringify(body)).not.toMatch(/frm|token|url/i);
  });

  it("returns a sanitized 503 when runtime configuration is invalid", async () => {
    process.env.DATA_MODE = "live";
    delete process.env.FRM_BASE_URL;
    delete process.env.SERVERS_JSON;
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: {
        code: "CONFIGURATION_UNAVAILABLE",
        message: "Service configuration is unavailable."
      }
    });
  });
});
