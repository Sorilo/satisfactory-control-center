import {
  powerEnvelopeSchema,
  type PowerEnvelope,
} from "@/contracts/power-contracts";
import type {
  PowerCurrentState,
  PowerHistoryProvider,
  PowerHistoryRequest,
  PowerHistoryResult,
  PowerGenerator,
  PowerMajorConsumer,
  PowerProvider,
} from "@/domain/power";

const CURRENT_CACHE_TTL_MS = 5_000;
const HISTORY_CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 100;

type CacheEntry<T> = { expiresAtMs: number; value: Promise<T> };
const currentCache = new Map<string, CacheEntry<PowerCurrentState>>();
const generatorCache = new Map<string, CacheEntry<PowerGenerator[]>>();
const consumerCache = new Map<string, CacheEntry<PowerMajorConsumer[]>>();
const historyCache = new Map<string, CacheEntry<PowerHistoryResult>>();

export function clearPowerServiceCachesForTests(): void {
  currentCache.clear();
  generatorCache.clear();
  consumerCache.clear();
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
  const generatorRead = currentProvider.getGenerators
    ? currentProvider.getGenerators()
    : Promise.reject(new SourceUnavailableError());
  const consumerRead = currentProvider.getMajorConsumers
    ? currentProvider.getMajorConsumers()
    : Promise.reject(new SourceUnavailableError());
  const historyRead = historyProvider
    ? historyProvider.getHistory(request)
    : Promise.reject(new SourceUnavailableError());
  return composePowerEnvelope(
    serverId,
    currentRead,
    generatorRead,
    consumerRead,
    historyRead,
    now
  );
}

export function getCachedPowerCurrent(
  serverId: string,
  currentProvider: PowerProvider,
  nowMs = Date.now()
): Promise<PowerCurrentState> {
  return readCached(
    currentCache,
    serverId,
    nowMs,
    CURRENT_CACHE_TTL_MS,
    () => currentProvider.getPower()
  );
}

export function powerSummaryFromCurrent(current: PowerCurrentState) {
  return {
    capacityMw: current.totals.capacityMw,
    consumptionMw: current.totals.consumptionMw,
    headroomMw: current.totals.headroomMw,
    utilizationPercent: current.totals.utilizationPercent,
    fuseTriggered: current.totals.fuseTriggered,
  };
}

export async function getCachedPowerEnvelope(
  serverId: string,
  currentProvider: PowerProvider,
  historyProvider: PowerHistoryProvider | null,
  request: PowerHistoryRequest,
  now: () => Date = () => new Date()
): Promise<PowerEnvelope> {
  const nowMs = now().getTime();
  const currentRead = getCachedPowerCurrent(serverId, currentProvider, nowMs);
  const generatorRead = currentProvider.getGenerators
    ? readCached(
        generatorCache,
        serverId,
        nowMs,
        CURRENT_CACHE_TTL_MS,
        () => currentProvider.getGenerators!()
      )
    : Promise.reject(new SourceUnavailableError());
  const consumerRead = currentProvider.getMajorConsumers
    ? readCached(
        consumerCache,
        serverId,
        nowMs,
        CURRENT_CACHE_TTL_MS,
        () => currentProvider.getMajorConsumers!()
      )
    : Promise.reject(new SourceUnavailableError());
  const historyRead = historyProvider
    ? readCached(
        historyCache,
        `${serverId}:${request.range}:${request.resolution}`,
        nowMs,
        HISTORY_CACHE_TTL_MS,
        () => historyProvider.getHistory(request)
      )
    : Promise.reject(new SourceUnavailableError());
  return composePowerEnvelope(
    serverId,
    currentRead,
    generatorRead,
    consumerRead,
    historyRead,
    now
  );
}

async function composePowerEnvelope(
  serverId: string,
  currentRead: Promise<PowerCurrentState>,
  generatorRead: Promise<PowerGenerator[]>,
  consumerRead: Promise<PowerMajorConsumer[]>,
  historyRead: Promise<PowerHistoryResult>,
  now: () => Date
): Promise<PowerEnvelope> {
  const generatedAt = now().toISOString();
  const [currentResult, generatorResult, consumerResult, historyResult] =
    await Promise.allSettled([
      currentRead,
      generatorRead,
      consumerRead,
      historyRead,
    ]);
  const current = currentResult.status === "fulfilled" ? currentResult.value : null;
  const generators = generatorResult.status === "fulfilled" ? generatorResult.value : null;
  const majorConsumers = consumerResult.status === "fulfilled" ? consumerResult.value : null;
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
            generators: generators
              ? { state: "live", items: generators }
              : { state: "unavailable", items: [] },
            majorConsumers: majorConsumers
              ? { state: "live", items: majorConsumers }
              : { state: "unavailable", items: [] },
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
