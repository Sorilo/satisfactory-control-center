import { z } from "zod";
import type { FrmProvider, OverviewSnapshot } from "@/domain/overview";
import {
  normalizeFrmPowerPayload,
} from "@/lib/server/adapters/frm/frm-power-adapter";
import {
  parseUpstream,
  requestBoundedJson,
  UpstreamError,
  type Fetcher,
} from "@/lib/server/http/bounded-json";

export { UpstreamError };
export type { Fetcher };

/**
 * FRM (Ficsit Remote Monitoring) overview adapter.
 *
 * Transport and mapping boundary: it talks only to reviewed read endpoints
 * (`getSessionInfo`, `getPlayer`, `getPower`, `getFactory`,
 * `getSpaceElevator`), enforces a timeout via `AbortSignal`, bounds response
 * size via both the `content-length` header and the actual body bytes, and
 * validates every upstream payload with field-allowlisting Zod schemas before mapping into
 * normalized domain models. Private fields (player location/inventory and any
 * other undeclared data) are stripped during parse and never reach the domain.
 */

export interface FrmOverviewAdapterOptions {
  baseUrl: string;
  token?: string;
  fetcher?: Fetcher;
  maxResponseBytes?: number;
  timeoutMs?: number;
}

const sessionInfoSchema = z.object({
  SessionName: z.string(),
  IsPaused: z.boolean(),
  TotalPlayDuration: z.number().finite().nonnegative(),
});

const playerSchema = z.object({
  ID: z.string(),
  Name: z.string(),
  Online: z.boolean(),
});

const factoryMachineSchema = z.object({
  ID: z.string(),
  Name: z.string(),
  IsConfigured: z.boolean(),
  IsProducing: z.boolean(),
  Productivity: z.number().finite().min(0).max(100),
});
type FactoryMachine = z.infer<typeof factoryMachineSchema>;

const spaceElevatorSchema = z.object({
  ID: z.string(),
  Name: z.string(),
  FullyUpgraded: z.boolean(),
  UpgradeReady: z.boolean(),
  CurrentPhase: z.array(
    z.object({
      Name: z.string(),
      Amount: z.number().finite().nonnegative(),
      RemainingCost: z.number().finite().nonnegative(),
      TotalCost: z.number().finite().positive(),
    })
  ),
});
type SpaceElevator = z.infer<typeof spaceElevatorSchema>;

type FrmReadEndpoint =
  | "getSessionInfo"
  | "getPlayer"
  | "getPower"
  | "getFactory"
  | "getSpaceElevator";

const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;

export class FrmOverviewAdapter implements FrmProvider {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly fetcher: Fetcher;
  private readonly maxResponseBytes: number;
  private readonly timeoutMs: number;

  constructor(options: FrmOverviewAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token ?? null;
    this.fetcher = options.fetcher ?? fetch;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getOverview(): Promise<OverviewSnapshot> {
    const [sessionRaw, playersRaw, powerRaw, factoryRaw, spaceElevatorRaw] =
      await Promise.all([
        this.request("getSessionInfo"),
        this.request("getPlayer"),
        this.request("getPower"),
        this.request("getFactory"),
        this.request("getSpaceElevator"),
      ]);

    const sessionInfo = parseUpstream(sessionInfoSchema, sessionRaw);
    const players = parseUpstream(z.array(playerSchema), playersRaw);
    const factories = parseUpstream(z.array(factoryMachineSchema), factoryRaw);
    const elevators = parseUpstream(z.array(spaceElevatorSchema), spaceElevatorRaw);

    const onlinePlayers = players.filter((player) => player.Online);
    const observedAt = new Date().toISOString();
    const powerState = normalizeFrmPowerPayload(powerRaw, observedAt);

    return {
      observedAt,
      server: { online: true },
      session: {
        name: sessionInfo.SessionName,
        uptimeSeconds: sessionInfo.TotalPlayDuration,
        paused: sessionInfo.IsPaused,
      },
      players: {
        online: onlinePlayers.length,
        names: onlinePlayers.map((player) => player.Name),
      },
      power:
        powerState.topologyState === "no-circuits"
          ? null
          : {
              capacityMw: powerState.totals.capacityMw,
              consumptionMw: powerState.totals.consumptionMw,
              headroomMw: powerState.totals.headroomMw,
              utilizationPercent: powerState.totals.utilizationPercent,
              fuseTriggered: powerState.totals.fuseTriggered,
            },
      factory: this.normalizeFactory(factories),
      progress: this.normalizeProgress(elevators),
    };
  }

  private async request(path: FrmReadEndpoint): Promise<unknown> {
    const url = `${this.baseUrl}/${path}`;
    const headers: Record<string, string> = {};
    if (this.token !== null) {
      headers["X-FRM-Authorization"] = this.token;
    }
    return requestBoundedJson({
      url,
      headers,
      fetcher: this.fetcher,
      maxResponseBytes: this.maxResponseBytes,
      timeoutMs: this.timeoutMs,
    });
  }


  private normalizeFactory(
    factories: FactoryMachine[]
  ): OverviewSnapshot["factory"] {
    const machineCount = factories.length;
    const producingCount = factories.filter(
      (factory) => factory.IsProducing
    ).length;
    const averageEfficiencyPercent =
      machineCount === 0
        ? null
        : factories.reduce((sum, factory) => sum + factory.Productivity, 0) /
          machineCount;
    return { machineCount, producingCount, averageEfficiencyPercent };
  }

  private normalizeProgress(
    elevators: SpaceElevator[]
  ): OverviewSnapshot["progress"] {
    const items = elevators.flatMap((elevator) =>
      elevator.CurrentPhase.map((phase) => ({
        name: phase.Name,
        delivered: phase.Amount,
        required: phase.TotalCost,
      }))
    );
    return items.length === 0 ? null : { items };
  }
}
