import { describe, expect, it } from "vitest";
import { overviewEnvelopeSchema, serverCatalogSchema } from "./public-contracts";

describe("public v1 contracts", () => {
  it("rejects undeclared fields at the public boundary", () => {
    expect(() => serverCatalogSchema.parse({ defaultServerId: "main", servers: [{ id: "main", displayName: "Main", frmBaseUrl: "http://private" }] })).toThrow();
  });

  it("accepts explicit unavailable overview state", () => {
    expect(overviewEnvelopeSchema.parse({ apiVersion: "v1", generatedAt: "2026-08-18T18:00:00.000Z", serverId: "main", freshness: { state: "unavailable", observedAt: null }, data: null, unavailableSources: ["frm"] }).data).toBeNull();
  });
});
