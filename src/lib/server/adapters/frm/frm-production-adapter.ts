import { z } from "zod";
import type { ProductionProvider, ProductionSnapshot, ProductionRecord, ProductionForm } from "@/domain/production";
import { normalizeProductionItems } from "@/domain/production";
import { parseUpstream, requestBoundedJson, type Fetcher } from "@/lib/server/http/bounded-json";
import { withBoundedRetry } from "@/lib/server/reliability/upstream-policy";

export interface FrmProductionAdapterOptions {
  baseUrl: string;
  token?: string;
  fetcher?: Fetcher;
  maxResponseBytes?: number;
  timeoutMs?: number;
}

const rawProductionSchema = z.object({
  Name: z.string().min(1),
  ClassName: z.string().min(1),
  ProdPercent: z.number().finite(),
  ConsPercent: z.number().finite(),
  CurrentProd: z.number().finite(),
  MaxProd: z.number().finite(),
  CurrentConsumed: z.number().finite(),
  MaxConsumed: z.number().finite(),
  Type: z.enum(["Solid", "Liquid", "Gas", "Unknown"]),
}).strict();

const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;

export class FrmProductionAdapter implements ProductionProvider {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly fetcher: Fetcher;
  private readonly maxResponseBytes: number;
  private readonly timeoutMs: number;

  constructor(options: FrmProductionAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token ?? null;
    this.fetcher = options.fetcher ?? fetch;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getProduction(): Promise<ProductionSnapshot> {
    const raw = await withBoundedRetry(() => requestBoundedJson({
      url: `${this.baseUrl}/getProdStats`,
      headers: this.token === null ? {} : { "X-FRM-Authorization": this.token },
      fetcher: this.fetcher,
      maxResponseBytes: this.maxResponseBytes,
      timeoutMs: this.timeoutMs,
    }));
    const records = parseUpstream(z.array(rawProductionSchema).max(100), raw);
    const normalized: ProductionRecord[] = records.map((record) => ({
      name: record.Name,
      form: record.Type as ProductionForm,
      productionPerMinute: record.CurrentProd,
      consumptionPerMinute: record.CurrentConsumed,
      maxProductionPerMinute: record.MaxProd,
      maxConsumptionPerMinute: record.MaxConsumed,
      productionEfficiencyPercent: record.ProdPercent,
      consumptionEfficiencyPercent: record.ConsPercent,
    }));
    return { observedAt: new Date().toISOString(), items: normalizeProductionItems(normalized) };
  }
}
