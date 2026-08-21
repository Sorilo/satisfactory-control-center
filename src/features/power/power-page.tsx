import {
  powerHistoryRequestSchema,
} from "@/contracts/power-contracts";
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
      const resolutionRaw = typeof query.resolution === "string" ? query.resolution : "auto";
      const range = POWER_HISTORY_RANGES.includes(rangeRaw as PowerHistoryRequest["range"])
        ? (rangeRaw as PowerHistoryRequest["range"])
        : "1h";
      const resolution = POWER_HISTORY_RESOLUTIONS.includes(resolutionRaw as PowerHistoryRequest["resolution"])
        ? (resolutionRaw as PowerHistoryRequest["resolution"])
        : "auto";
      const parsedRequest = powerHistoryRequestSchema.safeParse({
        range,
        resolution,
        startAt: typeof query.startAt === "string" ? query.startAt : undefined,
        endAt: typeof query.endAt === "string" ? query.endAt : undefined,
      });
      const historyRequest: PowerHistoryRequest = parsedRequest.success
        ? parsedRequest.data
        : range === "custom"
          ? { range, resolution, startAt: typeof query.startAt === "string" ? query.startAt : undefined, endAt: typeof query.endAt === "string" ? query.endAt : undefined }
          : { range: "1h", resolution: "auto" };
      const providers = createPowerProviders(config, server);
      const envelope = await getCachedPowerEnvelope(
        server.id,
        providers.current,
        providers.history,
        historyRequest,
        undefined,
        config.prometheusScrapeIntervalSeconds
      );
      return {
        envelope,
        dataMode: config.dataMode,
        powerStreamEnabled: config.powerStreamEnabled,
        sourceIntervalSeconds: config.prometheusScrapeIntervalSeconds,
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
      selectedStartAt={loaded.historyRequest.startAt}
      selectedEndAt={loaded.historyRequest.endAt}
      sourceIntervalSeconds={loaded.sourceIntervalSeconds}
      />
  );
}
