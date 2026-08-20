import { describe, expect, it } from "vitest";
import {
  aggregatePowerTotals,
  buildNoCircuitsState,
  canonicalCircuitId,
  effectiveResolution,
  resolveHistoryRequest,
  headroomMw,
  parseBatterySeconds,
  sortPowerCircuits,
  utilizationPercent,
  type PowerBattery,
  type PowerCircuit,
} from "./power";

function circuit(partial: {
  id: string;
  capacityMw: number;
  consumptionMw: number;
  reportedMaximumConsumptionMw?: number;
  fuseTriggered?: boolean;
  associatedCircuitCount?: number;
  battery?: PowerBattery | null;
}): PowerCircuit {
  const { capacityMw, consumptionMw } = partial;
  return {
    id: partial.id,
    capacityMw,
    consumptionMw,
    reportedMaximumConsumptionMw:
      partial.reportedMaximumConsumptionMw ?? consumptionMw,
    headroomMw: headroomMw(capacityMw, consumptionMw),
    utilizationPercent: utilizationPercent(consumptionMw, capacityMw),
    fuseTriggered: partial.fuseTriggered ?? false,
    associatedCircuitCount: partial.associatedCircuitCount ?? 0,
    battery: partial.battery ?? null,
  };
}

describe("power domain derivations", () => {
  it("computes headroom as capacity minus consumption, allowing negatives", () => {
    expect(headroomMw(20, 5)).toBe(15);
    expect(headroomMw(10, 10)).toBe(0);
    expect(headroomMw(5, 12)).toBe(-7);
  });

  it("computes utilization against capacity, null at zero, overload above 100", () => {
    expect(utilizationPercent(5, 20)).toBe(25);
    expect(utilizationPercent(5, 0)).toBeNull();
    expect(utilizationPercent(12, 10)).toBe(120);
  });

  it("canonicalizes circuit-group ids to decimal strings", () => {
    expect(canonicalCircuitId(0)).toBe("0");
    expect(canonicalCircuitId(42)).toBe("42");
    expect(canonicalCircuitId(12345)).toBe("12345");
  });

  it("sorts circuits deterministically by numeric decimal id", () => {
    const ordered = sortPowerCircuits([
      circuit({ id: "10", capacityMw: 30, consumptionMw: 5 }),
      circuit({ id: "2", capacityMw: 40, consumptionMw: 10 }),
      circuit({ id: "1", capacityMw: 30, consumptionMw: 5 }),
    ]);
    expect(ordered.map((c) => c.id)).toEqual(["1", "2", "10"]);
  });

  it("aggregates totals deterministically regardless of input order", () => {
    const a = circuit({
      id: "2",
      capacityMw: 40,
      consumptionMw: 10,
      reportedMaximumConsumptionMw: 8,
    });
    const b = circuit({
      id: "10",
      capacityMw: 30,
      consumptionMw: 5,
      reportedMaximumConsumptionMw: 4,
      fuseTriggered: true,
    });
    const c = circuit({
      id: "1",
      capacityMw: 30,
      consumptionMw: 5,
      reportedMaximumConsumptionMw: 4,
    });

    const forward = aggregatePowerTotals([a, b, c]);
    const shuffled = aggregatePowerTotals([c, a, b]);

    expect(forward).toEqual(shuffled);
    expect(forward).toEqual({
      capacityMw: 100,
      consumptionMw: 20,
      reportedMaximumConsumptionMw: 16,
      headroomMw: 80,
      utilizationPercent: 20,
      fuseTriggered: true,
    });
  });

  it("normalizes an empty circuit set into a valid no-circuits aggregate", () => {
    const state = buildNoCircuitsState("2026-08-18T18:00:00.000Z");
    expect(state.topologyState).toBe("no-circuits");
    expect(state.circuits).toEqual([]);
    expect(state.totals).toEqual({
      capacityMw: 0,
      consumptionMw: 0,
      reportedMaximumConsumptionMw: 0,
      headroomMw: 0,
      utilizationPercent: null,
      fuseTriggered: false,
    });
  });

  it("models battery state without claiming a capacity unit", () => {
    const battery: PowerBattery = {
      chargePercent: 75,
      netFlowMw: 100,
      secondsToEmpty: 3600,
      secondsToFull: null,
    };
    expect(Object.keys(battery).sort()).toEqual([
      "chargePercent",
      "netFlowMw",
      "secondsToEmpty",
      "secondsToFull",
    ]);
  });

  it("parses battery duration strings to nullable seconds", () => {
    expect(parseBatterySeconds("01:00:00")).toBe(3600);
    expect(parseBatterySeconds("02:30:45")).toBe(9045);
    expect(parseBatterySeconds("00:00:00")).toBe(0);
    expect(parseBatterySeconds("")).toBeNull();
    expect(parseBatterySeconds("garbage")).toBeNull();
    expect(parseBatterySeconds(null)).toBeNull();
    expect(parseBatterySeconds(undefined)).toBeNull();
  });

  it("emits no production or generation field in circuits or totals", () => {
    const c = circuit({ id: "1", capacityMw: 10, consumptionMw: 2 });
    expect(Object.keys(c).sort()).toEqual([
      "associatedCircuitCount",
      "battery",
      "capacityMw",
      "consumptionMw",
      "fuseTriggered",
      "headroomMw",
      "id",
      "reportedMaximumConsumptionMw",
      "utilizationPercent",
    ]);
    const totals = aggregatePowerTotals([c]);
    expect(Object.keys(totals).sort()).toEqual([
      "capacityMw",
      "consumptionMw",
      "fuseTriggered",
      "headroomMw",
      "reportedMaximumConsumptionMw",
      "utilizationPercent",
    ]);
    expect(Object.keys(totals)).not.toContain("productionMw");
  });

  it("uses source-fidelity Auto defaults while keeping manual resolutions independent", () => {
    expect(effectiveResolution("15m", "auto")).toBe("15s");
    expect(effectiveResolution("1h", "auto")).toBe("15s");
    expect(effectiveResolution("6h", "auto")).toBe("30s");
    expect(effectiveResolution("24h", "auto")).toBe("2m");
    expect(effectiveResolution("7d", "auto")).toBe("10m");
    expect(effectiveResolution("15d", "auto")).toBe("15m");
    expect(effectiveResolution("1h", "15m")).toBe("15m");
    expect(effectiveResolution("24h", "15s")).toBe("15s");
  });

  it("returns bounded request plans instead of fabricating long retention or huge responses", () => {
    const now = new Date("2026-08-18T18:00:00.000Z");
    expect(resolveHistoryRequest({ range: "24h", resolution: "2m" }, now)).toMatchObject({
      supported: true,
      effectiveResolution: "2m",
      expectedPointsPerSeries: 720,
    });
    expect(resolveHistoryRequest({ range: "24h", resolution: "15s" }, now)).toMatchObject({
      supported: false,
      reason: "resolution-too-fine",
    });
    expect(resolveHistoryRequest({ range: "1y", resolution: "auto" }, now)).toMatchObject({
      supported: false,
      reason: "retention-unavailable",
    });
    expect(resolveHistoryRequest({ range: "custom", resolution: "1m" }, now)).toMatchObject({
      supported: false,
      reason: "custom-range-required",
    });
    expect(resolveHistoryRequest({
      range: "custom",
      resolution: "15s",
      startAt: "2026-08-18T17:00:00.000Z",
      endAt: "2026-08-18T17:20:00.000Z",
    }, now)).toMatchObject({
      supported: true,
      effectiveResolution: "15s",
      expectedPointsPerSeries: 80,
    });
    expect(resolveHistoryRequest({
      range: "custom",
      resolution: "1m",
      startAt: "2026-08-01T17:00:00.000Z",
      endAt: "2026-08-18T17:20:00.000Z",
    }, now)).toMatchObject({
      supported: false,
      reason: "retention-unavailable",
    });
  });

  it("selects source-aware five-second Auto resolutions within the point bound", () => {
    const now = new Date("2026-08-18T18:00:00.000Z");
    const expected: Array<["15m" | "1h" | "6h" | "24h" | "7d" | "15d", string, number]> = [
      ["15m", "5s", 180],
      ["1h", "5s", 720],
      ["6h", "15s", 1_440],
      ["24h", "1m", 1_440],
      ["7d", "10m", 1_008],
      ["15d", "15m", 1_440],
    ];

    for (const [range, effective, expectedPointsPerSeries] of expected) {
      expect(resolveHistoryRequest({ range, resolution: "auto" }, now, 5)).toMatchObject({
        supported: true,
        effectiveResolution: effective,
        expectedPointsPerSeries,
      });
    }
  });

  it("never selects five-second Auto resolution when the source cadence is fifteen seconds", () => {
    const now = new Date("2026-08-18T18:00:00.000Z");
    expect(resolveHistoryRequest({ range: "15m", resolution: "auto" }, now, 15)).toMatchObject({
      supported: true,
      effectiveResolution: "15s",
    });
    expect(resolveHistoryRequest({ range: "6h", resolution: "auto" }, now, 15)).toMatchObject({
      supported: true,
      effectiveResolution: "30s",
    });
  });

  it("rejects manual resolutions finer than the validated source before point planning", () => {
    const now = new Date("2026-08-18T18:00:00.000Z");
    expect(resolveHistoryRequest({ range: "15m", resolution: "5s" }, now, 15)).toMatchObject({
      supported: false,
      reason: "source-fidelity-too-fine",
    });
  });

  it("keeps five-second source fidelity separate from the point-budget rejection", () => {
    const now = new Date("2026-08-18T18:00:00.000Z");
    expect(resolveHistoryRequest({ range: "6h", resolution: "5s" }, now, 5)).toMatchObject({
      supported: false,
      reason: "resolution-too-fine",
      expectedPointsPerSeries: 4_320,
    });
  });

  it("chooses custom Auto resolution from source fidelity and the point budget", () => {
    const now = new Date("2026-08-18T18:00:00.000Z");
    const base = {
      range: "custom" as const,
      resolution: "auto" as const,
    };
    expect(resolveHistoryRequest({
      ...base,
      startAt: "2026-08-18T17:00:00.000Z",
      endAt: "2026-08-18T17:05:00.000Z",
    }, now, 5)).toMatchObject({ supported: true, effectiveResolution: "5s", expectedPointsPerSeries: 60 });
    expect(resolveHistoryRequest({
      ...base,
      startAt: "2026-08-18T00:00:00.000Z",
      endAt: "2026-08-18T18:00:00.000Z",
    }, now, 5)).toMatchObject({ supported: true, effectiveResolution: "1m", expectedPointsPerSeries: 1_080 });
  });
});
