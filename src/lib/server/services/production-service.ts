import type { ProductionEnvelope, ProductionQuery } from "@/contracts/production-contracts";
import { productionEnvelopeSchema } from "@/contracts/production-contracts";
import type { ProductionProvider } from "@/domain/production";

export type Clock = () => string;

const defaultClock: Clock = () => new Date().toISOString();

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
