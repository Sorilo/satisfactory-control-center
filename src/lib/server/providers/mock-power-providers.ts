import {
  effectiveResolution,
  type PowerCurrentState,
  type PowerHistoryProvider,
  type PowerHistoryRequest,
  type PowerHistoryResult,
  type PowerGenerator,
  type PowerMajorConsumer,
  type PowerProvider,
} from "@/domain/power";

const OBSERVED_AT = "2026-08-18T18:00:00.000Z";

export const MOCK_POWER_TOTALS = {
  capacityMw: 8_500,
  consumptionMw: 6_250,
  reportedMaximumConsumptionMw: 7_100,
  headroomMw: 2_250,
  utilizationPercent: (6_250 / 8_500) * 100,
  fuseTriggered: false,
};

const MOCK_CURRENT: PowerCurrentState = {
  topologyState: "available",
  observedAt: OBSERVED_AT,
  totals: MOCK_POWER_TOTALS,
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

const MOCK_GENERATORS: PowerGenerator[] = [
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
];

const MOCK_CONSUMERS: PowerMajorConsumer[] = [
  {
    name: "Miner Mk.1",
    circuit: { state: "connected", id: "0" },
    consumptionMw: 5,
    maximumConsumptionMw: 5,
    fuseTriggered: false,
  },
];

export class MockPowerProvider implements PowerProvider {
  async getPower(): Promise<PowerCurrentState> {
    return structuredClone(MOCK_CURRENT);
  }

  async getGenerators(): Promise<PowerGenerator[]> {
    return structuredClone(MOCK_GENERATORS);
  }

  async getMajorConsumers(): Promise<PowerMajorConsumer[]> {
    return structuredClone(MOCK_CONSUMERS);
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
