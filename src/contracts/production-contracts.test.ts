import { describe, expect, it } from "vitest";
import { productionEnvelopeSchema, productionQuerySchema } from "./production-contracts";

describe("production public contracts", () => {
  it("accepts current item production with explicit unsupported history", () => {
    const envelope = {
      apiVersion: "v1",
      generatedAt: "2026-08-21T03:00:00.000Z",
      serverId: "main",
      freshness: { state: "live", observedAt: "2026-08-21T03:00:00.000Z" },
      data: {
        items: [{
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
        }],
        total: 1,
        history: { state: "unsupported", reason: "production-history-not-observed" },
      },
      unavailableSources: [],
    };
    expect(productionEnvelopeSchema.parse(envelope).data?.history.state).toBe("unsupported");
  });

  it("rejects raw upstream identity and arbitrary selectors", () => {
    expect(() => productionQuerySchema.parse({ serverId: "main", metric: "items_produced_per_min" })).toThrow();
    expect(() => productionEnvelopeSchema.parse({
      apiVersion: "v1",
      generatedAt: "2026-08-21T03:00:00.000Z",
      serverId: "main",
      freshness: { state: "live", observedAt: "2026-08-21T03:00:00.000Z" },
      data: { items: [], total: 0, history: { state: "unsupported", reason: "production-history-not-observed" }, ClassName: "private" },
      unavailableSources: [],
    })).toThrow();
  });

  it("bounds public search inputs", () => {
    expect(productionQuerySchema.parse({ serverId: "main", search: "iron", limit: 25 })).toEqual({ serverId: "main", search: "iron", limit: 25 });
    expect(() => productionQuerySchema.parse({ serverId: "main", search: "x".repeat(81) })).toThrow();
    expect(() => productionQuerySchema.parse({ serverId: "main", limit: 101 })).toThrow();
  });
});
