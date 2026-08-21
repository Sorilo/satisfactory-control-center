import type { ProductionEnvelope, ProductionQuery } from "@/contracts/production-contracts";
import { productionEnvelopeSchema } from "@/contracts/production-contracts";
import type { ProductionProvider } from "@/domain/production";

export type Clock = () => string;

type CacheEntry<T> = { expiresAtMs: number; value: Promise<T> };

const defaultClock: Clock = () => new Date().toISOString();
const PRODUCTION_CACHE_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 100;
const productionCache = new Map<string, CacheEntry<ProductionEnvelope>>();

export function clearProductionServiceCachesForTests(): void {
  productionCache.clear();
}

export function getCachedProductionEnvelope(
  serverId: string,
  provider: ProductionProvider,
  query: ProductionQuery,
  nowMs = Date.now()
): Promise<ProductionEnvelope> {
  const key = JSON.stringify({ serverId, search: query.search ?? null, itemKey: query.itemKey ?? null, limit: query.limit ?? null });
  const cached = productionCache.get(key);
  if (cached && cached.expiresAtMs > nowMs) return cached.value;
  if (cached) productionCache.delete(key);
  if (productionCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = productionCache.keys().next().value;
    if (oldestKey !== undefined) productionCache.delete(oldestKey);
  }

  const value = getProductionEnvelope(serverId, provider, query);
  productionCache.set(key, { expiresAtMs: nowMs + PRODUCTION_CACHE_TTL_MS, value });
  void value.catch(() => {
    if (productionCache.get(key)?.value === value) productionCache.delete(key);
  });
  return value;
}

export async function getProductionEnvelope(
  serverId: string,
  provider: ProductionProvider,
  query: ProductionQuery,
  clock: Clock = defaultClock
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
  } catch {
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
