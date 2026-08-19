import {
  effectiveResolution,
  type PowerCurrentState,
  type PowerHistoryProvider,
  type PowerHistoryRequest,
  type PowerHistoryResult,
  type PowerProvider,
} from "@/domain/power";

const OBSERVED_AT = "2026-08-18T18:00:00.000Z";

const MOCK_CURRENT: PowerCurrentState = {
  topologyState: "available",
  observedAt: OBSERVED_AT,
  totals: {
    capacityMw: 8_500,
    consumptionMw: 6_250,
    reportedMaximumConsumptionMw: 7_100,
    headroomMw: 2_250,
    utilizationPercent: (6_250 / 8_500) * 100,
    fuseTriggered: false,
  },
  circuits: [
    {
      id: "0",
      capacityMw: 8_500,
      consumptionMw: 6_250,
      reportedMaximumConsumptionMw: 7_100,
      headroomMw: 2_250,
      utilizationPercent: (6_250 / 8_500) * 100,
      fuseTriggered: false,
      associatedCircuitCount: 1,
      battery: {
        chargePercent: 68,
        netFlowMw: 150,
        secondsToEmpty: null,
        secondsToFull: 7_200,
      },
    },
  ],
};

export class MockPowerProvider implements PowerProvider {
  async getPower(): Promise<PowerCurrentState> {
    return structuredClone(MOCK_CURRENT);
  }
}

export class MockPowerHistoryProvider implements PowerHistoryProvider {
  async getHistory(request: PowerHistoryRequest): Promise<PowerHistoryResult> {
    const points = [
      { timestamp: "2026-08-18T17:00:00.000Z", value: 8_200 },
      { timestamp: OBSERVED_AT, value: 8_500 },
    ];
    return {
      observedAt: OBSERVED_AT,
      coverage: {
        state: "complete",
        requestedRange: request.range,
        effectiveResolution: effectiveResolution(request.range, request.resolution),
        retentionHorizonDays: 15,
        oldestSampleAt: points[0]?.timestamp ?? null,
        newestSampleAt: points[points.length - 1]?.timestamp ?? null,
      },
      series: [
        { key: "capacityMw", circuitId: "0", points },
        {
          key: "consumptionMw",
          circuitId: "0",
          points: points.map((point, index) => ({
            timestamp: point.timestamp,
            value: index === 0 ? 6_000 : 6_250,
          })),
        },
        {
          key: "correctedMaximumConsumptionMw",
          circuitId: "0",
          points: points.map((point, index) => ({
            timestamp: point.timestamp,
            value: index === 0 ? 6_900 : 7_100,
          })),
        },
      ],
    };
  }
}
