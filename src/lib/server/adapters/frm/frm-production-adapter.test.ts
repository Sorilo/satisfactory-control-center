import { describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@/lib/server/http/bounded-json";
import { FrmProductionAdapter } from "./frm-production-adapter";

const payload = [
  {
    Name: "Iron Rod",
    ClassName: "Desc_IronRod_C",
    ProdPercent: 50,
    ConsPercent: 25,
    CurrentProd: 120,
    MaxProd: 240,
    CurrentConsumed: 60,
    MaxConsumed: 120,
    Type: "Solid",
  },
];

// Sanitized fixture preserving the observed FRM 1.5.3 getProdStats shape.
const realFrm153Payload = [
  {
    Name: "Biomass",
    ClassName: "Desc_GenericBiomass_C",
    ProdPerMin: "P: 0.0/ min - C: 0.35/ min",
    ProdPercent: 0,
    ConsPercent: 100,
    CurrentProd: 0,
    MaxProd: 0,
    CurrentConsumed: 0.3333333432674408,
    MaxConsumed: 0.3333333432674408,
    Type: "Solid",
  },
  {
    Name: "Iron Ingot",
    ClassName: "Desc_IronIngot_C",
    ProdPerMin: "P: 0.0/ min - C: 0.0/ min",
    ProdPercent: 0,
    ConsPercent: 0,
    CurrentProd: 0,
    MaxProd: 30,
    CurrentConsumed: 0,
    MaxConsumed: 0,
    Type: "Solid",
  },
  {
    Name: "Iron Ore",
    ClassName: "Desc_OreIron_C",
    ProdPerMin: "P: 0.0/ min - C: 0.0/ min",
    ProdPercent: 0,
    ConsPercent: 0,
    CurrentProd: 0,
    MaxProd: 29.999998092651367,
    CurrentConsumed: 0,
    MaxConsumed: 30,
    Type: "Solid",
  },
];

describe("FRM production adapter", () => {
  it("normalizes getProdStats into public-safe current production", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("http://frm:8080/getProdStats");
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    const provider = new FrmProductionAdapter({ baseUrl: "http://frm:8080", fetcher });

    const snapshot = await provider.getProduction();

    expect(snapshot.items[0]).toMatchObject({
      itemKey: "iron-rod",
      name: "Iron Rod",
      productionPerMinute: 120,
      consumptionPerMinute: 60,
      netPerMinute: 60,
    });
    expect(snapshot.items[0]).not.toHaveProperty("className");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("accepts the sanitized real FRM 1.5.3 payload and preserves numeric semantics", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(realFrm153Payload), { status: 200 }));
    const provider = new FrmProductionAdapter({ baseUrl: "http://frm:8080", fetcher });

    const snapshot = await provider.getProduction();

    expect(snapshot.items.map((item) => item.name)).toEqual(["Biomass", "Iron Ingot", "Iron Ore"]);
    expect(snapshot.items[0]).toMatchObject({
      name: "Biomass",
      form: "Solid",
      productionPerMinute: 0,
      maxProductionPerMinute: 0,
      consumptionPerMinute: 0.3333333432674408,
      maxConsumptionPerMinute: 0.3333333432674408,
      productionEfficiencyPercent: 0,
      consumptionEfficiencyPercent: 100,
    });
    expect(snapshot.items[0]?.netPerMinute).toBeCloseTo(-0.3333333432674408, 10);
    expect(snapshot.items[1]).toMatchObject({
      name: "Iron Ingot",
      productionPerMinute: 0,
      maxProductionPerMinute: 30,
      consumptionPerMinute: 0,
      netPerMinute: 0,
    });
    expect(snapshot.items[2]).toMatchObject({
      name: "Iron Ore",
      productionPerMinute: 0,
      maxProductionPerMinute: 29.999998092651367,
      maxConsumptionPerMinute: 30,
      netPerMinute: 0,
    });
    expect(JSON.stringify(snapshot)).not.toContain("ClassName");
    expect(JSON.stringify(snapshot)).not.toContain("P: 0.0/ min");
  });

  it("maps an unverified non-empty FRM form string to public Unknown", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ ...payload[0], Type: "FutureForm" }]), { status: 200 }));
    const provider = new FrmProductionAdapter({ baseUrl: "http://frm:8080", fetcher });

    const snapshot = await provider.getProduction();

    expect(snapshot.items[0]?.form).toBe("Unknown");
  });

  it("fails closed for malformed production values and retains a safe schema path", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ ...payload[0], CurrentProd: "unexpected" }]), { status: 200 }));
    const provider = new FrmProductionAdapter({ baseUrl: "http://frm:8080", fetcher });
    const error = await provider.getProduction().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({
      code: "UPSTREAM_SCHEMA_INVALID",
      schemaPath: "[0].CurrentProd",
      attempts: 1,
      retryResult: "not-retryable",
    });
    expect(JSON.stringify(error)).not.toMatch(/private|8080|ClassName|unexpected/i);
  });

  it("reports a precise safe path for a malformed ProdPerMin field", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ ...payload[0], ProdPerMin: 123 }]), { status: 200 }));
    const provider = new FrmProductionAdapter({ baseUrl: "http://frm:8080", fetcher });
    const error = await provider.getProduction().catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "UPSTREAM_SCHEMA_INVALID",
      schemaPath: "[0].ProdPerMin",
      attempts: 1,
      retryResult: "not-retryable",
    });
    expect(JSON.stringify(error)).not.toContain("123");
  });

  it("records a bounded retry result for a final transport failure", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("upstream transport failure [REDACTED]");
    });
    const provider = new FrmProductionAdapter({ baseUrl: "http://frm:8080", fetcher });
    const error = await provider.getProduction().catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      attempts: 2,
      retryResult: "failed-after-retry",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(error)).not.toMatch(/private|8080|secret|authorization-value/i);
  });
});
