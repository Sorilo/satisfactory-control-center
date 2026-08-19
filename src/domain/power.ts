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

export const POWER_HISTORY_RANGES = ["1h", "6h", "24h", "7d", "15d"] as const;
export type PowerHistoryRange = (typeof POWER_HISTORY_RANGES)[number];

export const POWER_HISTORY_RESOLUTIONS = [
  "auto",
  "1m",
  "5m",
  "15m",
  "1h",
] as const;
export type PowerHistoryResolution = (typeof POWER_HISTORY_RESOLUTIONS)[number];

export const POWER_EFFECTIVE_RESOLUTIONS = ["1m", "5m", "15m", "1h"] as const;
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
  state: "complete" | "partial" | "empty";
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

const STEP_RANK: Record<PowerEffectiveResolution, number> = {
  "1m": 0,
  "5m": 1,
  "15m": 2,
  "1h": 3,
};

const ALLOWED_STEPS: Record<
  PowerHistoryRange,
  readonly PowerEffectiveResolution[]
> = {
  "1h": ["1m", "5m", "15m", "1h"],
  "6h": ["1m", "5m", "15m", "1h"],
  "24h": ["1m", "5m", "15m", "1h"],
  "7d": ["15m", "1h"],
  "15d": ["15m", "1h"],
};

/** Resolve a requested minimum bucket to a bounded effective step. */
export function effectiveResolution(
  range: PowerHistoryRange,
  requested: PowerHistoryResolution
): PowerEffectiveResolution {
  const allowed = ALLOWED_STEPS[range];
  if (requested === "auto") return allowed[0] as PowerEffectiveResolution;
  const requestedRank = STEP_RANK[requested];
  return (
    allowed.find((step) => STEP_RANK[step] >= requestedRank) ??
    (allowed[allowed.length - 1] as PowerEffectiveResolution)
  );
}
