import { z } from "zod";
import {
  aggregatePowerTotals,
  buildNoCircuitsState,
  canonicalCircuitId,
  headroomMw,
  parseBatterySeconds,
  sortPowerCircuits,
  utilizationPercent,
  type PowerCircuit,
  type PowerCurrentState,
  type PowerDetailCircuit,
  type PowerGenerator,
  type PowerMajorConsumer,
  type PowerProvider,
} from "@/domain/power";
import {
  parseUpstream,
  requestBoundedJson,
  type Fetcher,
} from "@/lib/server/http/bounded-json";

const powerCircuitSchema = z.object({
  CircuitGroupID: z.number().int().nonnegative(),
  PowerProduction: z.number().finite(),
  PowerConsumed: z.number().finite().nonnegative(),
  PowerCapacity: z.number().finite().nonnegative(),
  PowerMaxConsumed: z.number().finite().nonnegative(),
  BatteryInput: z.number().finite(),
  BatteryOutput: z.number().finite(),
  BatteryDifferential: z.number().finite(),
  BatteryPercent: z.number().finite().min(0).max(100),
  BatteryCapacity: z.number().finite().nonnegative(),
  BatteryTimeEmpty: z.string(),
  BatteryTimeFull: z.string(),
  AssociatedCircuits: z.array(z.number().int().nonnegative()).max(10_000),
  FuseTriggered: z.boolean(),
});

type RawPowerCircuit = z.infer<typeof powerCircuitSchema>;

const locationSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
  rotation: z.number().finite(),
  pitch: z.number().finite(),
});

const detailPowerInfoSchema = z.object({
  CircuitGroupID: z.number().int().min(-1),
  CircuitID: z.number().int().min(-1),
  FuseTriggered: z.boolean(),
});

const fuelInventorySchema = z.object({
  Name: z.string().min(1).max(160),
  ClassName: z.string().min(1).max(256),
  Amount: z.number().finite().nonnegative(),
  MaxAmount: z.number().finite().nonnegative(),
});

const generatorSchema = z.object({
  ID: z.string().min(1).max(256),
  Name: z.string().min(1).max(160),
  ClassName: z.string().min(1).max(256),
  BaseProd: z.number().finite().nonnegative(),
  DynamicProdCapacity: z.number().finite().nonnegative(),
  DynamicProdDemandFactor: z.number().finite().nonnegative(),
  RegulatedDemandProd: z.number().finite().nonnegative(),
  IsFullSpeed: z.boolean(),
  CanStart: z.boolean(),
  LoadPercentage: z.number().finite().min(0).max(100),
  CurrentPotential: z.number().finite().nonnegative(),
  ProductionCapacity: z.number().finite().nonnegative(),
  DefaultProductionCapacity: z.number().finite().nonnegative(),
  PowerProductionPotential: z.number().finite().nonnegative(),
  FuelResource: z.string().max(160),
  FuelInventory: z.array(fuelInventorySchema).max(100),
  location: locationSchema,
  PowerInfo: detailPowerInfoSchema,
});

type RawGenerator = z.infer<typeof generatorSchema>;

const powerUsageSchema = z.object({
  ID: z.string().min(1).max(256),
  Name: z.string().min(1).max(160),
  ClassName: z.string().min(1).max(256),
  location: locationSchema,
  PowerInfo: detailPowerInfoSchema.extend({
    PowerConsumed: z.number().finite().nonnegative(),
    MaxPowerConsumed: z.number().finite().nonnegative(),
  }),
});

type RawPowerUsage = z.infer<typeof powerUsageSchema>;

export interface FrmPowerAdapterOptions {
  baseUrl: string;
  token?: string;
  fetcher?: Fetcher;
  maxResponseBytes?: number;
  timeoutMs?: number;
  now?: () => Date;
}

const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;

/** Fixed, read-only FRM /getPower adapter. */
export class FrmPowerAdapter implements PowerProvider {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly fetcher: Fetcher;
  private readonly maxResponseBytes: number;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: FrmPowerAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token ?? null;
    this.fetcher = options.fetcher ?? fetch;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  async getPower(): Promise<PowerCurrentState> {
    const raw = await this.request("getPower");
    return normalizeFrmPowerPayload(raw, this.now().toISOString());
  }

  async getGenerators(): Promise<PowerGenerator[]> {
    const raw = await this.request("getGenerators");
    const generators = parseUpstream(z.array(generatorSchema).max(1_000), raw);
    return generators
      .map((item) => ({ rawId: item.ID, value: normalizeGenerator(item) }))
      .sort((a, b) => compareGenerators(a.value, b.value) || compareText(a.rawId, b.rawId))
      .slice(0, 100)
      .map((item) => item.value);
  }

  async getMajorConsumers(): Promise<PowerMajorConsumer[]> {
    const raw = await this.request("getPowerUsage");
    const consumers = parseUpstream(z.array(powerUsageSchema).max(5_000), raw);
    return consumers
      .filter(isUsefulConsumer)
      .map((item) => ({ rawId: item.ID, value: normalizeConsumer(item) }))
      .sort((a, b) => compareConsumers(a.value, b.value) || compareText(a.rawId, b.rawId))
      .slice(0, 10)
      .map((item) => item.value);
  }

  private async request(path: "getPower" | "getGenerators" | "getPowerUsage"): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (this.token !== null) headers["X-FRM-Authorization"] = this.token;
    return requestBoundedJson({
      url: `${this.baseUrl}/${path}`,
      headers,
      fetcher: this.fetcher,
      maxResponseBytes: this.maxResponseBytes,
      timeoutMs: this.timeoutMs,
    });
  }
}

/** Shared normalization for HTTP and realtime/overview consumers. */
export function normalizeFrmPowerPayload(
  raw: unknown,
  observedAt: string
): PowerCurrentState {
  const circuits = parseUpstream(z.array(powerCircuitSchema).max(100), raw);
  if (circuits.length === 0) return buildNoCircuitsState(observedAt);

  const normalized = sortPowerCircuits(circuits.map(normalizeCircuit));
  return {
    topologyState: "available",
    observedAt,
    totals: aggregatePowerTotals(normalized),
    circuits: normalized,
  };
}

function normalizeCircuit(raw: RawPowerCircuit): PowerCircuit {
  const capacityMw = raw.PowerCapacity;
  const consumptionMw = raw.PowerConsumed;
  return {
    id: canonicalCircuitId(raw.CircuitGroupID),
    capacityMw,
    consumptionMw,
    reportedMaximumConsumptionMw: raw.PowerMaxConsumed,
    headroomMw: headroomMw(capacityMw, consumptionMw),
    utilizationPercent: utilizationPercent(consumptionMw, capacityMw),
    fuseTriggered: raw.FuseTriggered,
    associatedCircuitCount: raw.AssociatedCircuits.length,
    battery: {
      chargePercent: raw.BatteryPercent,
      netFlowMw: raw.BatteryDifferential,
      secondsToEmpty: parseBatterySeconds(raw.BatteryTimeEmpty),
      secondsToFull: parseBatterySeconds(raw.BatteryTimeFull),
    },
  };
}

function detailCircuit(circuitGroupId: number): PowerDetailCircuit {
  return circuitGroupId === -1
    ? { state: "disconnected", id: "-1" }
    : { state: "connected", id: canonicalCircuitId(circuitGroupId) };
}

function normalizeGenerator(raw: RawGenerator): PowerGenerator {
  const inventory = [...raw.FuelInventory].sort(
    (a, b) => b.Amount - a.Amount || compareText(a.Name, b.Name)
  )[0];
  return {
    name: raw.Name,
    circuit: detailCircuit(raw.PowerInfo.CircuitGroupID),
    fuelType: normalizeFuelType(raw),
    fuelInventory: inventory
      ? { name: inventory.Name, amount: inventory.Amount, capacity: inventory.MaxAmount }
      : null,
    productionCapacityMw: raw.ProductionCapacity,
    loadPercent: raw.LoadPercentage,
    canStart: raw.CanStart,
    fuseTriggered: raw.PowerInfo.FuseTriggered,
  };
}

function normalizeFuelType(raw: RawGenerator): PowerGenerator["fuelType"] {
  const evidence = [
    raw.ClassName,
    raw.Name,
    raw.FuelResource,
    ...raw.FuelInventory.flatMap((item) => [item.Name, item.ClassName]),
  ]
    .join(" ")
    .toLowerCase();
  if (evidence.includes("biomass")) return "biomass";
  if (evidence.includes("coal")) return "coal";
  if (evidence.includes("geothermal")) return "geothermal";
  if (evidence.includes("nuclear") || evidence.includes("uranium") || evidence.includes("plutonium")) {
    return "nuclear";
  }
  if (evidence.includes("fuel") || evidence.includes("oil")) return "fuel";
  return "unknown";
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareGenerators(a: PowerGenerator, b: PowerGenerator): number {
  if (a.circuit.state !== b.circuit.state) return a.circuit.state === "connected" ? -1 : 1;
  return (
    b.loadPercent - a.loadPercent ||
    compareText(a.name, b.name) ||
    Number(a.circuit.id) - Number(b.circuit.id)
  );
}

function isUsefulConsumer(raw: RawPowerUsage): boolean {
  return (
    raw.PowerInfo.PowerConsumed > 0 ||
    raw.PowerInfo.MaxPowerConsumed > 0 ||
    raw.PowerInfo.CircuitGroupID >= 0
  );
}

function normalizeConsumer(raw: RawPowerUsage): PowerMajorConsumer {
  return {
    name: raw.Name,
    circuit: detailCircuit(raw.PowerInfo.CircuitGroupID),
    consumptionMw: raw.PowerInfo.PowerConsumed,
    maximumConsumptionMw: raw.PowerInfo.MaxPowerConsumed,
    fuseTriggered: raw.PowerInfo.FuseTriggered,
  };
}

function compareConsumers(a: PowerMajorConsumer, b: PowerMajorConsumer): number {
  return (
    b.consumptionMw - a.consumptionMw ||
    b.maximumConsumptionMw - a.maximumConsumptionMw ||
    compareText(a.name, b.name) ||
    (a.circuit.state === b.circuit.state ? 0 : a.circuit.state === "connected" ? -1 : 1) ||
    Number(a.circuit.id) - Number(b.circuit.id)
  );
}
