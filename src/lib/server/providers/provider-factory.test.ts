import { describe, expect, it } from "vitest";
import { FrmPowerAdapter } from "@/lib/server/adapters/frm/frm-power-adapter";
import { PrometheusPowerHistoryAdapter } from "@/lib/server/adapters/prometheus/prometheus-power-history-adapter";
import { parseRuntimeConfig, resolvePublicServer } from "@/lib/server/config/runtime-config";
import { createFrmProvider, createPowerProviders } from "./provider-factory";

describe("provider factory", () => {
  it("returns deterministic populated data in mock mode", async () => {
    const config = parseRuntimeConfig({ DATA_MODE: "mock" });
    const provider = createFrmProvider(config, resolvePublicServer(config, "main"));
    const first = await provider.getOverview();
    const second = await provider.getOverview();
    expect(first).toEqual(second);
    expect(first.server.online).toBe(true);
    expect(first.players.online).toBeGreaterThan(0);
    const power = createPowerProviders(
      config,
      resolvePublicServer(config, "main")
    ).current;
    const current = await power.getPower();
    expect(first.power).toEqual({
      capacityMw: current.totals.capacityMw,
      consumptionMw: current.totals.consumptionMw,
      headroomMw: current.totals.headroomMw,
      utilizationPercent: current.totals.utilizationPercent,
      fuseTriggered: current.totals.fuseTriggered,
    });
  });

  it("creates deterministic current and history providers in mock mode", async () => {
    const config = parseRuntimeConfig({ DATA_MODE: "mock" });
    const providers = createPowerProviders(
      config,
      resolvePublicServer(config, "main")
    );
    expect(providers.history).not.toBeNull();
    const firstCurrent = await providers.current.getPower();
    const secondCurrent = await providers.current.getPower();
    const firstHistory = await providers.history?.getHistory({
      range: "1h",
      resolution: "auto",
    });
    const secondHistory = await providers.history?.getHistory({
      range: "1h",
      resolution: "auto",
    });
    expect(firstCurrent).toEqual(secondCurrent);
    expect(firstHistory).toEqual(secondHistory);
    expect(firstCurrent.circuits[0]?.id).toBe("0");
    expect(firstHistory?.series.map((series) => series.key)).toEqual([
      "capacityMw",
      "consumptionMw",
      "correctedMaximumConsumptionMw",
    ]);
  });

  it("creates fixed live adapters and keeps Prometheus optional per server", () => {
    const config = parseRuntimeConfig({
      DATA_MODE: "live",
      DEFAULT_SERVER_ID: "main",
      SERVERS_JSON: JSON.stringify([
        { id: "main", displayName: "Main", frmBaseUrl: "http://frm:8080" },
        { id: "beta", displayName: "Beta", frmBaseUrl: "http://beta:8080" },
      ]),
      PROMETHEUS_SERVERS_JSON: JSON.stringify([
        {
          serverId: "main",
          baseUrl: "http://prometheus:9090",
          urlLabel: "private-url",
          sessionLabel: "private-session",
        },
      ]),
    });
    const main = createPowerProviders(
      config,
      resolvePublicServer(config, "main")
    );
    const beta = createPowerProviders(
      config,
      resolvePublicServer(config, "beta")
    );
    expect(main.current).toBeInstanceOf(FrmPowerAdapter);
    expect(main.history).toBeInstanceOf(PrometheusPowerHistoryAdapter);
    expect(beta.current).toBeInstanceOf(FrmPowerAdapter);
    expect(beta.history).toBeNull();
  });
});
