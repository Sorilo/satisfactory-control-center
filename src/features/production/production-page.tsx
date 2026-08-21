import { productionQuerySchema, type ProductionEnvelope, type ProductionQuery } from "@/contracts/production-contracts";
import { ProductionDashboard } from "@/features/production/production-dashboard";
import { createProductionProvider } from "@/lib/server/providers/provider-factory";
import { getProductionEnvelope } from "@/lib/server/services/production-service";
import { parseRuntimeConfig, resolvePublicServer, type DataMode } from "@/lib/server/config/runtime-config";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type LoadedProduction = { envelope: ProductionEnvelope; dataMode: DataMode; query: ProductionQuery };

export async function ProductionPage({ searchParams }: { searchParams: SearchParams }) {
  let loaded: LoadedProduction | null = null;
  try {
    const config = parseRuntimeConfig(process.env);
    const query = await searchParams;
    const requestedServer = typeof query.serverId === "string" ? query.serverId : config.defaultServerId;
    const server = resolvePublicServer(config, requestedServer);
    const parsed = productionQuerySchema.safeParse({
      serverId: server.id,
      search: typeof query.search === "string" ? query.search : undefined,
      itemKey: typeof query.itemKey === "string" ? query.itemKey : undefined,
      limit: typeof query.limit === "string" ? query.limit : undefined,
    });
    const productionQuery = parsed.success ? parsed.data : { serverId: server.id };
    const envelope = await getProductionEnvelope(server.id, createProductionProvider(config, server), productionQuery);
    loaded = { envelope, dataMode: config.dataMode, query: productionQuery };
  } catch {
    loaded = null;
  }

  if (loaded === null) {
    return (
      <section className="panel unavailable-state production-state">
        <p className="eyebrow">Production / Configuration</p>
        <h1>Production view is not ready</h1>
        <p>Runtime configuration could not be validated. No private configuration details are exposed.</p>
      </section>
    );
  }

  return (
    <ProductionDashboard
      envelope={loaded.envelope}
      dataMode={loaded.dataMode}
      search={loaded.query.search}
      selectedItemKey={loaded.query.itemKey}
    />
  );
}
