import type { FrmProvider, OverviewSnapshot } from "@/domain/overview";
import { MOCK_POWER_TOTALS } from "@/lib/server/providers/mock-power-providers";

/**
 * Deterministic mock overview provider.
 *
 * Returns a fixed, populated snapshot so that mock mode is reproducible in CI
 * and tests without any live upstream. The snapshot is domain-owned (never a
 * raw FRM payload) and intentionally reflects a healthy, populated world with
 * headroom, online players, and active progress so Slice 1 views exercise real
 * data paths rather than only empty states.
 */

const MOCK_OBSERVED_AT = "2026-08-18T12:00:00.000Z";

function buildSnapshot(): OverviewSnapshot {
  return {
    observedAt: MOCK_OBSERVED_AT,
    server: { online: true },
    session: {
      name: "Main World",
      uptimeSeconds: 3 * 24 * 60 * 60,
      paused: false,
    },
    players: {
      online: 3,
      names: ["Ada", "Pioneer-1", "Engineer-2"],
    },
    power: {
      capacityMw: MOCK_POWER_TOTALS.capacityMw,
      consumptionMw: MOCK_POWER_TOTALS.consumptionMw,
      headroomMw: MOCK_POWER_TOTALS.headroomMw,
      utilizationPercent: MOCK_POWER_TOTALS.utilizationPercent,
      fuseTriggered: MOCK_POWER_TOTALS.fuseTriggered,
    },
    factory: {
      machineCount: 64,
      producingCount: 58,
      averageEfficiencyPercent: 92.5,
    },
    progress: {
      items: [
        { name: "Smart Plating", delivered: 100, required: 200 },
        { name: "Modular Engine", delivered: 50, required: 500 },
      ],
    },
  };
}

export class MockOverviewProvider implements FrmProvider {
  async getOverview(): Promise<OverviewSnapshot> {
    return buildSnapshot();
  }
}
