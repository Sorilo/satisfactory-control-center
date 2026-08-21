import { randomUUID } from "node:crypto";
import type { ProductionEnvelope, ProductionQuery } from "@/contracts/production-contracts";
import { productionEnvelopeSchema } from "@/contracts/production-contracts";
import type { ProductionProvider } from "@/domain/production";
import { UpstreamError, type UpstreamErrorCode, type RetryResult } from "@/lib/server/http/bounded-json";
import {
  createStructuredLogger,
  type StructuredFailureCategory,
  type StructuredLogger,
} from "@/lib/server/observability/logger";

export type Clock = () => string;

type CacheEntry<T> = { expiresAtMs: number; value: Promise<T> };

const defaultClock: Clock = () => new Date().toISOString();
const defaultProductionLogger = createStructuredLogger();
const PRODUCTION_CACHE_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 100;
const productionCache = new Map<string, CacheEntry<ProductionEnvelope>>();

export interface ProductionDiagnostics {
  requestId?: string;
  route?: string;
  logger?: StructuredLogger;
}

export function clearProductionServiceCachesForTests(): void {
  productionCache.clear();
}

export function getCachedProductionEnvelope(
  serverId: string,
  provider: ProductionProvider,
  query: ProductionQuery,
  nowMs = Date.now(),
  diagnostics?: ProductionDiagnostics
): Promise<ProductionEnvelope> {
  const key = JSON.stringify({ serverId, search: query.search ?? null, itemKey: query.itemKey ?? null, limit: query.limit ?? null });
  const cached = productionCache.get(key);
  if (cached && cached.expiresAtMs > nowMs) return cached.value;
  if (cached) productionCache.delete(key);
  if (productionCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = productionCache.keys().next().value;
    if (oldestKey !== undefined) productionCache.delete(oldestKey);
  }

  const value = getProductionEnvelope(serverId, provider, query, defaultClock, diagnostics);
  productionCache.set(key, { expiresAtMs: nowMs + PRODUCTION_CACHE_TTL_MS, value });
  void value.catch(() => {
    if (productionCache.get(key)?.value === value) productionCache.delete(key);
  });
  return value;
}

function failureCategoryFor(code: UpstreamErrorCode | undefined): StructuredFailureCategory {
  if (code === "UPSTREAM_SCHEMA_INVALID") return "schema";
  if (code === "UPSTREAM_TIMEOUT") return "timeout";
  if (code === "UPSTREAM_CANCELLED") return "cancelled";
  return "transport";
}

function retryResultFor(error: UpstreamError | undefined): RetryResult {
  return error?.retryResult ?? "unknown";
}

function logProductionFailure(
  serverId: string,
  error: unknown,
  diagnostics: ProductionDiagnostics | undefined
): void {
  const upstreamError = error instanceof UpstreamError ? error : undefined;
  const logger = diagnostics?.logger ?? defaultProductionLogger;
  logger.error({
    message: "production upstream failure",
    requestId: diagnostics?.requestId ?? randomUUID(),
    route: diagnostics?.route ?? "production-service",
    serverId,
    source: "frm",
    adapter: "frm-production",
    code: upstreamError?.code ?? "PRODUCTION_UPSTREAM_FAILURE",
    failureCategory: failureCategoryFor(upstreamError?.code),
    retryResult: retryResultFor(upstreamError),
    ...(upstreamError?.attempts ? { attempts: upstreamError.attempts } : {}),
    ...(upstreamError?.schemaPath ? { schemaPath: upstreamError.schemaPath } : {}),
    state: "unavailable",
  });
}

export async function getProductionEnvelope(
  serverId: string,
  provider: ProductionProvider,
  query: ProductionQuery,
  clock: Clock = defaultClock,
  diagnostics?: ProductionDiagnostics
): Promise<ProductionEnvelope> {
  const generatedAt = clock();
  try {
    const snapshot = await provider.getProduction();
    const search = query.search?.toLocaleLowerCase("en-US");
    const filtered = snapshot.items.filter((item) => {
      const matchesKey = query.itemKey === undefined || item.itemKey === query.itemKey;
      const matchesSearch = search === undefined
        || item.itemKey.includes(search)
        || item.name.toLocaleLowerCase("en-US").includes(search);
      return matchesKey && matchesSearch;
    });
    const items = filtered.slice(0, query.limit ?? 100);
    return productionEnvelopeSchema.parse({
      apiVersion: "v1",
      generatedAt,
      serverId,
      freshness: { state: "live", observedAt: snapshot.observedAt },
      data: {
        items,
        total: filtered.length,
        history: { state: "unsupported", reason: "production-history-not-observed" },
      },
      unavailableSources: [],
    });
  } catch (error) {
    logProductionFailure(serverId, error, diagnostics);
    return productionEnvelopeSchema.parse({
      apiVersion: "v1",
      generatedAt,
      serverId,
      freshness: { state: "unavailable", observedAt: null },
      data: null,
      unavailableSources: ["frm"],
    });
  }
}
