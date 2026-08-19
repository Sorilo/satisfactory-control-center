import { describe, expect, it, vi } from "vitest";
import liveFixture from "../../../../../docs/fixtures/slice2-task0/frm-get-power-live.json";
import noCircuitsFixture from "../../../../../docs/fixtures/slice2-task0/frm-get-power-no-circuits.json";
import { FrmPowerAdapter } from "./frm-power-adapter";

const jsonResponse = (value: unknown) => {
  const body = JSON.stringify(value);
  return new Response(body, {
    headers: { "content-type": "application/json", "content-length": String(body.length) },
  });
};

const populatedCircuit = {
  ...liveFixture[0],
  CircuitGroupID: 10,
  PowerProduction: 999,
  PowerConsumed: 12,
  PowerCapacity: 10,
  PowerMaxConsumed: 11,
  BatteryDifferential: -3,
  BatteryPercent: 50,
  BatteryTimeEmpty: "01:02:03",
  BatteryTimeFull: "garbage",
  AssociatedCircuits: [10, 11],
  FuseTriggered: true,
};

describe("FRM power adapter", () => {
  it("binds the sanitized live fixture and strips unresolved PowerProduction", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(new URL(String(input)).pathname).toBe("/getPower");
      expect(new Headers(init?.headers).get("X-FRM-Authorization")).toBe("read-token");
      expect(init?.redirect).toBe("error");
      return jsonResponse(liveFixture);
    });
    const adapter = new FrmPowerAdapter({
      baseUrl: "http://frm:8080/",
      token: "read-token",
      fetcher,
      now: () => new Date("2026-08-18T18:00:00.000Z"),
    });
    const state = await adapter.getPower();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(state).toEqual({
      topologyState: "available",
      observedAt: "2026-08-18T18:00:00.000Z",
      totals: {
        capacityMw: 20,
        consumptionMw: 5,
        reportedMaximumConsumptionMw: 5,
        headroomMw: 15,
        utilizationPercent: 25,
        fuseTriggered: false,
      },
      circuits: [
        {
          id: "0",
          capacityMw: 20,
          consumptionMw: 5,
          reportedMaximumConsumptionMw: 5,
          headroomMw: 15,
          utilizationPercent: 25,
          fuseTriggered: false,
          associatedCircuitCount: 1,
          battery: {
            chargePercent: 0,
            netFlowMw: 0,
            secondsToEmpty: 0,
            secondsToFull: 0,
          },
        },
      ],
    });
    expect(JSON.stringify(state)).not.toMatch(/PowerProduction|productionMw|999/);
  });

  it("normalizes the sanitized empty fixture as live no-circuits", async () => {
    const adapter = new FrmPowerAdapter({
      baseUrl: "http://frm:8080",
      fetcher: async () => jsonResponse(noCircuitsFixture),
      now: () => new Date("2026-08-18T18:00:00.000Z"),
    });
    await expect(adapter.getPower()).resolves.toEqual({
      topologyState: "no-circuits",
      observedAt: "2026-08-18T18:00:00.000Z",
      totals: {
        capacityMw: 0,
        consumptionMw: 0,
        reportedMaximumConsumptionMw: 0,
        headroomMw: 0,
        utilizationPercent: null,
        fuseTriggered: false,
      },
      circuits: [],
    });
  });

  it("sorts and aggregates multiple circuits with overload, fuse, and nullable battery times", async () => {
    const adapter = new FrmPowerAdapter({
      baseUrl: "http://frm:8080",
      fetcher: async () => jsonResponse([populatedCircuit, liveFixture[0]]),
      now: () => new Date("2026-08-18T18:00:00.000Z"),
    });
    const state = await adapter.getPower();
    expect(state.circuits.map((circuit) => circuit.id)).toEqual(["0", "10"]);
    expect(state.circuits[1]).toMatchObject({
      headroomMw: -2,
      utilizationPercent: 120,
      associatedCircuitCount: 2,
      battery: {
        chargePercent: 50,
        netFlowMw: -3,
        secondsToEmpty: 3723,
        secondsToFull: null,
      },
    });
    expect(state.totals).toEqual({
      capacityMw: 30,
      consumptionMw: 17,
      reportedMaximumConsumptionMw: 16,
      headroomMw: 13,
      utilizationPercent: 56.666666666666664,
      fuseTriggered: true,
    });
  });

  it("rejects malformed numeric and structural fields rather than guessing", async () => {
    for (const malformed of [
      [{ ...liveFixture[0], PowerCapacity: null }],
      [{ ...liveFixture[0], CircuitGroupID: -1 }],
      [{ ...liveFixture[0], BatteryPercent: 101 }],
      [{ ...liveFixture[0], AssociatedCircuits: ["private"] }],
      { not: "an-array" },
    ]) {
      const adapter = new FrmPowerAdapter({
        baseUrl: "http://frm:8080",
        fetcher: async () => jsonResponse(malformed),
      });
      await expect(adapter.getPower()).rejects.toMatchObject({
        code: "UPSTREAM_SCHEMA_INVALID",
      });
    }
  });

  it("inherits the bounded transport response cap", async () => {
    const adapter = new FrmPowerAdapter({
      baseUrl: "http://frm:8080",
      fetcher: async () =>
        new Response("[]", { headers: { "content-length": "5000" } }),
      maxResponseBytes: 100,
    });
    await expect(adapter.getPower()).rejects.toMatchObject({
      code: "UPSTREAM_RESPONSE_TOO_LARGE",
    });
  });
});
