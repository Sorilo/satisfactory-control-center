import { describe, expect, it } from "vitest";
import type { FrmProvider, OverviewSnapshot } from "@/domain/overview";
import type { PowerProvider } from "@/domain/power";
import { getCachedOverviewEnvelope, getOverviewEnvelope } from "./overview-service";

const empty: OverviewSnapshot = {
  observedAt: "2026-08-18T18:00:00.000Z",
  server: { online: true },
  session: null,
  players: { online: 0, names: [] },
  power: null,
  factory: { machineCount: 0, producingCount: 0, averageEfficiencyPercent: null },
  progress: null
};

describe("overview service", () => {
  it("uses the shared PowerService current source for its power summary", async () => {
    const provider: FrmProvider = { getOverview: async () => empty };
    const powerProvider: PowerProvider = {
      getPower: async () => ({
        topologyState: "available",
        observedAt: "2026-08-18T18:00:00.000Z",
        totals: {
          capacityMw: 100,
          consumptionMw: 25,
          reportedMaximumConsumptionMw: 30,
          headroomMw: 75,
          utilizationPercent: 25,
          fuseTriggered: false,
        },
        circuits: [],
      }),
    };

    const result = await getOverviewEnvelope(
      "shared-power",
      provider,
      powerProvider,
      () => new Date("2026-08-18T18:00:01.000Z")
    );

    expect(result.data?.power).toEqual({
      capacityMw: 100,
      consumptionMw: 25,
      headroomMw: 75,
      utilizationPercent: 25,
      fuseTriggered: false,
    });
    expect(JSON.stringify(result.data?.power)).not.toMatch(/reportedMaximum|production/i);
  });

  it("preserves a valid empty world as live data", async () => {
    const provider: FrmProvider = { getOverview: async () => empty };
    const result = await getOverviewEnvelope("main", provider, null, () => new Date("2026-08-18T18:00:01.000Z"));
    expect(result.freshness.state).toBe("live");
    expect(result.data?.players.online).toBe(0);
    expect(result.data?.power).toBeNull();
    expect(result.unavailableSources).toEqual([]);
  });

  it("sanitizes upstream failures into unavailable data", async () => {
    const provider: FrmProvider = { getOverview: async () => { throw new Error("connect ECONNREFUSED http://private:8080 token=secret"); } };
    const result = await getOverviewEnvelope("main", provider, null, () => new Date("2026-08-18T18:00:01.000Z"));
    expect(result).toMatchObject({ serverId: "main", data: null, freshness: { state: "unavailable", observedAt: null }, unavailableSources: ["frm"] });
    expect(JSON.stringify(result)).not.toMatch(/private|8080|secret|ECONNREFUSED/);
  });

  it("coalesces concurrent reads for the same server", async () => {
    let calls = 0;
    const provider: FrmProvider = {
      getOverview: async () => {
        calls += 1;
        await Promise.resolve();
        return empty;
      }
    };
    const now = () => new Date("2026-08-18T18:00:01.000Z");
    const first = getCachedOverviewEnvelope("cache-test", provider, null, now);
    const second = getCachedOverviewEnvelope("cache-test", provider, null, now);
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });

  it("evicts the oldest overview entry at the one-hundred-server cache bound", async () => {
    let calls = 0;
    const provider: FrmProvider = {
      getOverview: async () => {
        calls += 1;
        return empty;
      },
    };
    const now = () => new Date("2026-08-18T18:00:02.000Z");

    for (let index = 0; index < 101; index += 1) {
      await getCachedOverviewEnvelope(`bounded-cache-${index}`, provider, null, now);
    }
    await getCachedOverviewEnvelope("bounded-cache-0", provider, null, now);

    expect(calls).toBe(102);
  });
});
