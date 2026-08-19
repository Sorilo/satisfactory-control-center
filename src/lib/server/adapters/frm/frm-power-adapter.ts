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
    const headers: Record<string, string> = {};
    if (this.token !== null) headers["X-FRM-Authorization"] = this.token;
    const raw = await requestBoundedJson({
      url: `${this.baseUrl}/getPower`,
      headers,
      fetcher: this.fetcher,
      maxResponseBytes: this.maxResponseBytes,
      timeoutMs: this.timeoutMs,
    });
    return normalizeFrmPowerPayload(raw, this.now().toISOString());
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
