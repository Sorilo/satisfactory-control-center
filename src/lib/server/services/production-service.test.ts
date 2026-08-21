import { beforeEach, describe, expect, it } from "vitest";
import { UpstreamError } from "@/lib/server/http/bounded-json";
import { createStructuredLogger } from "@/lib/server/observability/logger";
import { clearProductionServiceCachesForTests, getCachedProductionEnvelope, getProductionEnvelope } from "./production-service";
import type { ProductionProvider, ProductionSnapshot } from "@/domain/production";

const snapshot: ProductionSnapshot = {
  observedAt: "2026-08-21T03:00:00.000Z",
  items: [
    {
      itemKey: "iron-rod",
      name: "Iron Rod",
      form: "Solid",
      productionPerMinute: 120,
      consumptionPerMinute: 60,
      maxProductionPerMinute: 240,
      maxConsumptionPerMinute: 120,
      netPerMinute: 60,
      productionEfficiencyPercent: 50,
      consumptionEfficiencyPercent: 50,
      provenance: { throughput: "observed", capacity: "observed", net: "calculated" },
    },
    {
      itemKey: "copper-sheet",
      name: "Copper Sheet",
      form: "Solid",
      productionPerMinute: 20,
      consumptionPerMinute: 40,
      maxProductionPerMinute: 40,
      maxConsumptionPerMinute: 40,
      netPerMinute: -20,
      productionEfficiencyPercent: 50,
      consumptionEfficiencyPercent: 100,
      provenance: { throughput: "observed", capacity: "observed", net: "calculated" },
    },
  ],
};

const provider = (result: ProductionSnapshot | Error): ProductionProvider => ({
  getProduction: async () => {
    if (result instanceof Error) throw result;
    return result;
  },
});

describe("production service", () => {
  beforeEach(() => {
    clearProductionServiceCachesForTests();
  });

  it("coalesces concurrent reads for the same server and query", async () => {
    let calls = 0;
    const countingProvider: ProductionProvider = {
      getProduction: async () => {
        calls += 1;
        await Promise.resolve();
        return snapshot;
      },
    };
    const first = getCachedProductionEnvelope("main", countingProvider, { serverId: "main", search: "iron", limit: 1 });
    const second = getCachedProductionEnvelope("main", countingProvider, { serverId: "main", search: "iron", limit: 1 });
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });

  it("filters by bounded item key/search and caps result count", async () => {
    const envelope = await getProductionEnvelope("main", provider(snapshot), { serverId: "main", search: "iron", limit: 1 });
    expect(envelope.data?.items.map((item) => item.itemKey)).toEqual(["iron-rod"]);
    expect(envelope.data?.history).toEqual({ state: "unsupported", reason: "production-history-not-observed" });
  });

  it("keeps a valid empty search distinct from unavailable", async () => {
    const envelope = await getProductionEnvelope("main", provider(snapshot), { serverId: "main", itemKey: "missing-item" });
    expect(envelope.freshness.state).toBe("live");
    expect(envelope.data).toMatchObject({ items: [], total: 0 });
  });

  it("logs sanitized timeout diagnostics while keeping the public envelope opaque", async () => {
    const lines: string[] = [];
    const logger = createStructuredLogger((line) => lines.push(line));
    const error = new UpstreamError("UPSTREAM_TIMEOUT");
    Object.assign(error, {
      attempts: 2,
      retryResult: "failed-after-retry",
      schemaPath: "response",
    });

    const envelope = await getProductionEnvelope(
      "main",
      provider(error),
      { serverId: "main" },
      undefined,
      { requestId: "req-production-1", route: "/api/v1/production", logger }
    );

    expect(envelope).toMatchObject({
      freshness: { state: "unavailable" },
      data: null,
      unavailableSources: ["frm"],
    });
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!);
    expect(record).toMatchObject({
      level: "error",
      message: "production upstream failure",
      requestId: "req-production-1",
      route: "/api/v1/production",
      serverId: "main",
      source: "frm",
      adapter: "frm-production",
      code: "UPSTREAM_TIMEOUT",
      failureCategory: "timeout",
      retryResult: "failed-after-retry",
      attempts: 2,
      schemaPath: "response",
      state: "unavailable",
    });
    expect(JSON.stringify(record)).not.toMatch(/token|private|8080|ClassName|secret/i);
    expect(JSON.stringify(envelope)).not.toMatch(/failureCategory|retryResult|schemaPath|UPSTREAM_/i);
  });

  it("classifies schema failures separately and logs only a bounded field path", async () => {
    const lines: string[] = [];
    const logger = createStructuredLogger((line) => lines.push(line));
    const error = new UpstreamError("UPSTREAM_SCHEMA_INVALID", {
      schemaPath: "[0].CurrentProd",
      retryResult: "not-retryable",
    });

    await getProductionEnvelope(
      "main",
      provider(error),
      { serverId: "main" },
      undefined,
      { requestId: "req-production-2", route: "/production", logger }
    );

    const record = JSON.parse(lines[0]!);
    expect(record).toMatchObject({
      failureCategory: "schema",
      retryResult: "not-retryable",
      schemaPath: "[0].CurrentProd",
      state: "unavailable",
    });
    expect(JSON.stringify(record)).not.toMatch(/ClassName|private|token|secret/i);
  });

  it("returns a sanitized unavailable state without upstream details", async () => {
    const envelope = await getProductionEnvelope("main", provider(new Error("upstream unavailable [REDACTED]")), { serverId: "main" });
    expect(envelope.freshness.state).toBe("unavailable");
    expect(envelope.data).toBeNull();
    expect(envelope.unavailableSources).toEqual(["frm"]);
    expect(JSON.stringify(envelope)).not.toContain("[REDACTED]");
  });
});
