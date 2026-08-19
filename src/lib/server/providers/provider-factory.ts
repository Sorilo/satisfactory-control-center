import type { FrmProvider } from "@/domain/overview";
import type { PowerHistoryProvider, PowerProvider } from "@/domain/power";
import { FrmOverviewAdapter } from "@/lib/server/adapters/frm/frm-overview-adapter";
import { FrmPowerAdapter } from "@/lib/server/adapters/frm/frm-power-adapter";
import { PrometheusPowerHistoryAdapter } from "@/lib/server/adapters/prometheus/prometheus-power-history-adapter";
import type {
  RuntimeConfig,
  ServerConfig,
} from "@/lib/server/config/runtime-config";
import { MockOverviewProvider } from "./mock-overview-provider";
import { MockPowerHistoryProvider, MockPowerProvider } from "./mock-power-providers";

/** Concrete providers constructed only from validated private runtime config. */
export function createFrmProvider(
  config: RuntimeConfig,
  server: ServerConfig
): FrmProvider {
  if (config.dataMode === "live") {
    return new FrmOverviewAdapter({
      baseUrl: server.frmBaseUrl,
      token: server.frmToken ?? undefined,
    });
  }
  return new MockOverviewProvider();
}

export interface PowerProviders {
  current: PowerProvider;
  history: PowerHistoryProvider | null;
}

export function createPowerProviders(
  config: RuntimeConfig,
  server: ServerConfig
): PowerProviders {
  if (config.dataMode === "mock") {
    return {
      current: new MockPowerProvider(),
      history: new MockPowerHistoryProvider(),
    };
  }

  const prometheus = config.prometheusServers.find(
    (entry) => entry.serverId === server.id
  );
  return {
    current: new FrmPowerAdapter({
      baseUrl: server.frmBaseUrl,
      token: server.frmToken ?? undefined,
    }),
    history: prometheus
      ? new PrometheusPowerHistoryAdapter({
          baseUrl: prometheus.baseUrl,
          urlLabel: prometheus.urlLabel,
          sessionLabel: prometheus.sessionLabel,
        })
      : null,
  };
}
