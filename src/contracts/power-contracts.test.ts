import { describe, expect, it } from "vitest";
import {
  powerDetailsStreamSnapshotSchema,
  powerEffectiveResolutionSchema,
  powerEnvelopeSchema,
  powerHistoryRequestSchema,
  powerQuerySchema,
  powerRangeSchema,
  powerResolutionSchema,
  type PowerDetailsStreamSnapshot,
  type PowerEnvelope,
} from "./power-contracts";

function validEnvelope(): PowerEnvelope {
  return {
    apiVersion: "v1",
    generatedAt: "2026-08-18T18:00:00.000Z",
    serverId: "main",
    freshness: {
      current: { state: "live", observedAt: "2026-08-18T17:59:59.000Z" },
      history: { state: "live", observedAt: "2026-08-18T17:59:58.000Z" },
    },
    data: {
      current: {
        topologyState: "available",
        totals: {
          capacityMw: 20,
          consumptionMw: 5,
          reportedMaximumConsumptionMw: 7,
          headroomMw: 15,
          utilizationPercent: 25,
          fuseTriggered: false,
        },
        circuits: [
          {
            id: "0",
            capacityMw: 20,
            consumptionMw: 5,
            reportedMaximumConsumptionMw: 7,
            headroomMw: 15,
            utilizationPercent: 25,
            fuseTriggered: false,
            associatedCircuitCount: 1,
            battery: {
              chargePercent: 75,
              netFlowMw: 100,
              secondsToEmpty: 3600,
              secondsToFull: null,
            },
          },
        ],
        generators: {
          state: "live",
          items: [
            {
              name: "Coal Generator",
              circuit: { state: "connected", id: "0" },
              fuelType: "coal",
              fuelInventory: { name: "Coal", amount: 50, capacity: 100 },
              productionCapacityMw: 75,
              loadPercent: 50,
              canStart: true,
              fuseTriggered: false,
            },
          ],
        },
        majorConsumers: {
          state: "live",
          items: [
            {
              name: "Assembler Bank",
              circuit: { state: "connected", id: "0" },
              consumptionMw: 3,
              maximumConsumptionMw: 5,
              fuseTriggered: false,
            },
          ],
        },
      },
      history: {
        coverage: {
          state: "complete",
          requestedRange: "1h",
          effectiveResolution: "1m",
          retentionHorizonDays: 15,
          oldestSampleAt: "2026-08-18T17:00:00.000Z",
          newestSampleAt: "2026-08-18T17:59:58.000Z",
        },
        series: [
          {
            key: "capacityMw",
            circuitId: "0",
            points: [{ timestamp: "2026-08-18T17:59:58.000Z", value: 20 }],
          },
          {
            key: "consumptionMw",
            circuitId: "0",
            points: [{ timestamp: "2026-08-18T17:59:58.000Z", value: 5 }],
          },
          {
            key: "correctedMaximumConsumptionMw",
            circuitId: "0",
            points: [{ timestamp: "2026-08-18T17:59:58.000Z", value: 7 }],
          },
        ],
        production: { state: "unavailable", reason: "source-not-collected" },
      },
    },
    unavailableSources: [],
  };
}

function withCurrent(overrides: Partial<PowerEnvelope["data"]["current"]>): PowerEnvelope {
  const envelope = validEnvelope();
  envelope.data.current = { ...envelope.data.current!, ...overrides };
  return envelope;
}

describe("power v1 contracts", () => {
  it("accepts the five-second history resolution and source-fidelity coverage reason", () => {
    expect(powerResolutionSchema.parse("5s")).toBe("5s");
    expect(powerEffectiveResolutionSchema.parse("5s")).toBe("5s");

    const envelope = validEnvelope();
    envelope.data.history!.coverage = {
      ...envelope.data.history!.coverage,
      state: "unsupported",
      reason: "source-fidelity-too-fine",
      effectiveResolution: "5s",
    } as never;
    expect(() => powerEnvelopeSchema.parse(envelope)).not.toThrow();
  });

  it("accepts a fully populated strict envelope", () => {
    expect(() => powerEnvelopeSchema.parse(validEnvelope())).not.toThrow();
  });

  it("accepts explicit connected/disconnected detail circuits and bounded safe fuel inventory", () => {
    const envelope = validEnvelope();
    envelope.data.current!.generators = {
      state: "live",
      items: [
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
      ],
    } as never;
    envelope.data.current!.majorConsumers = {
      state: "live",
      items: [
        {
          name: "Miner Mk.1",
          circuit: { state: "connected", id: "0" },
          consumptionMw: 5,
          maximumConsumptionMw: 5,
          fuseTriggered: false,
        },
      ],
    } as never;

    expect(() => powerEnvelopeSchema.parse(envelope)).not.toThrow();
    expect(JSON.stringify(envelope)).not.toMatch(/location|ClassName|PowerProduction/i);
  });

  it("rejects contradictory normalized circuit states", () => {
    for (const circuit of [
      { state: "connected", id: "-1" },
      { state: "disconnected", id: "0" },
    ]) {
      const envelope = validEnvelope();
      envelope.data.current!.majorConsumers = {
        state: "live",
        items: [{
          name: "Invalid",
          circuit,
          consumptionMw: 1,
          maximumConsumptionMw: 1,
          fuseTriggered: false,
        }],
      } as never;
      expect(() => powerEnvelopeSchema.parse(envelope)).toThrow();
    }
  });

  it("accepts live no-circuits current state with zero totals and no circuits", () => {
    const envelope = validEnvelope();
    envelope.data.current = {
      topologyState: "no-circuits",
      totals: {
        capacityMw: 0,
        consumptionMw: 0,
        reportedMaximumConsumptionMw: 0,
        headroomMw: 0,
        utilizationPercent: null,
        fuseTriggered: false,
      },
      circuits: [],
      generators: { state: "unavailable", items: [] },
      majorConsumers: { state: "unavailable", items: [] },
    };
    expect(() => powerEnvelopeSchema.parse(envelope)).not.toThrow();
  });

  it("rejects a public productionMw field on totals and circuits", () => {
    const totalsEnvelope = withCurrent({
      totals: { ...validEnvelope().data.current!.totals, productionMw: 123 } as never,
    });
    expect(() => powerEnvelopeSchema.parse(totalsEnvelope)).toThrow();

    const circuitEnvelope = validEnvelope();
    circuitEnvelope.data.current!.circuits[0] = {
      ...circuitEnvelope.data.current!.circuits[0],
      productionMw: 123,
    } as never;
    expect(() => powerEnvelopeSchema.parse(circuitEnvelope)).toThrow();
  });

  it("keeps current and history fresh independently (not all-or-nothing)", () => {
    const frmOnly = validEnvelope();
    frmOnly.data.history = null;
    frmOnly.freshness.history = { state: "unavailable", observedAt: null };
    frmOnly.unavailableSources = ["prometheus"];
    expect(() => powerEnvelopeSchema.parse(frmOnly)).not.toThrow();

    const promOnly = validEnvelope();
    promOnly.data.current = null;
    promOnly.freshness.current = { state: "unavailable", observedAt: null };
    promOnly.unavailableSources = ["frm"];
    expect(() => powerEnvelopeSchema.parse(promOnly)).not.toThrow();
  });

  it("accepts complete, partial, and empty history coverage", () => {
    for (const state of ["complete", "partial", "empty"] as const) {
      const envelope = validEnvelope();
      envelope.data.history!.coverage.state = state;
      expect(() => powerEnvelopeSchema.parse(envelope)).not.toThrow();
    }
    const envelope = validEnvelope();
    (envelope.data.history!.coverage.state as string) = "unknown";
    expect(() => powerEnvelopeSchema.parse(envelope)).toThrow();
  });

  it("locks historical production to unavailable with a fixed reason", () => {
    const envelope = validEnvelope();
    envelope.data.history!.production = { state: "live", reason: "fabricated" } as never;
    expect(() => powerEnvelopeSchema.parse(envelope)).toThrow();

    const ok = validEnvelope();
    ok.data.history!.production = { state: "unavailable", reason: "source-not-collected" };
    expect(() => powerEnvelopeSchema.parse(ok)).not.toThrow();
  });

  it("accepts only frm and prometheus unavailable sources", () => {
    const both = validEnvelope();
    both.unavailableSources = ["frm", "prometheus"];
    expect(() => powerEnvelopeSchema.parse(both)).not.toThrow();

    const postgres = validEnvelope();
    postgres.unavailableSources = ["postgres"] as never;
    expect(() => powerEnvelopeSchema.parse(postgres)).toThrow();

    const unknown = validEnvelope();
    unknown.unavailableSources = ["gremlin"] as never;
    expect(() => powerEnvelopeSchema.parse(unknown)).toThrow();
  });

  it("rejects private and raw fields at every nested boundary", () => {
    const leaks = [
      { url: "http://private:8080/getPower" },
      { session_name: "satisfactory-save" },
      { promql: 'power_capacity{session="x"}' },
      { sql: "SELECT * FROM circuits" },
      { host: "prometheus.internal" },
      { token: "secret-token" },
      { datasourceUid: "abc123" },
      { PowerProduction: 0 },
      { CircuitGroupID: 0 },
    ];
    for (const leak of leaks) {
      const envelope = withCurrent({ ...leak } as never);
      expect(() => powerEnvelopeSchema.parse(envelope)).toThrow();
    }

    const seriesLeak = validEnvelope();
    seriesLeak.data.history!.series[0] = {
      ...seriesLeak.data.history!.series[0],
      metricName: "power_capacity",
    } as never;
    expect(() => powerEnvelopeSchema.parse(seriesLeak)).toThrow();
  });

  it("enforces the exact history series keys including correctedMaximumConsumptionMw", () => {
    const ok = validEnvelope();
    ok.data.history!.series = [
      {
        key: "correctedMaximumConsumptionMw",
        circuitId: "0",
        points: [{ timestamp: "2026-08-18T17:59:58.000Z", value: 7 }],
      },
    ];
    expect(() => powerEnvelopeSchema.parse(ok)).not.toThrow();

    const wrong = validEnvelope();
    wrong.data.history!.series[0] = {
      ...wrong.data.history!.series[0],
      key: "reportedMaximumConsumptionMw",
    } as never;
    expect(() => powerEnvelopeSchema.parse(wrong)).toThrow();

    const productionSeries = validEnvelope();
    productionSeries.data.history!.series[0] = {
      ...productionSeries.data.history!.series[0],
      key: "productionMw",
    } as never;
    expect(() => powerEnvelopeSchema.parse(productionSeries)).toThrow();
  });

  it("rejects non-finite numeric values", () => {
    const envelope = validEnvelope();
    envelope.data.current!.totals.capacityMw = Number.NaN;
    expect(() => powerEnvelopeSchema.parse(envelope)).toThrow();

    const inf = validEnvelope();
    inf.data.current!.totals.headroomMw = Number.POSITIVE_INFINITY;
    expect(() => powerEnvelopeSchema.parse(inf)).toThrow();

    const point = validEnvelope();
    point.data.history!.series[0]!.points[0]!.value = Number.NaN;
    expect(() => powerEnvelopeSchema.parse(point)).toThrow();
  });

  it("caps bounded arrays to the frozen limits", () => {
    const consumers = validEnvelope();
    consumers.data.current!.majorConsumers.items = Array.from(
      { length: 11 },
      (_, i) => ({
        name: `Consumer ${i}`,
        circuit: { state: "connected" as const, id: "0" },
        consumptionMw: 1,
        maximumConsumptionMw: 2,
        fuseTriggered: false,
      })
    );
    expect(() => powerEnvelopeSchema.parse(consumers)).toThrow();

    const series = validEnvelope();
    series.data.history!.series = Array.from({ length: 101 }, () => ({
      key: "capacityMw" as const,
      circuitId: "0",
      points: [{ timestamp: "2026-08-18T17:59:58.000Z", value: 1 }],
    }));
    expect(() => powerEnvelopeSchema.parse(series)).toThrow();

    const points = validEnvelope();
    points.data.history!.series[0]!.points = Array.from({ length: 2001 }, () => ({
      timestamp: "2026-08-18T17:59:58.000Z",
      value: 1,
    }));
    expect(() => powerEnvelopeSchema.parse(points)).toThrow();
  });

  it("allowlists the exact history range and resolution enums", () => {
    for (const range of ["15m", "1h", "6h", "24h", "7d", "15d", "ytd", "1y", "lifetime", "custom"]) {
      expect(powerRangeSchema.parse(range)).toBe(range);
    }
    expect(() => powerRangeSchema.parse("30d")).toThrow();

    for (const resolution of ["auto", "5s", "15s", "30s", "1m", "2m", "5m", "10m", "15m", "1h"]) {
      expect(powerResolutionSchema.parse(resolution)).toBe(resolution);
    }
    expect(() => powerResolutionSchema.parse("3m")).toThrow();

    for (const effective of ["5s", "15s", "30s", "1m", "2m", "5m", "10m", "15m", "1h"]) {
      expect(powerEffectiveResolutionSchema.parse(effective)).toBe(effective);
    }
  });

  it("defines strict request types with only allowlisted keys", () => {
    expect(() =>
      powerHistoryRequestSchema.parse({ range: "1h", resolution: "auto" })
    ).not.toThrow();
    expect(() =>
      powerHistoryRequestSchema.parse({ range: "1h", resolution: "auto", promql: "x" })
    ).toThrow();
    expect(() =>
      powerQuerySchema.parse({ serverId: "main", range: "24h", resolution: "auto" })
    ).not.toThrow();
    expect(() =>
      powerQuerySchema.parse({ serverId: "main", range: "24h", resolution: "auto", extra: "1" })
    ).toThrow();
  });
});

describe("power v1 details stream contract", () => {
  function validDetails(): PowerDetailsStreamSnapshot {
    return {
      observedAt: "2026-08-18T18:00:00.000Z",
      generators: {
        state: "live",
        items: [
          {
            name: "Coal Generator",
            circuit: { state: "connected", id: "0" },
            fuelType: "coal",
            fuelInventory: { name: "Coal", amount: 50, capacity: 100 },
            productionCapacityMw: 75,
            loadPercent: 50,
            canStart: true,
            fuseTriggered: false,
          },
        ],
      },
      majorConsumers: {
        state: "live",
        items: [
          {
            name: "Assembler Bank",
            circuit: { state: "connected", id: "0" },
            consumptionMw: 3,
            maximumConsumptionMw: 5,
            fuseTriggered: false,
          },
        ],
      },
    };
  }

  it("accepts a strict live details snapshot", () => {
    expect(() => powerDetailsStreamSnapshotSchema.parse(validDetails())).not.toThrow();
  });

  it("accepts independently unavailable detail groups", () => {
    const generatorsOnly = validDetails();
    generatorsOnly.generators = { state: "unavailable", items: [] };
    expect(() => powerDetailsStreamSnapshotSchema.parse(generatorsOnly)).not.toThrow();

    const both = validDetails();
    both.generators = { state: "unavailable", items: [] };
    both.majorConsumers = { state: "unavailable", items: [] };
    expect(() => powerDetailsStreamSnapshotSchema.parse(both)).not.toThrow();
  });

  it("rejects unknown top-level and nested keys", () => {
    const top = { ...validDetails(), serverId: "main" } as never;
    expect(() => powerDetailsStreamSnapshotSchema.parse(top)).toThrow();

    const nested = validDetails();
    nested.generators.items[0] = {
      ...nested.generators.items[0]!,
      ClassName: "Build_GeneratorCoal_C",
    } as never;
    expect(() => powerDetailsStreamSnapshotSchema.parse(nested)).toThrow();
  });

  it("caps generators at 100 and major consumers at 10", () => {
    const generators = validDetails();
    generators.generators.items = Array.from({ length: 101 }, (_, i) => ({
      name: `Generator ${i}`,
      circuit: { state: "connected" as const, id: "0" },
      fuelType: "coal" as const,
      fuelInventory: null,
      productionCapacityMw: 1,
      loadPercent: 0,
      canStart: true,
      fuseTriggered: false,
    }));
    expect(() => powerDetailsStreamSnapshotSchema.parse(generators)).toThrow();

    const consumers = validDetails();
    consumers.majorConsumers.items = Array.from({ length: 11 }, (_, i) => ({
      name: `Consumer ${i}`,
      circuit: { state: "connected" as const, id: "0" },
      consumptionMw: 1,
      maximumConsumptionMw: 1,
      fuseTriggered: false,
    }));
    expect(() => powerDetailsStreamSnapshotSchema.parse(consumers)).toThrow();
  });

  it("rejects raw and private detail fields", () => {
    const leaks = [
      { location: { x: 0, y: 0, z: 0 } },
      { PowerInfo: { CircuitGroupID: 0 } },
      { BaseProd: 0 },
      { DynamicProdCapacity: 0 },
      { RegulatedDemandProd: 0 },
      { FuelResource: "Coal" },
      { ProductionCapacity: 75 },
      { ID: "generator-1" },
    ];
    for (const leak of leaks) {
      const details = validDetails();
      details.generators.items[0] = {
        ...details.generators.items[0]!,
        ...leak,
      } as never;
      expect(() => powerDetailsStreamSnapshotSchema.parse(details)).toThrow();
    }
  });

  it("requires a non-empty observedAt", () => {
    const details = validDetails();
    details.observedAt = "";
    expect(() => powerDetailsStreamSnapshotSchema.parse(details)).toThrow();
  });

  it("rejects contradictory detail circuit states", () => {
    const details = validDetails();
    details.generators.items[0] = {
      ...details.generators.items[0]!,
      circuit: { state: "connected", id: "-1" },
    } as never;
    expect(() => powerDetailsStreamSnapshotSchema.parse(details)).toThrow();
  });
});
