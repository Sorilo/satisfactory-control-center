import { describe, expect, it } from "vitest";
import { ConfigError, getPublicServerCatalog, parseRuntimeConfig, resolvePublicServer } from "./runtime-config";

describe("runtime configuration", () => {
  it("builds a safe mock default without a live URL", () => {
    const config = parseRuntimeConfig({ DATA_MODE: "mock" });
    expect(config.dataMode).toBe("mock");
    expect(config.defaultServerId).toBe("main");
    expect(getPublicServerCatalog(config)).toEqual([{ id: "main", displayName: "Main World" }]);
    expect(config.prometheusScrapeIntervalSeconds).toBe(15);
  });

  it("accepts a validated five-second Prometheus scrape interval", () => {
    expect(
      parseRuntimeConfig({ DATA_MODE: "mock", PROMETHEUS_SCRAPE_INTERVAL_SECONDS: "5" })
        .prometheusScrapeIntervalSeconds
    ).toBe(5);
  });

  it("rejects unsupported Prometheus scrape intervals", () => {
    for (const value of ["0", "-5", "10", "15.5", "nope", "60"]) {
      expect(() =>
        parseRuntimeConfig({ DATA_MODE: "mock", PROMETHEUS_SCRAPE_INTERVAL_SECONDS: value })
      ).toThrow(/PROMETHEUS_SCRAPE_INTERVAL_SECONDS/);
    }
  });

  it("keeps the power stream disabled unless explicitly enabled", () => {
    expect(parseRuntimeConfig({ DATA_MODE: "mock" }).powerStreamEnabled).toBe(false);
    expect(
      parseRuntimeConfig({ DATA_MODE: "mock", POWER_STREAM_ENABLED: "true" })
        .powerStreamEnabled
    ).toBe(true);
    expect(() =>
      parseRuntimeConfig({ DATA_MODE: "mock", POWER_STREAM_ENABLED: "yes" })
    ).toThrow(/POWER_STREAM_ENABLED/);
  });

  it("projects public metadata without internal URLs or tokens", () => {
    const config = parseRuntimeConfig({
      DATA_MODE: "live",
      DEFAULT_SERVER_ID: "main",
      SERVERS_JSON: JSON.stringify([
        { id: "main", displayName: "Main World", frmBaseUrl: "http://private:8080", frmToken: "secret", enabled: true, public: true },
        { id: "test", displayName: "Test", frmBaseUrl: "http://test:8080", enabled: true, public: false }
      ])
    });
    const publicJson = JSON.stringify(getPublicServerCatalog(config));
    expect(publicJson).toContain("Main World");
    expect(publicJson).not.toMatch(/private|8080|secret|Test/);
  });

  it("rejects unknown and private IDs instead of resolving request URLs", () => {
    const config = parseRuntimeConfig({
      DATA_MODE: "live",
      SERVERS_JSON: JSON.stringify([
        { id: "main", displayName: "Main", frmBaseUrl: "http://frm:8080", enabled: true, public: true },
        { id: "private", displayName: "Private", frmBaseUrl: "http://private:8080", enabled: true, public: false }
      ])
    });
    expect(() => resolvePublicServer(config, "http://169.254.169.254/latest")).toThrow(ConfigError);
    expect(() => resolvePublicServer(config, "private")).toThrow(ConfigError);
    expect(resolvePublicServer(config, "main").frmBaseUrl).toBe("http://frm:8080");
  });

  it("fails closed when live mode has no FRM URL", () => {
    expect(() => parseRuntimeConfig({ DATA_MODE: "live" })).toThrow(/FRM_BASE_URL/);
  });

  it("rejects duplicate IDs and a default that is not publicly selectable", () => {
    const duplicate = JSON.stringify([
      { id: "main", displayName: "One", frmBaseUrl: "http://one:8080" },
      { id: "main", displayName: "Two", frmBaseUrl: "http://two:8080" }
    ]);
    expect(() => parseRuntimeConfig({ DATA_MODE: "live", SERVERS_JSON: duplicate })).toThrow(/duplicate/i);

    const privateDefault = JSON.stringify([
      { id: "main", displayName: "Private", frmBaseUrl: "http://frm:8080", public: false },
      { id: "public", displayName: "Public", frmBaseUrl: "http://frm:8080", public: true }
    ]);
    expect(() => parseRuntimeConfig({ DATA_MODE: "live", DEFAULT_SERVER_ID: "main", SERVERS_JSON: privateDefault })).toThrow(/default/i);
  });

  it("accepts only HTTP(S) upstream URLs and bounded opaque IDs", () => {
    const invalidScheme = JSON.stringify([
      { id: "main", displayName: "Main", frmBaseUrl: "file:///etc/passwd" }
    ]);
    expect(() => parseRuntimeConfig({ DATA_MODE: "live", SERVERS_JSON: invalidScheme })).toThrow(/URL/i);

    const invalidId = JSON.stringify([
      { id: "../../admin", displayName: "Main", frmBaseUrl: "http://frm:8080" }
    ]);
    expect(() => parseRuntimeConfig({ DATA_MODE: "live", DEFAULT_SERVER_ID: "../../admin", SERVERS_JSON: invalidId })).toThrow(/opaque|server entry/i);
  });

  it("accepts optional Prometheus mappings joined to existing server IDs", () => {
    const config = parseRuntimeConfig({
      DATA_MODE: "live",
      SERVERS_JSON: JSON.stringify([
        { id: "main", displayName: "Main", frmBaseUrl: "http://frm:8080" },
        { id: "beta", displayName: "Beta", frmBaseUrl: "http://beta-frm:8080" },
      ]),
      PROMETHEUS_SERVERS_JSON: JSON.stringify([
        {
          serverId: "main",
          baseUrl: "http://prometheus:9090",
          urlLabel: "main.internal:7777",
          sessionLabel: "main-save",
        },
      ]),
    });
    expect(config.prometheusServers).toEqual([
      {
        serverId: "main",
        baseUrl: "http://prometheus:9090",
        urlLabel: "main.internal:7777",
        sessionLabel: "main-save",
      },
    ]);
    expect(config.prometheusServers.find((entry) => entry.serverId === "beta")).toBeUndefined();
    expect(JSON.stringify(getPublicServerCatalog(config))).not.toMatch(
      /prometheus|9090|main\.internal|main-save|urlLabel|sessionLabel/
    );
  });

  it("keeps Prometheus optional in both mock and live modes", () => {
    expect(parseRuntimeConfig({ DATA_MODE: "mock" }).prometheusServers).toEqual([]);
    expect(
      parseRuntimeConfig({ DATA_MODE: "live", FRM_BASE_URL: "http://frm:8080" })
        .prometheusServers
    ).toEqual([]);
  });

  it("rejects malformed, duplicate, credentialed, and unknown Prometheus mappings", () => {
    const servers = JSON.stringify([
      { id: "main", displayName: "Main", frmBaseUrl: "http://frm:8080" },
    ]);
    const parsePrometheus = (entries: unknown[]) =>
      parseRuntimeConfig({
        DATA_MODE: "live",
        SERVERS_JSON: servers,
        PROMETHEUS_SERVERS_JSON: JSON.stringify(entries),
      });
    const valid = {
      serverId: "main",
      baseUrl: "http://prometheus:9090",
      urlLabel: "main.internal:7777",
      sessionLabel: "main-save",
    };

    expect(() => parsePrometheus([{ ...valid, serverId: "unknown" }])).toThrow(/unknown/i);
    expect(() => parsePrometheus([valid, valid])).toThrow(/duplicate/i);
    expect(() => parsePrometheus([{ ...valid, baseUrl: "file:///etc/passwd" }])).toThrow(/URL/i);
    expect(() => parsePrometheus([{ ...valid, baseUrl: "http://user:pass@prometheus:9090" }])).toThrow(/URL/i);
    expect(() => parsePrometheus([{ ...valid, token: "secret" }])).toThrow(/invalid|entry/i);
    expect(() =>
      parseRuntimeConfig({
        DATA_MODE: "live",
        SERVERS_JSON: servers,
        PROMETHEUS_SERVERS_JSON: "not-json",
      })
    ).toThrow(/PROMETHEUS_SERVERS_JSON/);
    expect(() =>
      parseRuntimeConfig({
        DATA_MODE: "live",
        SERVERS_JSON: servers,
        PROMETHEUS_SERVERS_JSON: JSON.stringify({ serverId: "main" }),
      })
    ).toThrow(/array/i);
  });

  it("defaults player privacy to disabled and accepts only strict booleans", () => {
    const defaults = parseRuntimeConfig({ DATA_MODE: "mock" });
    expect(defaults.publicShowPlayerPositions).toBe(false);
    expect(defaults.publicShowPlayerInventory).toBe(false);

    const enabled = parseRuntimeConfig({
      DATA_MODE: "mock",
      PUBLIC_SHOW_PLAYER_POSITIONS: "true",
      PUBLIC_SHOW_PLAYER_INVENTORY: "true",
    });
    expect(enabled.publicShowPlayerPositions).toBe(true);
    expect(enabled.publicShowPlayerInventory).toBe(true);

    for (const value of ["TRUE", "yes", "1", "false "]) {
      expect(() => parseRuntimeConfig({ DATA_MODE: "mock", PUBLIC_SHOW_PLAYER_POSITIONS: value })).toThrow(/PUBLIC_SHOW_PLAYER_POSITIONS/);
      expect(() => parseRuntimeConfig({ DATA_MODE: "mock", PUBLIC_SHOW_PLAYER_INVENTORY: value })).toThrow(/PUBLIC_SHOW_PLAYER_INVENTORY/);
    }
  });
});
