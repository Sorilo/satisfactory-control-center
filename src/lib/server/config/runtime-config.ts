import { z } from "zod";

export type DataMode = "mock" | "live";

export interface ServerConfig {
  id: string;
  displayName: string;
  frmBaseUrl: string;
  frmToken: string | null;
  enabled: boolean;
  public: boolean;
}

export interface PublicServerEntry {
  id: string;
  displayName: string;
}

export interface PrometheusServerConfig {
  serverId: string;
  baseUrl: string;
  urlLabel: string;
  sessionLabel: string;
}

export interface RuntimeConfig {
  dataMode: DataMode;
  defaultServerId: string;
  servers: ServerConfig[];
  prometheusServers: PrometheusServerConfig[];
  trustProxyHeaders: boolean;
  powerStreamEnabled: boolean;
}

export type RuntimeEnv = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const opaqueIdSchema = z.string().regex(
  /^[a-z0-9][a-z0-9_-]{0,63}$/,
  "server id must be a bounded opaque identifier"
);

const serverEntrySchema = z.object({
  id: opaqueIdSchema,
  displayName: z.string().trim().min(1).max(80),
  frmBaseUrl: z.string().trim().optional(),
  frmToken: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  public: z.boolean().optional(),
}).strict();

const prometheusServerEntrySchema = z.object({
  serverId: opaqueIdSchema,
  baseUrl: z.string().trim().min(1),
  urlLabel: z.string().trim().min(1).max(256),
  sessionLabel: z.string().trim().min(1).max(256),
}).strict();

function assertSafeHttpUrl(raw: string, source = "FRM"): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${source} URL must be a valid HTTP(S) URL`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new ConfigError(`${source} URL must be a valid HTTP(S) URL without embedded credentials`);
  }
}

function parsePrometheusServersJson(raw: string | undefined): PrometheusServerConfig[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError("PROMETHEUS_SERVERS_JSON is not valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new ConfigError("PROMETHEUS_SERVERS_JSON must be a JSON array");
  }
  return parsed.map((entry) => {
    const result = prometheusServerEntrySchema.safeParse(entry);
    if (!result.success) {
      throw new ConfigError("PROMETHEUS_SERVERS_JSON contains an invalid entry");
    }
    assertSafeHttpUrl(result.data.baseUrl, "Prometheus");
    return result.data;
  });
}

function parseServersJson(raw: string): ServerConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError("SERVERS_JSON is not valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new ConfigError("SERVERS_JSON must be a JSON array");
  }
  return parsed.map((entry) => {
    const result = serverEntrySchema.safeParse(entry);
    if (!result.success) {
      throw new ConfigError("SERVERS_JSON contains an invalid server entry");
    }
    return {
      id: result.data.id,
      displayName: result.data.displayName,
      frmBaseUrl: result.data.frmBaseUrl ?? "",
      frmToken: result.data.frmToken ?? null,
      enabled: result.data.enabled ?? true,
      public: result.data.public ?? true,
    };
  });
}

function validateRegistry(config: RuntimeConfig): RuntimeConfig {
  const ids = new Set<string>();
  for (const server of config.servers) {
    if (ids.has(server.id)) {
      throw new ConfigError("SERVERS_JSON contains a duplicate server id");
    }
    ids.add(server.id);
    if (config.dataMode === "live" && server.enabled) {
      if (!server.frmBaseUrl) {
        throw new ConfigError("Every enabled live server requires an FRM URL");
      }
      assertSafeHttpUrl(server.frmBaseUrl);
    }
  }

  const prometheusIds = new Set<string>();
  for (const prometheus of config.prometheusServers) {
    if (!ids.has(prometheus.serverId)) {
      throw new ConfigError("PROMETHEUS_SERVERS_JSON references an unknown server id");
    }
    if (prometheusIds.has(prometheus.serverId)) {
      throw new ConfigError("PROMETHEUS_SERVERS_JSON contains a duplicate server id");
    }
    prometheusIds.add(prometheus.serverId);
  }

  const defaultServer = config.servers.find((server) => server.id === config.defaultServerId);
  if (!defaultServer || !defaultServer.enabled || !defaultServer.public) {
    throw new ConfigError("Default server must be enabled and publicly selectable");
  }
  return config;
}

export function parseRuntimeConfig(env: RuntimeEnv): RuntimeConfig {
  const dataModeRaw = env.DATA_MODE ?? "mock";
  if (dataModeRaw !== "mock" && dataModeRaw !== "live") {
    throw new ConfigError("DATA_MODE must be 'mock' or 'live'");
  }
  const dataMode: DataMode = dataModeRaw;
  const trustProxyHeadersRaw = env.TRUST_PROXY_HEADERS ?? "false";
  if (trustProxyHeadersRaw !== "true" && trustProxyHeadersRaw !== "false") {
    throw new ConfigError("TRUST_PROXY_HEADERS must be 'true' or 'false'");
  }
  const powerStreamEnabledRaw = env.POWER_STREAM_ENABLED ?? "false";
  if (powerStreamEnabledRaw !== "true" && powerStreamEnabledRaw !== "false") {
    throw new ConfigError("POWER_STREAM_ENABLED must be 'true' or 'false'");
  }
  const defaultServerId = env.DEFAULT_SERVER_ID ?? "main";
  if (!opaqueIdSchema.safeParse(defaultServerId).success) {
    throw new ConfigError("DEFAULT_SERVER_ID must be a bounded opaque identifier");
  }
  const defaultServerName = env.DEFAULT_SERVER_NAME?.trim() || "Main World";

  let servers: ServerConfig[];
  if (env.SERVERS_JSON) {
    servers = parseServersJson(env.SERVERS_JSON);
  } else if (dataMode === "live") {
    if (!env.FRM_BASE_URL) {
      throw new ConfigError("live data mode requires FRM_BASE_URL (or a SERVERS_JSON registry)");
    }
    servers = [{
      id: defaultServerId,
      displayName: defaultServerName,
      frmBaseUrl: env.FRM_BASE_URL,
      frmToken: env.FRM_TOKEN || null,
      enabled: true,
      public: true,
    }];
  } else {
    servers = [{
      id: defaultServerId,
      displayName: defaultServerName,
      frmBaseUrl: "",
      frmToken: null,
      enabled: true,
      public: true,
    }];
  }

  return validateRegistry({
    dataMode,
    defaultServerId,
    servers,
    prometheusServers: parsePrometheusServersJson(env.PROMETHEUS_SERVERS_JSON),
    trustProxyHeaders: trustProxyHeadersRaw === "true",
    powerStreamEnabled: powerStreamEnabledRaw === "true",
  });
}

export function getPublicServerCatalog(config: RuntimeConfig): PublicServerEntry[] {
  return config.servers
    .filter((server) => server.enabled && server.public)
    .map(({ id, displayName }) => ({ id, displayName }));
}

export function isValidPublicServerId(serverId: string): boolean {
  return opaqueIdSchema.safeParse(serverId).success;
}

export function resolvePublicServer(config: RuntimeConfig, serverId: string): ServerConfig {
  if (!opaqueIdSchema.safeParse(serverId).success) {
    throw new ConfigError("unknown, disabled, or non-public server id");
  }
  const server = config.servers.find((candidate) => candidate.id === serverId);
  if (!server || !server.enabled || !server.public) {
    throw new ConfigError("unknown, disabled, or non-public server id");
  }
  return server;
}
