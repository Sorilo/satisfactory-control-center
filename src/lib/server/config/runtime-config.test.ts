import { describe, expect, it } from "vitest";
import { ConfigError, getPublicServerCatalog, parseRuntimeConfig, resolvePublicServer } from "./runtime-config";

describe("runtime configuration", () => {
  it("builds a safe mock default without a live URL", () => {
    const config = parseRuntimeConfig({ DATA_MODE: "mock" });
    expect(config.dataMode).toBe("mock");
    expect(config.defaultServerId).toBe("main");
    expect(getPublicServerCatalog(config)).toEqual([{ id: "main", displayName: "Main World" }]);
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
});
