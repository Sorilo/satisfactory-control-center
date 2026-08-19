import { describe, expect, it, vi } from "vitest";
import { FrmOverviewAdapter } from "./frm-overview-adapter";

const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json", "content-length": String(JSON.stringify(value).length) } });

describe("FRM overview adapter", () => {
  it("calls only reviewed read endpoints and normalizes documented fields", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      expect(new Headers(init?.headers).get("X-FRM-Authorization")).toBe("read-token");
      if (path === "/getSessionInfo") return jsonResponse({ SessionName: "Satisfriendery", IsPaused: false, TotalPlayDuration: 3661, TotalPlayDurationText: "01:01:01" });
      if (path === "/getPlayer") return jsonResponse([{ ID: "p1", Name: "Ada", Online: true, PlayerHP: 100, location: { x: 1, y: 2, z: 3 }, Inventory: [{ Name: "Secret item", Amount: 1 }] }]);
      if (path === "/getPower") return jsonResponse([{ CircuitGroupID: 0, PowerProduction: 4200, PowerConsumed: 3100, PowerCapacity: 5000, PowerMaxConsumed: 3500, BatteryInput: 100, BatteryOutput: 0, BatteryPercent: 75, BatteryCapacity: 1000, BatteryDifferential: 100, BatteryTimeEmpty: "00:00:00", BatteryTimeFull: "02:00:00", FuseTriggered: false, AssociatedCircuits: [1] }]);
      if (path === "/getFactory") return jsonResponse([{ ID: "f1", Name: "Constructor", IsConfigured: true, IsProducing: true, Productivity: 91 }]);
      if (path === "/getSpaceElevator") return jsonResponse([{ ID: "s1", Name: "Space Elevator", FullyUpgraded: false, UpgradeReady: false, CurrentPhase: [{ Name: "Smart Plating", Amount: 25, RemainingCost: 25, TotalCost: 50 }] }]);
      throw new Error(`unexpected endpoint ${path}`);
    });
    const adapter = new FrmOverviewAdapter({ baseUrl: "http://frm:8080", token: "read-token", fetcher });
    const snapshot = await adapter.getOverview();
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(snapshot.session).toMatchObject({ name: "Satisfriendery", uptimeSeconds: 3661, paused: false });
    expect(snapshot.players).toEqual({ online: 1, names: ["Ada"] });
    expect(JSON.stringify(snapshot.players)).not.toMatch(/location|Inventory|Secret/);
    expect(snapshot.power).toEqual({ capacityMw: 5000, consumptionMw: 3100, headroomMw: 1900, utilizationPercent: 62, fuseTriggered: false });
    expect(JSON.stringify(snapshot.power)).not.toContain("productionMw");
    expect(snapshot.factory).toEqual({ machineCount: 1, producingCount: 1, averageEfficiencyPercent: 91 });
    expect(snapshot.progress?.items[0]).toMatchObject({ name: "Smart Plating", delivered: 25, required: 50 });
  });

  it("rejects malformed upstream data instead of passing it through", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ internal: "unexpected object" }));
    const adapter = new FrmOverviewAdapter({ baseUrl: "http://frm:8080", fetcher });
    await expect(adapter.getOverview()).rejects.toMatchObject({ code: "UPSTREAM_SCHEMA_INVALID" });
  });

  it("rejects responses over the configured size bound", async () => {
    const fetcher = vi.fn(async () => new Response("[]", { headers: { "content-length": "5000", "content-type": "application/json" } }));
    const adapter = new FrmOverviewAdapter({ baseUrl: "http://frm:8080", fetcher, maxResponseBytes: 100 });
    await expect(adapter.getOverview()).rejects.toMatchObject({ code: "UPSTREAM_RESPONSE_TOO_LARGE" });
  });

  it("refuses redirects so the custom FRM token cannot cross origins", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      throw new TypeError("redirect refused");
    });
    const adapter = new FrmOverviewAdapter({ baseUrl: "http://frm:8080", token: "read-token", fetcher });
    await expect(adapter.getOverview()).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  it("stops reading a chunked body as soon as the byte cap is exceeded", async () => {
    let cancellationCount = 0;
    const fetcher = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(80));
          controller.enqueue(new Uint8Array(80));
        },
        cancel() { cancellationCount += 1; }
      });
      return new Response(body, { headers: { "content-type": "application/json" } });
    });
    const adapter = new FrmOverviewAdapter({ baseUrl: "http://frm:8080", fetcher, maxResponseBytes: 100 });
    await expect(adapter.getOverview()).rejects.toMatchObject({ code: "UPSTREAM_RESPONSE_TOO_LARGE" });
    await vi.waitFor(() => expect(cancellationCount).toBeGreaterThan(0));
  });
});
