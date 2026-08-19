import { describe, expect, it } from "vitest";
import { overviewEnvelopeSchema, serverCatalogSchema } from "./public-contracts";

describe("public v1 contracts", () => {
  it("rejects undeclared fields at the public boundary", () => {
    expect(() => serverCatalogSchema.parse({ defaultServerId: "main", servers: [{ id: "main", displayName: "Main", frmBaseUrl: "http://private" }] })).toThrow();
  });

  it("accepts explicit unavailable overview state", () => {
    expect(overviewEnvelopeSchema.parse({ apiVersion: "v1", generatedAt: "2026-08-18T18:00:00.000Z", serverId: "main", freshness: { state: "unavailable", observedAt: null }, data: null, unavailableSources: ["frm"] }).data).toBeNull();
  });

  it("accepts capacity-based overview power and rejects unresolved production", () => {
    const envelope = {
      apiVersion: "v1",
      generatedAt: "2026-08-18T18:00:00.000Z",
      serverId: "main",
      freshness: { state: "live", observedAt: "2026-08-18T17:59:59.000Z" },
      data: {
        server: { online: true },
        session: null,
        players: { online: 0, names: [] },
        power: {
          capacityMw: 20,
          consumptionMw: 5,
          headroomMw: 15,
          utilizationPercent: 25,
          fuseTriggered: false,
        },
        factory: { machineCount: 0, producingCount: 0, averageEfficiencyPercent: null },
        progress: null,
      },
      unavailableSources: [],
    };
    expect(() => overviewEnvelopeSchema.parse(envelope)).not.toThrow();
    expect(() => overviewEnvelopeSchema.parse({
      ...envelope,
      data: { ...envelope.data, power: { ...envelope.data.power, productionMw: 10 } },
    })).toThrow();
  });
});
