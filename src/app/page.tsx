import type { OverviewEnvelope } from "@/contracts/public-contracts";
import { OverviewDashboard } from "@/features/overview/overview-dashboard";
import { parseRuntimeConfig, resolvePublicServer, type DataMode } from "@/lib/server/config/runtime-config";
import {
  createFrmProvider,
  createPowerProviders,
} from "@/lib/server/providers/provider-factory";
import { getCachedOverviewEnvelope } from "@/lib/server/services/overview-service";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type PageData =
  | { ok: true; envelope: OverviewEnvelope; dataMode: DataMode }
  | { ok: false };

async function loadPageData(searchParams: SearchParams): Promise<PageData> {
  try {
    const config = parseRuntimeConfig(process.env);
    const query = await searchParams;
    const requested = typeof query.serverId === "string" ? query.serverId : config.defaultServerId;
    let server;
    try {
      server = resolvePublicServer(config, requested);
    } catch {
      server = resolvePublicServer(config, config.defaultServerId);
    }
    const envelope = await getCachedOverviewEnvelope(
      server.id,
      createFrmProvider(config, server),
      createPowerProviders(config, server).current
    );
    return { ok: true, envelope, dataMode: config.dataMode };
  } catch {
    return { ok: false };
  }
}

export default async function OverviewPage({ searchParams }: { searchParams: SearchParams }) {
  const result = await loadPageData(searchParams);
  if (result.ok) {
    return <OverviewDashboard envelope={result.envelope} dataMode={result.dataMode} />;
  }
  return (
    <section className="panel unavailable-state">
      <p className="eyebrow">Configuration</p>
      <h1>Control Center is not ready</h1>
      <p>
        Runtime configuration could not be validated. The health readiness endpoint is
        reporting the same condition without exposing private details.
      </p>
    </section>
  );
}
