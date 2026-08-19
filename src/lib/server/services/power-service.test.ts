import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PowerCurrentState,
  PowerHistoryProvider,
  PowerHistoryRequest,
  PowerHistoryResult,
  PowerProvider,
} from "@/domain/power";
import {
  clearPowerServiceCachesForTests,
  getCachedPowerEnvelope,
  getPowerEnvelope,
} from "./power-service";

const REQUEST: PowerHistoryRequest = { range: "1h", resolution: "auto" };
const NOW = new Date("2026-08-18T18:00:00.000Z");

const currentState = (topologyState: "available" | "no-circuits" = "available"): PowerCurrentState => ({
  topologyState,
  observedAt: "2026-08-18T17:59:59.000Z",
  totals: topologyState === "no-circuits"
    ? {
        capacityMw: 0,
        consumptionMw: 0,
        reportedMaximumConsumptionMw: 0,
        headroomMw: 0,
        utilizationPercent: null,
        fuseTriggered: false,
      }
    : {
        capacityMw: 100,
        consumptionMw: 120,
        reportedMaximumConsumptionMw: 130,
        headroomMw: -20,
        utilizationPercent: 120,
        fuseTriggered: true,
      },
  circuits: topologyState === "no-circuits"
    ? []
    : [{
        id: "7",
        capacityMw: 100,
        consumptionMw: 120,
        reportedMaximumConsumptionMw: 130,
        headroomMw: -20,
        utilizationPercent: 120,
        fuseTriggered: true,
        associatedCircuitCount: 1,
        battery: null,
      }],
});

const historyResult = (
  state: "complete" | "partial" | "empty" = "complete"
): PowerHistoryResult => ({
  observedAt: state === "empty" ? null : "2026-08-18T18:00:00.000Z",
  coverage: {
    state,
    requestedRange: "1h",
    effectiveResolution: "1m",
    retentionHorizonDays: 15,
    oldestSampleAt: state === "empty" ? null : "2026-08-18T17:00:00.000Z",
    newestSampleAt: state === "empty" ? null : "2026-08-18T18:00:00.000Z",
  },
  series: state === "empty"
    ? []
    : [{
        key: "capacityMw",
        circuitId: "7",
        points: [{ timestamp: "2026-08-18T18:00:00.000Z", value: 100 }],
      }],
});

const currentProvider = (result: PowerCurrentState | Error): PowerProvider => ({
  getPower: vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  }),
});

const historyProvider = (result: PowerHistoryResult | Error): PowerHistoryProvider => ({
  getHistory: vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  }),
});

beforeEach(() => clearPowerServiceCachesForTests());

describe("power service", () => {
  it("composes live current and history without inventing optional details or production", async () => {
    const envelope = await getPowerEnvelope(
      "main",
      currentProvider(currentState()),
      historyProvider(historyResult()),
      REQUEST,
      () => NOW
    );

    expect(envelope).toMatchObject({
      apiVersion: "v1",
      generatedAt: NOW.toISOString(),
      serverId: "main",
      freshness: {
        current: { state: "live", observedAt: "2026-08-18T17:59:59.000Z" },
        history: { state: "live", observedAt: "2026-08-18T18:00:00.000Z" },
      },
      data: {
        current: {
          topologyState: "available",
          generators: { state: "unavailable", items: [] },
          majorConsumers: { state: "unavailable", items: [] },
        },
        history: {
          coverage: { state: "complete" },
          production: { state: "unavailable", reason: "source-not-collected" },
        },
      },
      unavailableSources: [],
    });
    expect(envelope.data.current?.circuits[0]?.id).toBe("7");
    expect(envelope.data.history?.series[0]?.circuitId).toBe("7");
    expect(JSON.stringify(envelope)).not.toMatch(/productionMw|PowerProduction|promql|session_name|urlLabel/);
  });

  it("keeps history live when current FRM fails", async () => {
    const envelope = await getPowerEnvelope(
      "main",
      currentProvider(new Error("private FRM failure")),
      historyProvider(historyResult()),
      REQUEST,
      () => NOW
    );
    expect(envelope.freshness.current).toEqual({ state: "unavailable", observedAt: null });
    expect(envelope.freshness.history.state).toBe("live");
    expect(envelope.data.current).toBeNull();
    expect(envelope.data.history).not.toBeNull();
    expect(envelope.unavailableSources).toEqual(["frm"]);
    expect(JSON.stringify(envelope)).not.toContain("private FRM failure");
  });

  it("keeps current live when Prometheus fails", async () => {
    const envelope = await getPowerEnvelope(
      "main",
      currentProvider(currentState()),
      historyProvider(new Error("private Prometheus failure")),
      REQUEST,
      () => NOW
    );
    expect(envelope.freshness.current.state).toBe("live");
    expect(envelope.freshness.history).toEqual({ state: "unavailable", observedAt: null });
    expect(envelope.data.current).not.toBeNull();
    expect(envelope.data.history).toBeNull();
    expect(envelope.unavailableSources).toEqual(["prometheus"]);
    expect(JSON.stringify(envelope)).not.toContain("private Prometheus failure");
  });

  it("reports both sources unavailable without collapsing their identities", async () => {
    const envelope = await getPowerEnvelope(
      "main",
      currentProvider(new Error("frm")),
      historyProvider(new Error("prom")),
      REQUEST,
      () => NOW
    );
    expect(envelope.data).toEqual({ current: null, history: null });
    expect(envelope.unavailableSources).toEqual(["frm", "prometheus"]);
  });

  it("treats a successful empty FRM read as live no-circuits", async () => {
    const envelope = await getPowerEnvelope(
      "main",
      currentProvider(currentState("no-circuits")),
      historyProvider(historyResult("empty")),
      REQUEST,
      () => NOW
    );
    expect(envelope.freshness.current.state).toBe("live");
    expect(envelope.data.current).toMatchObject({ topologyState: "no-circuits", circuits: [] });
    expect(envelope.freshness.history).toEqual({ state: "live", observedAt: null });
    expect(envelope.data.history?.coverage.state).toBe("empty");
    expect(envelope.unavailableSources).toEqual([]);
  });

  it.each(["complete", "partial", "empty"] as const)(
    "preserves %s retained-history coverage",
    async (coverageState) => {
      const envelope = await getPowerEnvelope(
        "main",
        currentProvider(currentState()),
        historyProvider(historyResult(coverageState)),
        REQUEST,
        () => NOW
      );
      expect(envelope.data.history?.coverage.state).toBe(coverageState);
      expect(envelope.freshness.history.state).toBe("live");
    }
  );

  it("marks history unavailable when the server has no Prometheus provider", async () => {
    const envelope = await getPowerEnvelope(
      "main",
      currentProvider(currentState()),
      null,
      REQUEST,
      () => NOW
    );
    expect(envelope.data.current).not.toBeNull();
    expect(envelope.data.history).toBeNull();
    expect(envelope.unavailableSources).toEqual(["prometheus"]);
  });

  it("coalesces reads with separate current/history TTLs", async () => {
    let nowMs = NOW.getTime();
    const current = currentProvider(currentState());
    const history = historyProvider(historyResult());
    const now = () => new Date(nowMs);

    await Promise.all([
      getCachedPowerEnvelope("cache", current, history, REQUEST, now),
      getCachedPowerEnvelope("cache", current, history, REQUEST, now),
    ]);
    expect(current.getPower).toHaveBeenCalledTimes(1);
    expect(history.getHistory).toHaveBeenCalledTimes(1);

    nowMs += 6_000;
    await getCachedPowerEnvelope("cache", current, history, REQUEST, now);
    expect(current.getPower).toHaveBeenCalledTimes(2);
    expect(history.getHistory).toHaveBeenCalledTimes(1);

    nowMs += 25_000;
    await getCachedPowerEnvelope("cache", current, history, REQUEST, now);
    expect(current.getPower).toHaveBeenCalledTimes(3);
    expect(history.getHistory).toHaveBeenCalledTimes(2);
  });

  it("evicts rejected source reads so recovery is not cached as unavailable", async () => {
    let attempts = 0;
    const recoveringCurrent: PowerProvider = {
      getPower: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary");
        return currentState();
      }),
    };
    const first = await getCachedPowerEnvelope(
      "recover",
      recoveringCurrent,
      historyProvider(historyResult()),
      REQUEST,
      () => NOW
    );
    const second = await getCachedPowerEnvelope(
      "recover",
      recoveringCurrent,
      historyProvider(historyResult()),
      REQUEST,
      () => NOW
    );
    expect(first.data.current).toBeNull();
    expect(second.data.current).not.toBeNull();
    expect(recoveringCurrent.getPower).toHaveBeenCalledTimes(2);
  });
});
