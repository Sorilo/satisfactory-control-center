import type { FrmProvider } from "@/domain/overview";
import { FrmOverviewAdapter } from "@/lib/server/adapters/frm/frm-overview-adapter";
import type {
  RuntimeConfig,
  ServerConfig,
} from "@/lib/server/config/runtime-config";
import { MockOverviewProvider } from "./mock-overview-provider";

/**
 * Provider factory.
 *
 * The single place that couples a validated runtime configuration to a concrete
 * transport. Routes and services depend only on the `FrmProvider` port, so mock
 * and live modes are interchangeable behind the same boundary.
 */
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
