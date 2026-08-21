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
