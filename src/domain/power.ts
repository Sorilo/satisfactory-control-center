/**
 * Normalized power domain models, provider ports, and pure derivations.
 *
 * These types contain no upstream field names, private selectors, or
 * production/generation field. Adapters translate raw FRM and Prometheus data
 * into these models; services compose them through the ports below.
 */

export type PowerTopologyState = "available" | "no-circuits";

export interface PowerBattery {
  chargePercent: number;
  netFlowMw: number;
  secondsToEmpty: number | null;
  secondsToFull: number | null;
}

export interface PowerCircuit {
  /** Canonical decimal String(CircuitGroupID), scoped to server and session. */
  id: string;
  capacityMw: number;
  consumptionMw: number;
  reportedMaximumConsumptionMw: number;
  headroomMw: number;
  utilizationPercent: number | null;
  fuseTriggered: boolean;
  associatedCircuitCount: number;
  battery: PowerBattery | null;
}

export interface PowerTotals {
  capacityMw: number;
  consumptionMw: number;
  reportedMaximumConsumptionMw: number;
  headroomMw: number;
  utilizationPercent: number | null;
  fuseTriggered: boolean;
}

export interface PowerCurrentState {
  topologyState: PowerTopologyState;
  observedAt: string;
  totals: PowerTotals;
  circuits: PowerCircuit[];
}

export type PowerDetailCircuit =
  | { state: "connected"; id: string }
  | { state: "disconnected"; id: "-1" };

export interface PowerFuelInventory {
  name: string;
  amount: number;
  capacity: number;
}

export interface PowerGenerator {
  name: string;
  circuit: PowerDetailCircuit;
  fuelType: "biomass" | "coal" | "fuel" | "geothermal" | "nuclear" | "unknown";
  fuelInventory: PowerFuelInventory | null;
  productionCapacityMw: number;
  loadPercent: number;
  canStart: boolean;
  fuseTriggered: boolean;
}

export interface PowerMajorConsumer {
  name: string;
  circuit: PowerDetailCircuit;
  consumptionMw: number;
  maximumConsumptionMw: number;
  fuseTriggered: boolean;
}

export const POWER_HISTORY_RANGES = [
  "15m",
  "1h",
  "6h",
  "24h",
  "7d",
  "15d",
  "ytd",
  "1y",
  "lifetime",
  "custom",
] as const;
export type PowerHistoryRange = (typeof POWER_HISTORY_RANGES)[number];

export const POWER_HISTORY_RESOLUTIONS = [
  "auto",
  "15s",
  "30s",
  "1m",
  "2m",
  "5m",
  "10m",
  "15m",
  "1h",
] as const;
export type PowerHistoryResolution = (typeof POWER_HISTORY_RESOLUTIONS)[number];

export const POWER_EFFECTIVE_RESOLUTIONS = [
  "15s",
  "30s",
  "1m",
  "2m",
  "5m",
  "10m",
  "15m",
  "1h",
] as const;
export type PowerEffectiveResolution = (typeof POWER_EFFECTIVE_RESOLUTIONS)[number];

export const POWER_HISTORY_KEYS = [
  "capacityMw",
  "consumptionMw",
  "correctedMaximumConsumptionMw",
] as const;
export type PowerHistoryKey = (typeof POWER_HISTORY_KEYS)[number];

export interface PowerHistoryPoint {
  timestamp: string;
  value: number;
}

export interface PowerHistorySeries {
  key: PowerHistoryKey;
  circuitId: string;
  points: PowerHistoryPoint[];
}

export interface PowerHistoryCoverage {
  state: "complete" | "partial" | "empty" | "unsupported";
  reason?: "retention-unavailable" | "resolution-too-fine" | "custom-range-required" | "invalid-custom-range";
  requestedRange: PowerHistoryRange;
  effectiveResolution: PowerEffectiveResolution;
  retentionHorizonDays: 15;
  oldestSampleAt: string | null;
  newestSampleAt: string | null;
}

export interface PowerHistoryResult {
  observedAt: string | null;
  coverage: PowerHistoryCoverage;
  series: PowerHistorySeries[];
}

export interface PowerHistoryRequest {
  range: PowerHistoryRange;
  resolution: PowerHistoryResolution;
  startAt?: string;
  endAt?: string;
}

export interface PowerProvider {
  getPower(): Promise<PowerCurrentState>;
  getGenerators?(): Promise<PowerGenerator[]>;
  getMajorConsumers?(): Promise<PowerMajorConsumer[]>;
}

/** Named history port: callers cannot supply PromQL or private selectors. */
export interface PowerHistoryProvider {
  getHistory(request: PowerHistoryRequest): Promise<PowerHistoryResult>;
}

/** headroomMw = capacityMw - consumptionMw; negative values are valid. */
export function headroomMw(capacityMw: number, consumptionMw: number): number {
  return capacityMw - consumptionMw;
}

/** Utilization denominator is capacityMw; zero capacity yields null. */
export function utilizationPercent(
  consumptionMw: number,
  capacityMw: number
): number | null {
  if (capacityMw === 0) return null;
  return (consumptionMw / capacityMw) * 100;
}

export function canonicalCircuitId(circuitGroupId: number): string {
  return String(circuitGroupId);
}

export function sortPowerCircuits(circuits: PowerCircuit[]): PowerCircuit[] {
  return [...circuits].sort((a, b) => Number(a.id) - Number(b.id));
}

export function aggregatePowerTotals(circuits: PowerCircuit[]): PowerTotals {
  const capacityMw = circuits.reduce((sum, circuit) => sum + circuit.capacityMw, 0);
  const consumptionMw = circuits.reduce(
    (sum, circuit) => sum + circuit.consumptionMw,
    0
  );
  const reportedMaximumConsumptionMw = circuits.reduce(
    (sum, circuit) => sum + circuit.reportedMaximumConsumptionMw,
    0
  );
  return {
    capacityMw,
    consumptionMw,
    reportedMaximumConsumptionMw,
    headroomMw: headroomMw(capacityMw, consumptionMw),
    utilizationPercent: utilizationPercent(consumptionMw, capacityMw),
    fuseTriggered: circuits.some((circuit) => circuit.fuseTriggered),
  };
}

/** A successful empty FRM read is live/no-circuits, never unavailable. */
export function buildNoCircuitsState(observedAt: string): PowerCurrentState {
  return {
    topologyState: "no-circuits",
    observedAt,
    totals: {
      capacityMw: 0,
      consumptionMw: 0,
      reportedMaximumConsumptionMw: 0,
      headroomMw: 0,
      utilizationPercent: null,
      fuseTriggered: false,
    },
    circuits: [],
  };
}

/** Parse HH:MM:SS; malformed or absent durations remain unavailable. */
export function parseBatterySeconds(raw: string | null | undefined): number | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const parts = raw.split(":");
  if (parts.length !== 3) return null;
  const [hours, minutes, seconds] = parts;
  if (
    !/^\d+$/.test(hours ?? "") ||
    !/^\d+$/.test(minutes ?? "") ||
    !/^\d+$/.test(seconds ?? "")
  ) {
    return null;
  }
  if ((minutes ?? "").length > 2 || (seconds ?? "").length > 2) return null;
  const h = Number(hours);
  const m = Number(minutes);
  const s = Number(seconds);
  if (m > 59 || s > 59) return null;
  return h * 3600 + m * 60 + s;
}

const STEP_SECONDS: Record<PowerEffectiveResolution, number> = {
  "15s": 15,
  "30s": 30,
  "1m": 60,
  "2m": 2 * 60,
  "5m": 5 * 60,
  "10m": 10 * 60,
  "15m": 15 * 60,
  "1h": 60 * 60,
};

const AUTO_RESOLUTION: Record<PowerHistoryRange, PowerEffectiveResolution> = {
  "15m": "15s",
  "1h": "15s",
  "6h": "30s",
  "24h": "2m",
  "7d": "10m",
  "15d": "15m",
  ytd: "1h",
  "1y": "1h",
  lifetime: "1h",
  custom: "1m",
};

const FIXED_RANGE_SECONDS: Partial<Record<PowerHistoryRange, number>> = {
  "15m": 15 * 60,
  "1h": 60 * 60,
  "6h": 6 * 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "15d": 15 * 24 * 60 * 60,
};

export const POWER_RETENTION_HORIZON_DAYS = 15;
export const POWER_MAX_POINTS_PER_SERIES = 2_000;

/** Resolve Auto only; manual resolutions remain independent and explicit. */
export function effectiveResolution(
  range: PowerHistoryRange,
  requested: PowerHistoryResolution
): PowerEffectiveResolution {
  return requested === "auto" ? AUTO_RESOLUTION[range] : requested;
}

export type PowerHistoryPlanReason =
  | "retention-unavailable"
  | "resolution-too-fine"
  | "custom-range-required"
  | "invalid-custom-range";

export type PowerHistoryRequestPlan =
  | {
      supported: true;
      effectiveResolution: PowerEffectiveResolution;
      startAt: Date;
      endAt: Date;
      expectedPointsPerSeries: number;
    }
  | {
      supported: false;
      effectiveResolution: PowerEffectiveResolution;
      expectedPointsPerSeries: number | null;
      reason: PowerHistoryPlanReason;
    };

/**
 * Apply the current 15-day retention and 2,000-point-per-series bounds before
 * any upstream query is constructed. Long-range identifiers stay in the
 * contract, but are explicitly unsupported until longer retention exists.
 */
export function resolveHistoryRequest(
  request: PowerHistoryRequest,
  now = new Date()
): PowerHistoryRequestPlan {
  const effective = effectiveResolution(request.range, request.resolution);
  let startAt: Date;
  let endAt: Date;

  if (request.range === "custom") {
    if (!request.startAt || !request.endAt) {
      return { supported: false, effectiveResolution: effective, expectedPointsPerSeries: null, reason: "custom-range-required" };
    }
    startAt = new Date(request.startAt);
    endAt = new Date(request.endAt);
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || startAt >= endAt) {
      return { supported: false, effectiveResolution: effective, expectedPointsPerSeries: null, reason: "invalid-custom-range" };
    }
  } else {
    const seconds = FIXED_RANGE_SECONDS[request.range];
    if (seconds === undefined) {
      return { supported: false, effectiveResolution: effective, expectedPointsPerSeries: null, reason: "retention-unavailable" };
    }
    endAt = new Date(now);
    startAt = new Date(endAt.getTime() - seconds * 1000);
  }

  const nowMs = now.getTime();
  const retentionStartMs = nowMs - POWER_RETENTION_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  if (startAt.getTime() < retentionStartMs || endAt.getTime() > nowMs) {
    return { supported: false, effectiveResolution: effective, expectedPointsPerSeries: null, reason: "retention-unavailable" };
  }

  const durationSeconds = (endAt.getTime() - startAt.getTime()) / 1000;
  const expectedPointsPerSeries = Math.ceil(durationSeconds / STEP_SECONDS[effective]);
  if (expectedPointsPerSeries > POWER_MAX_POINTS_PER_SERIES) {
    return { supported: false, effectiveResolution: effective, expectedPointsPerSeries, reason: "resolution-too-fine" };
  }

  return { supported: true, effectiveResolution: effective, startAt, endAt, expectedPointsPerSeries };
}
