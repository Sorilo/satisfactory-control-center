import {
  POWER_HISTORY_RANGES,
  POWER_HISTORY_RESOLUTIONS,
  type PowerHistoryRequest,
} from "@/domain/power";
import { PowerDashboard } from "@/features/power/power-dashboard";
import {
  parseRuntimeConfig,
  resolvePublicServer,
} from "@/lib/server/config/runtime-config";
import { createPowerProviders } from "@/lib/server/providers/provider-factory";
import { getCachedPowerEnvelope } from "@/lib/server/services/power-service";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function PowerPage({ searchParams }: { searchParams: SearchParams }) {
  const loaded = await (async () => {
    try {
      const config = parseRuntimeConfig(process.env);
      const query = await searchParams;
      const requestedServer =
        typeof query.serverId === "string" ? query.serverId : config.defaultServerId;
      let server;
      try {
        server = resolvePublicServer(config, requestedServer);
      } catch {
        server = resolvePublicServer(config, config.defaultServerId);
      }

      const rangeRaw = typeof query.range === "string" ? query.range : "1h";
      const resolutionRaw =
        typeof query.resolution === "string" ? query.resolution : "auto";
      const historyRequest: PowerHistoryRequest = {
        range: POWER_HISTORY_RANGES.includes(
          rangeRaw as PowerHistoryRequest["range"]
        )
          ? (rangeRaw as PowerHistoryRequest["range"])
          : "1h",
        resolution: POWER_HISTORY_RESOLUTIONS.includes(
          resolutionRaw as PowerHistoryRequest["resolution"]
        )
          ? (resolutionRaw as PowerHistoryRequest["resolution"])
          : "auto",
      };

      const providers = createPowerProviders(config, server);
      const envelope = await getCachedPowerEnvelope(
        server.id,
        providers.current,
        providers.history,
        historyRequest
      );
      return {
        envelope,
        dataMode: config.dataMode,
        powerStreamEnabled: config.powerStreamEnabled,
        historyRequest,
      };
    } catch {
      return null;
    }
  })();

  if (!loaded) {
    return (
      <section className="panel unavailable-state">
        <p className="eyebrow">Configuration</p>
        <h1>Power view is not ready</h1>
        <p>Runtime configuration could not be validated. No private configuration details are exposed.</p>
      </section>
    );
  }

  return (
    <PowerDashboard
      envelope={loaded.envelope}
      dataMode={loaded.dataMode}
      streamEnabled={loaded.powerStreamEnabled}
      selectedRange={loaded.historyRequest.range}
      selectedResolution={loaded.historyRequest.resolution}
    />
  );
}
