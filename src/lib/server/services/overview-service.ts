import type { FrmProvider, OverviewSnapshot } from "@/domain/overview";
import type { OverviewEnvelope } from "@/contracts/public-contracts";

const CACHE_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 100;
const overviewCache = new Map<string, { expiresAtMs: number; value: Promise<OverviewEnvelope> }>();

/**
 * Overview orchestration.
 *
 * Produces the public v1 overview envelope for a resolved server. A valid
 * empty world is preserved as live data; any provider failure is collapsed into
 * a sanitized unavailable envelope that never carries internal error messages,
 * URLs, or credentials.
 */

export async function getOverviewEnvelope(
  serverId: string,
  provider: FrmProvider,
  now: () => Date = () => new Date()
): Promise<OverviewEnvelope> {
  const generatedAt = now().toISOString();

  let snapshot: OverviewSnapshot;
  try {
    snapshot = await provider.getOverview();
  } catch {
    return {
      apiVersion: "v1",
      generatedAt,
      serverId,
      freshness: { state: "unavailable", observedAt: null },
      data: null,
      unavailableSources: ["frm"],
    };
  }

  return {
    apiVersion: "v1",
    generatedAt,
    serverId,
    freshness: { state: "live", observedAt: snapshot.observedAt },
    data: {
      server: snapshot.server,
      session: snapshot.session,
      players: snapshot.players,
      power: snapshot.power,
      factory: snapshot.factory,
      progress: snapshot.progress,
    },
    unavailableSources: [],
  };
}

export function getCachedOverviewEnvelope(
  serverId: string,
  provider: FrmProvider,
  now: () => Date = () => new Date()
): Promise<OverviewEnvelope> {
  const nowMs = now().getTime();
  const cached = overviewCache.get(serverId);
  if (cached && cached.expiresAtMs > nowMs) return cached.value;
  if (cached) overviewCache.delete(serverId);

  if (overviewCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = overviewCache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) overviewCache.delete(oldestKey);
  }

  const value = getOverviewEnvelope(serverId, provider, now);
  overviewCache.set(serverId, { expiresAtMs: nowMs + CACHE_TTL_MS, value });
  return value;
}
