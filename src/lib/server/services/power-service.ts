import {
  powerEnvelopeSchema,
  type PowerEnvelope,
} from "@/contracts/power-contracts";
import type {
  PowerCurrentState,
  PowerHistoryProvider,
  PowerHistoryRequest,
  PowerHistoryResult,
  PowerProvider,
} from "@/domain/power";

const CURRENT_CACHE_TTL_MS = 5_000;
const HISTORY_CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 100;

type CacheEntry<T> = { expiresAtMs: number; value: Promise<T> };
const currentCache = new Map<string, CacheEntry<PowerCurrentState>>();
const historyCache = new Map<string, CacheEntry<PowerHistoryResult>>();

export function clearPowerServiceCachesForTests(): void {
  currentCache.clear();
  historyCache.clear();
}

export async function getPowerEnvelope(
  serverId: string,
  currentProvider: PowerProvider,
  historyProvider: PowerHistoryProvider | null,
  request: PowerHistoryRequest,
  now: () => Date = () => new Date()
): Promise<PowerEnvelope> {
  const currentRead = currentProvider.getPower();
  const historyRead = historyProvider
    ? historyProvider.getHistory(request)
    : Promise.reject(new SourceUnavailableError());
  return composePowerEnvelope(serverId, currentRead, historyRead, now);
}

export async function getCachedPowerEnvelope(
  serverId: string,
  currentProvider: PowerProvider,
  historyProvider: PowerHistoryProvider | null,
  request: PowerHistoryRequest,
  now: () => Date = () => new Date()
): Promise<PowerEnvelope> {
  const nowMs = now().getTime();
  const currentRead = readCached(
    currentCache,
    serverId,
    nowMs,
    CURRENT_CACHE_TTL_MS,
    () => currentProvider.getPower()
  );
  const historyRead = historyProvider
    ? readCached(
        historyCache,
        `${serverId}:${request.range}:${request.resolution}`,
        nowMs,
        HISTORY_CACHE_TTL_MS,
        () => historyProvider.getHistory(request)
      )
    : Promise.reject(new SourceUnavailableError());
  return composePowerEnvelope(serverId, currentRead, historyRead, now);
}

async function composePowerEnvelope(
  serverId: string,
  currentRead: Promise<PowerCurrentState>,
  historyRead: Promise<PowerHistoryResult>,
  now: () => Date
): Promise<PowerEnvelope> {
  const generatedAt = now().toISOString();
  const [currentResult, historyResult] = await Promise.allSettled([
    currentRead,
    historyRead,
  ]);
  const current = currentResult.status === "fulfilled" ? currentResult.value : null;
  const history = historyResult.status === "fulfilled" ? historyResult.value : null;
  const unavailableSources: Array<"frm" | "prometheus"> = [];
  if (current === null) unavailableSources.push("frm");
  if (history === null) unavailableSources.push("prometheus");

  return powerEnvelopeSchema.parse({
    apiVersion: "v1",
    generatedAt,
    serverId,
    freshness: {
      current: current
        ? { state: "live", observedAt: current.observedAt }
        : { state: "unavailable", observedAt: null },
      history: history
        ? { state: "live", observedAt: history.observedAt }
        : { state: "unavailable", observedAt: null },
    },
    data: {
      current: current
        ? {
            topologyState: current.topologyState,
            totals: current.totals,
            circuits: current.circuits,
            generators: { state: "unavailable", items: [] },
            majorConsumers: { state: "unavailable", items: [] },
          }
        : null,
      history: history
        ? {
            coverage: history.coverage,
            series: history.series,
            production: {
              state: "unavailable",
              reason: "source-not-collected",
            },
          }
        : null,
    },
    unavailableSources,
  });
}

function readCached<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  nowMs: number,
  ttlMs: number,
  load: () => Promise<T>
): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAtMs > nowMs) return cached.value;
  if (cached) cache.delete(key);
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }

  const value = load();
  cache.set(key, { expiresAtMs: nowMs + ttlMs, value });
  void value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

class SourceUnavailableError extends Error {}
