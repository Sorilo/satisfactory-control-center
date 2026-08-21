import { NextResponse } from "next/server";
import { productionQuerySchema } from "@/contracts/production-contracts";
import { getCachedProductionEnvelope } from "@/lib/server/services/production-service";
import { createProductionProvider } from "@/lib/server/providers/provider-factory";
import { getClientKey, TokenBucketLimiter } from "@/lib/server/security/rate-limiter";
import { parseRuntimeConfig, resolvePublicServer } from "@/lib/server/config/runtime-config";
import { createRequestContext, withRequestId } from "@/lib/server/observability/request-context";
import { createStructuredLogger } from "@/lib/server/observability/logger";

const limiter = new TokenBucketLimiter({ capacity: 20, refillPerSecond: 1, maxEntries: 10_000 });
const logger = createStructuredLogger();
const ALLOWED_QUERY_KEYS = new Set(["serverId", "search", "itemKey", "limit"]);
const PUBLIC_SERVER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function errorResponse(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ error: { code, message } }, {
    status,
    headers: { ...headers, "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const context = createRequestContext(request, "/api/v1/production");
  const respondError = (status: number, code: string, message: string, headers: Record<string, string> = {}) => {
    logger.warn({ requestId: context.requestId, route: context.route, code, message });
    return withRequestId(errorResponse(status, code, message, headers), context);
  };

  let config;
  try {
    config = parseRuntimeConfig(process.env);
  } catch {
    return respondError(503, "CONFIGURATION_UNAVAILABLE", "Service configuration is unavailable.");
  }

  const decision = limiter.consume(getClientKey(request, config.trustProxyHeaders));
  if (!decision.allowed) {
    return respondError(429, "RATE_LIMITED", "Too many requests.", { "Retry-After": String(decision.retryAfterSeconds) });
  }

  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];
  if (keys.some((key) => !ALLOWED_QUERY_KEYS.has(key)) || new Set(keys).size !== keys.length) {
    return respondError(400, "INVALID_QUERY", "Invalid query parameters.");
  }

  const serverId = params.get("serverId") ?? config.defaultServerId;
  const parsedQuery = productionQuerySchema.safeParse({
    serverId,
    search: params.get("search") ?? undefined,
    itemKey: params.get("itemKey") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });
  if (!parsedQuery.success) return respondError(400, "INVALID_QUERY", "Invalid query parameters.");
  if (!PUBLIC_SERVER_ID.test(serverId)) return respondError(400, "INVALID_SERVER_ID", "Invalid server id.");

  let server;
  try {
    server = resolvePublicServer(config, serverId);
  } catch {
    return respondError(404, "SERVER_NOT_FOUND", "Server not found.");
  }

  const envelope = await getCachedProductionEnvelope(
    server.id,
    createProductionProvider(config, server),
    parsedQuery.data
  );
  return withRequestId(NextResponse.json(envelope, { headers: { "Cache-Control": "no-store" } }), context);
}

export const GET_PRODUCTION_LIMITER = limiter;
