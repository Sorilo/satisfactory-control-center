import { describe, expect, it } from "vitest";
import type { FrmProvider, OverviewSnapshot } from "@/domain/overview";
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
  it("preserves a valid empty world as live data", async () => {
    const provider: FrmProvider = { getOverview: async () => empty };
    const result = await getOverviewEnvelope("main", provider, () => new Date("2026-08-18T18:00:01.000Z"));
    expect(result.freshness.state).toBe("live");
    expect(result.data?.players.online).toBe(0);
    expect(result.data?.power).toBeNull();
    expect(result.unavailableSources).toEqual([]);
  });

  it("sanitizes upstream failures into unavailable data", async () => {
    const provider: FrmProvider = { getOverview: async () => { throw new Error("connect ECONNREFUSED http://private:8080 token=secret"); } };
    const result = await getOverviewEnvelope("main", provider, () => new Date("2026-08-18T18:00:01.000Z"));
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
    const first = getCachedOverviewEnvelope("cache-test", provider, now);
    const second = getCachedOverviewEnvelope("cache-test", provider, now);
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });
});
