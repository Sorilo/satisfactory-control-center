import { describe, expect, it } from "vitest";
import { GET as live } from "../health/live/route";
import { GET as ready } from "../health/ready/route";
import { GET as combined } from "./route";

describe("health routes", () => {
  it("keeps liveness independent of optional upstreams", async () => {
    const response = await live();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "live" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports configuration readiness without private details", async () => {
    const response = await ready();
    expect([200, 503]).toContain(response.status);
    expect(JSON.stringify(await response.json())).not.toMatch(/FRM_BASE_URL|http:\/\//);
  });

  it("provides a combined sanitized status", async () => {
    const response = await combined();
    expect([200, 503]).toContain(response.status);
    expect(await response.json()).toHaveProperty("status");
  });
});
