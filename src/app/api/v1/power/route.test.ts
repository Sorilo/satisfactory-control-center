import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PowerEnvelope } from "@/contracts/power-contracts";
import { GET, handlePowerRequest, resetPowerRouteLimiterForTests } from "./route";

const original = { ...process.env };

beforeEach(() => {
  process.env = { ...original, DATA_MODE: "mock" };
  resetPowerRouteLimiterForTests();
});
afterEach(() => { process.env = { ...original }; });

function envelope(unavailableSources: Array<"frm" | "prometheus">): PowerEnvelope {
  const currentUnavailable = unavailableSources.includes("frm");
  const historyUnavailable = unavailableSources.includes("prometheus");
  return {
    apiVersion: "v1",
    generatedAt: "2026-08-18T18:00:00.000Z",
    serverId: "main",
    freshness: {
      current: currentUnavailable ? { state: "unavailable", observedAt: null } : { state: "live", observedAt: "2026-08-18T18:00:00.000Z" },
      history: historyUnavailable ? { state: "unavailable", observedAt: null } : { state: "live", observedAt: null },
    },
    data: {
      current: currentUnavailable ? null : {
        topologyState: "no-circuits",
        totals: { capacityMw: 0, consumptionMw: 0, reportedMaximumConsumptionMw: 0, headroomMw: 0, utilizationPercent: null, fuseTriggered: false },
        circuits: [],
        generators: { state: "unavailable", items: [] },
        majorConsumers: { state: "unavailable", items: [] },
      },
      history: historyUnavailable ? null : {
        coverage: { state: "empty", requestedRange: "1h", effectiveResolution: "1m", retentionHorizonDays: 15, oldestSampleAt: null, newestSampleAt: null },
        series: [],
        production: { state: "unavailable", reason: "source-not-collected" },
      },
    },
    unavailableSources,
  };
}

describe("GET /api/v1/power", () => {
  it("uses default server/range/resolution and serves a strict mock envelope", async () => {
    const response = await GET(new Request("http://app/api/v1/power"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.serverId).toBe("main");
    expect(body.data.history.coverage).toMatchObject({ requestedRange: "1h", effectiveResolution: "15s" });
    expect(body.data.current.generators).toMatchObject({
      state: "live",
      items: [{
        circuit: { state: "connected", id: "0" },
        fuelType: "biomass",
        fuelInventory: { name: "Biomass", amount: 170, capacity: 200 },
      }],
    });
    expect(body.data.current.majorConsumers).toMatchObject({
      state: "live",
      items: [{ name: "Miner Mk.1", consumptionMw: 5, maximumConsumptionMw: 5 }],
    });
    expect(JSON.stringify(body)).not.toMatch(
      /productionMw|PowerProduction|RegulatedDemandProd|DynamicProd|promql|session_name|urlLabel|ClassName|location|fixture-/
    );
  });

  it("accepts every allowlisted range/resolution combination", async () => {
    for (const range of ["1h", "6h", "24h", "7d", "15d"]) {
      for (const resolution of ["auto", "1m", "5m", "15m", "1h"]) {
        resetPowerRouteLimiterForTests();
        const response = await GET(new Request(`http://app/api/v1/power?serverId=main&range=${range}&resolution=${resolution}`));
        expect(response.status, `${range}/${resolution}`).toBe(200);
        expect((await response.json()).data.history.coverage.requestedRange).toBe(range);
      }
    }
  });

  it("rejects unknown, duplicate, malformed, and outside-retention query values", async () => {
    for (const query of [
      "serverId=main&query=up",
      "serverId=main&range=1h&range=6h",
      "serverId=main&range=30d",
      "serverId=main&resolution=3m",
    ]) {
      resetPowerRouteLimiterForTests();
      const response = await GET(new Request(`http://app/api/v1/power?${query}`));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_QUERY");
    }

    const malformed = await GET(new Request("http://app/api/v1/power?serverId=http%3A%2F%2F169.254.169.254"));
    expect(malformed.status).toBe(400);
    expect(JSON.stringify(await malformed.json())).not.toContain("169.254");
  });

  it("returns 404 for a valid unknown opaque server id", async () => {
    const response = await GET(new Request("http://app/api/v1/power?serverId=unknown-world"));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("SERVER_NOT_FOUND");
  });

  it("keeps partial source degradation successful but returns 503 when both fail", async () => {
    const partial = await handlePowerRequest(
      new Request("http://app/api/v1/power"),
      async () => envelope(["prometheus"])
    );
    expect(partial.status).toBe(200);
    expect((await partial.json()).data.current).not.toBeNull();

    resetPowerRouteLimiterForTests();
    const unavailable = await handlePowerRequest(
      new Request("http://app/api/v1/power"),
      async () => envelope(["frm", "prometheus"])
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
    const body = await unavailable.json();
    expect(body.unavailableSources).toEqual(["frm", "prometheus"]);
  });

  it("fails closed when a loader result contains an extra private field", async () => {
    const invalid = {
      ...envelope([]),
      privateSelector: "session_name=secret",
    } as unknown as PowerEnvelope;
    const response = await handlePowerRequest(
      new Request("http://app/api/v1/power"),
      async () => invalid
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Power service unavailable.",
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/privateSelector|session_name|secret/);
  });

  it("rate limits history requests with Retry-After", async () => {
    let response: Response | undefined;
    for (let index = 0; index < 21; index += 1) {
      response = await GET(new Request("http://app/api/v1/power"));
    }
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await response!.json()).error.code).toBe("RATE_LIMITED");
  });

  it("returns sanitized 503 for invalid runtime configuration", async () => {
    process.env.DATA_MODE = "live";
    delete process.env.FRM_BASE_URL;
    delete process.env.SERVERS_JSON;
    const response = await GET(new Request("http://app/api/v1/power"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("CONFIGURATION_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toMatch(/FRM_BASE_URL|live data mode/i);
  });
});
