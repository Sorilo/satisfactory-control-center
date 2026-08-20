import { NextResponse } from "next/server";
import {
  powerEnvelopeSchema,
  powerHistoryRequestSchema,
  type PowerEnvelope,
} from "@/contracts/power-contracts";
import {
  type PowerHistoryRequest,
} from "@/domain/power";
import {
  isValidPublicServerId,
  parseRuntimeConfig,
  resolvePublicServer,
  type RuntimeConfig,
  type ServerConfig,
} from "@/lib/server/config/runtime-config";
import { createPowerProviders } from "@/lib/server/providers/provider-factory";
import { getClientKey, TokenBucketLimiter } from "@/lib/server/security/rate-limiter";
import { getCachedPowerEnvelope } from "@/lib/server/services/power-service";

const HISTORY_LIMITER_OPTIONS = {
  capacity: 20,
  refillPerSecond: 0.2,
  maxEntries: 10_000,
};

let powerHistoryLimiter = new TokenBucketLimiter(HISTORY_LIMITER_OPTIONS);

const NO_STORE = { "Cache-Control": "no-store" };
const ALLOWED_QUERY_KEYS = new Set(["serverId", "range", "resolution", "startAt", "endAt"]);

type PowerLoader = (
  serverId: string,
  config: RuntimeConfig,
  server: ServerConfig,
  request: PowerHistoryRequest
) => Promise<PowerEnvelope>;

const defaultLoader: PowerLoader = async (serverId, config, server, request) => {
  const providers = createPowerProviders(config, server);
  return getCachedPowerEnvelope(
    serverId,
    providers.current,
    providers.history,
    request
  );
};

function errorResponse(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { ...NO_STORE, ...headers } }
  );
}

function parseQuery(url: URL, defaultServerId: string): {
  serverId: string;
  history: PowerHistoryRequest;
} | null {
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key)) return null;
  }
  for (const key of ALLOWED_QUERY_KEYS) {
    if (url.searchParams.getAll(key).length > 1) return null;
  }

  const serverId = url.searchParams.get("serverId") ?? defaultServerId;
  const range = url.searchParams.get("range") ?? "1h";
  const resolution = url.searchParams.get("resolution") ?? "auto";
  const startAt = url.searchParams.get("startAt") ?? undefined;
  const endAt = url.searchParams.get("endAt") ?? undefined;
  const history = powerHistoryRequestSchema.safeParse({ range, resolution, startAt, endAt });
  if (!history.success) return null;
  return { serverId, history: history.data };
}

/** GET /api/v1/power with fixed, allowlisted history controls only. */
export async function handlePowerRequest(
  request: Request,
  loader: PowerLoader = defaultLoader
): Promise<Response> {
  let config: RuntimeConfig;
  try {
    config = parseRuntimeConfig(process.env);
  } catch {
    return errorResponse(
      503,
      "CONFIGURATION_UNAVAILABLE",
      "Service configuration unavailable."
    );
  }

  const limit = powerHistoryLimiter.consume(
    getClientKey(request, config.trustProxyHeaders)
  );
  if (!limit.allowed) {
    return errorResponse(429, "RATE_LIMITED", "Too many requests.", {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const query = parseQuery(new URL(request.url), config.defaultServerId);
  if (!query) {
    return errorResponse(400, "INVALID_QUERY", "Invalid query parameters.");
  }
  if (!isValidPublicServerId(query.serverId)) {
    return errorResponse(400, "INVALID_SERVER_ID", "Invalid server id.");
  }

  let server: ServerConfig;
  try {
    server = resolvePublicServer(config, query.serverId);
  } catch {
    return errorResponse(404, "SERVER_NOT_FOUND", "Server not found.");
  }

  try {
    const envelope = powerEnvelopeSchema.parse(
      await loader(query.serverId, config, server, query.history)
    );
    const status =
      envelope.data.current === null && envelope.data.history === null ? 503 : 200;
    return NextResponse.json(envelope, { status, headers: NO_STORE });
  } catch {
    return errorResponse(503, "SERVICE_UNAVAILABLE", "Power service unavailable.");
  }
}

export async function GET(request: Request): Promise<Response> {
  return handlePowerRequest(request);
}

export function resetPowerRouteLimiterForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  powerHistoryLimiter = new TokenBucketLimiter(HISTORY_LIMITER_OPTIONS);
}
