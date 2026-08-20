import { describe, expect, it, vi } from "vitest";
import generatorsFixture from "../../../../../docs/fixtures/slice2-task0/frm-get-generators-live.json";
import liveFixture from "../../../../../docs/fixtures/slice2-task0/frm-get-power-live.json";
import noCircuitsFixture from "../../../../../docs/fixtures/slice2-task0/frm-get-power-no-circuits.json";
import powerUsageFixture from "../../../../../docs/fixtures/slice2-task0/frm-get-power-usage-live.json";
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
  BatteryCapacity: 500,
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
          battery: null,
        },
      ],
    });
    expect(JSON.stringify(state)).not.toMatch(/PowerProduction|productionMw|999/);
  });

  it("maps the all-zero no-capacity battery sentinel to null rather than a zeroed battery", async () => {
    // The live fixture carries BatteryCapacity 0 alongside BatteryInput/Output/
    // Differential/Percent 0 and "00:00:00" times. That is the upstream "no
    // battery installed" sentinel and must not surface as a fabricated zeroed
    // battery with 0% charge and a 0s empty/full estimate.
    const adapter = new FrmPowerAdapter({
      baseUrl: "http://frm:8080",
      fetcher: async () => jsonResponse(liveFixture),
    });
    const state = await adapter.getPower();
    expect(state.circuits).toHaveLength(1);
    expect(state.circuits[0]!.battery).toBeNull();
    expect(state.circuits[0]!.capacityMw).toBe(20);
    expect(state.circuits[0]!.consumptionMw).toBe(5);
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
    await expect(adapter.getGenerators()).rejects.toMatchObject({
      code: "UPSTREAM_RESPONSE_TOO_LARGE",
    });
    await expect(adapter.getMajorConsumers()).rejects.toMatchObject({
      code: "UPSTREAM_RESPONSE_TOO_LARGE",
    });
  });

  it("normalizes the sanitized generator fixture without raw identity, location, or production fields", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(new URL(String(input)).pathname).toBe("/getGenerators");
      expect(new Headers(init?.headers).get("X-FRM-Authorization")).toBe("read-token");
      return jsonResponse(generatorsFixture);
    });
    const adapter = new FrmPowerAdapter({
      baseUrl: "http://frm:8080",
      token: "read-token",
      fetcher,
    });

    const generators = await adapter.getGenerators();

    expect(generators).toEqual([
      {
        name: "Biomass Burner",
        circuit: { state: "connected", id: "0" },
        fuelType: "biomass",
        fuelInventory: { name: "Biomass", amount: 170, capacity: 200 },
        productionCapacityMw: 20,
        loadPercent: 25,
        canStart: true,
        fuseTriggered: false,
      },
      {
        name: "Biomass Burner",
        circuit: { state: "disconnected", id: "-1" },
        fuelType: "biomass",
        fuelInventory: null,
        productionCapacityMw: 20,
        loadPercent: 0,
        canStart: false,
        fuseTriggered: false,
      },
    ]);
    expect(JSON.stringify(generators)).not.toMatch(
      /fixture-|Build_|location|ClassName|PowerProduction|RegulatedDemandProd|DynamicProd/i
    );
  });

  it("sorts generators deterministically and caps the public list at one hundred", async () => {
    const records = Array.from({ length: 101 }, (_, index) => ({
      ...generatorsFixture[0],
      ID: `fixture-generator-${String(index).padStart(3, "0")}`,
      Name: `Generator ${String(100 - index).padStart(3, "0")}`,
    }));
    const adapter = new FrmPowerAdapter({
      baseUrl: "http://frm:8080",
      fetcher: async () => jsonResponse(records),
    });

    const generators = await adapter.getGenerators();

    expect(generators).toHaveLength(100);
    expect(generators[0]?.name).toBe("Generator 000");
    expect(generators[99]?.name).toBe("Generator 099");
  });

  it("ranks meaningful consumers first, retains connected zero draw, and omits disconnected zero-only structures", async () => {
    const adapter = new FrmPowerAdapter({
      baseUrl: "http://frm:8080",
      fetcher: async (input) => {
        expect(new URL(String(input)).pathname).toBe("/getPowerUsage");
        return jsonResponse(powerUsageFixture);
      },
    });

    const consumers = await adapter.getMajorConsumers();

    expect(consumers).toEqual([
      {
        name: "Miner Mk.1",
        circuit: { state: "connected", id: "0" },
        consumptionMw: 5,
        maximumConsumptionMw: 5,
        fuseTriggered: false,
      },
      {
        name: "Biomass Burner",
        circuit: { state: "connected", id: "0" },
        consumptionMw: 0,
        maximumConsumptionMw: 0,
        fuseTriggered: false,
      },
    ]);
    expect(JSON.stringify(consumers)).not.toMatch(/fixture-|Build_|location|ClassName/i);
  });

  it("uses environment-independent code-point ordering for equivalent consumer rankings", async () => {
    const records = [
      { ...powerUsageFixture[4], ID: "fixture-alpha", Name: "alpha" },
      { ...powerUsageFixture[4], ID: "fixture-zulu", Name: "Zulu" },
    ];
    const adapter = new FrmPowerAdapter({
      baseUrl: "http://frm:8080",
      fetcher: async () => jsonResponse(records),
    });

    const consumers = await adapter.getMajorConsumers();

    expect(consumers.map((item) => item.name)).toEqual(["Zulu", "alpha"]);
  });

  it("sorts consumer ties deterministically and caps the public ranking at ten", async () => {
    const records = Array.from({ length: 12 }, (_, index) => ({
      ...powerUsageFixture[4],
      ID: `fixture-tie-${String(index).padStart(2, "0")}`,
      Name: `Consumer ${String(11 - index).padStart(2, "0")}`,
    }));
    const adapter = new FrmPowerAdapter({
      baseUrl: "http://frm:8080",
      fetcher: async () => jsonResponse(records),
    });

    const consumers = await adapter.getMajorConsumers();

    expect(consumers).toHaveLength(10);
    expect(consumers.map((item) => item.name)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Consumer ${String(index).padStart(2, "0")}`)
    );
  });

  it("rejects malformed generator and consumer detail payloads instead of guessing", async () => {
    const malformedPayloads: Array<{
      method: "getGenerators" | "getMajorConsumers";
      payload: unknown;
    }> = [
      { method: "getGenerators", payload: [{ ...generatorsFixture[0], LoadPercentage: 101 }] },
      { method: "getGenerators", payload: [{ ...generatorsFixture[0], PowerInfo: { ...generatorsFixture[0]!.PowerInfo, CircuitGroupID: -2 } }] },
      { method: "getMajorConsumers", payload: [{ ...powerUsageFixture[4], PowerInfo: { ...powerUsageFixture[4]!.PowerInfo, PowerConsumed: -1 } }] },
      { method: "getMajorConsumers", payload: { not: "an-array" } },
    ];

    for (const { method, payload } of malformedPayloads) {
      const adapter = new FrmPowerAdapter({
        baseUrl: "http://frm:8080",
        fetcher: async () => jsonResponse(payload),
      });
      await expect(adapter[method]()).rejects.toMatchObject({
        code: "UPSTREAM_SCHEMA_INVALID",
      });
    }
  });
});
