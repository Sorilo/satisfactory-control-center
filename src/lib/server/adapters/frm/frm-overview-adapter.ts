import { z } from "zod";
import type { FrmProvider, OverviewSnapshot } from "@/domain/overview";

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

export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface FrmOverviewAdapterOptions {
  baseUrl: string;
  token?: string;
  fetcher?: Fetcher;
  maxResponseBytes?: number;
  timeoutMs?: number;
}

/** Typed, public-safe upstream failure code. */
export class UpstreamError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "UpstreamError";
    this.code = code;
  }
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

const powerCircuitSchema = z.object({
  CircuitGroupID: z.number().int().nonnegative(),
  PowerProduction: z.number().finite().nonnegative(),
  PowerConsumed: z.number().finite().nonnegative(),
  PowerCapacity: z.number().finite().nonnegative(),
  FuseTriggered: z.boolean(),
});
type PowerCircuit = z.infer<typeof powerCircuitSchema>;

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

    const sessionInfo = this.parse(sessionInfoSchema, sessionRaw);
    const players = this.parse(z.array(playerSchema), playersRaw);
    const circuits = this.parse(z.array(powerCircuitSchema), powerRaw);
    const factories = this.parse(z.array(factoryMachineSchema), factoryRaw);
    const elevators = this.parse(z.array(spaceElevatorSchema), spaceElevatorRaw);

    const onlinePlayers = players.filter((player) => player.Online);

    return {
      observedAt: new Date().toISOString(),
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
      power: this.normalizePower(circuits),
      factory: this.normalizeFactory(factories),
      progress: this.normalizeProgress(elevators),
    };
  }

  private async request(path: FrmReadEndpoint): Promise<unknown> {
    const url = `${this.baseUrl}/${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (this.token !== null) {
        headers["X-FRM-Authorization"] = this.token;
      }

      const response = await this.fetcher(url, {
        headers,
        redirect: "error",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new UpstreamError("UPSTREAM_UNAVAILABLE");
      }

      this.assertWithinSizeBound(response);

      const buffer = await this.readBodyWithinLimit(response);
      const text = new TextDecoder().decode(buffer);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new UpstreamError("UPSTREAM_SCHEMA_INVALID");
      }
    } catch (error) {
      if (error instanceof UpstreamError) {
        throw error;
      }
      throw new UpstreamError("UPSTREAM_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }
  }

  private assertWithinSizeBound(response: Response): void {
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
      const parsed = Number(contentLength);
      if (Number.isFinite(parsed) && parsed > this.maxResponseBytes) {
        throw new UpstreamError("UPSTREAM_RESPONSE_TOO_LARGE");
      }
    }
  }

  private async readBodyWithinLimit(response: Response): Promise<Uint8Array> {
    if (response.body === null) return new Uint8Array();

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > this.maxResponseBytes) {
        await reader.cancel();
        throw new UpstreamError("UPSTREAM_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }

    const buffer = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return buffer;
  }

  private parse<T>(schema: z.ZodType<T>, raw: unknown): T {
    const result = schema.safeParse(raw);
    if (!result.success) {
      throw new UpstreamError("UPSTREAM_SCHEMA_INVALID");
    }
    return result.data;
  }

  private normalizePower(circuits: PowerCircuit[]): OverviewSnapshot["power"] {
    if (circuits.length === 0) {
      return null;
    }
    const productionMw = circuits.reduce(
      (sum, circuit) => sum + circuit.PowerProduction,
      0
    );
    const consumptionMw = circuits.reduce(
      (sum, circuit) => sum + circuit.PowerConsumed,
      0
    );
    const capacityMw = circuits.reduce(
      (sum, circuit) => sum + circuit.PowerCapacity,
      0
    );
    return {
      productionMw,
      consumptionMw,
      headroomMw: capacityMw - consumptionMw,
      fuseTriggered: circuits.some((circuit) => circuit.FuseTriggered),
    };
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
