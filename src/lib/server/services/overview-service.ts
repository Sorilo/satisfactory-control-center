import type { OverviewEnvelope } from "@/contracts/public-contracts";
import type { OverviewSnapshot, FrmProvider } from "@/domain/overview";
import type { PowerCurrentState, PowerProvider } from "@/domain/power";
import {
  getCachedPowerCurrent,
  powerSummaryFromCurrent,
} from "@/lib/server/services/power-service";

const CACHE_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 100;
type CacheEntry = { expiresAt: number; value: Promise<OverviewEnvelope> };
const cache = new Map<string, CacheEntry>();

function summaryFromPower(current: PowerCurrentState | null) {
  return current?.topologyState === "available"
    ? powerSummaryFromCurrent(current)
    : null;
}

async function composeOverviewEnvelope(
  serverId: string,
  overviewRead: Promise<OverviewSnapshot>,
  powerRead: Promise<PowerCurrentState | null>,
  usesSharedPower: boolean,
  now: () => Date
): Promise<OverviewEnvelope> {
  const generatedAt = now().toISOString();
  const [overviewResult, powerResult] = await Promise.allSettled([
    overviewRead,
    powerRead,
  ]);

  if (overviewResult.status === "rejected") {
    return {
      apiVersion: "v1",
      generatedAt,
      serverId,
      freshness: { state: "unavailable", observedAt: null },
      data: null,
      unavailableSources: ["frm"],
    };
  }

  const snapshot = overviewResult.value;
  const sharedPower =
    powerResult.status === "fulfilled" ? powerResult.value : null;
  const data = {
    server: snapshot.server,
    session: snapshot.session,
    players: snapshot.players,
    power: usesSharedPower ? summaryFromPower(sharedPower) : snapshot.power,
    factory: snapshot.factory,
    progress: snapshot.progress,
  };

  return {
    apiVersion: "v1",
    generatedAt,
    serverId,
    freshness: { state: "live", observedAt: snapshot.observedAt },
    data,
    unavailableSources:
      usesSharedPower && powerResult.status === "rejected" ? ["frm"] : [],
  };
}

export async function getOverviewEnvelope(
  serverId: string,
  provider: FrmProvider,
  powerProvider: PowerProvider | null = null,
  now: () => Date = () => new Date()
): Promise<OverviewEnvelope> {
  return composeOverviewEnvelope(
    serverId,
    provider.getOverview(),
    powerProvider ? powerProvider.getPower() : Promise.resolve(null),
    powerProvider !== null,
    now
  );
}

export function getCachedOverviewEnvelope(
  serverId: string,
  provider: FrmProvider,
  powerProvider: PowerProvider | null = null,
  now: () => Date = () => new Date()
): Promise<OverviewEnvelope> {
  const nowMs = now().getTime();
  const existing = cache.get(serverId);
  if (existing && existing.expiresAt > nowMs) return existing.value;
  if (existing) cache.delete(serverId);

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }

  const value = composeOverviewEnvelope(
    serverId,
    provider.getOverview(),
    powerProvider
      ? getCachedPowerCurrent(serverId, powerProvider, nowMs)
      : Promise.resolve(null),
    powerProvider !== null,
    now
  );
  cache.set(serverId, { expiresAt: nowMs + CACHE_TTL_MS, value });
  void value.catch(() => {
    if (cache.get(serverId)?.value === value) cache.delete(serverId);
  });
  return value;
}
