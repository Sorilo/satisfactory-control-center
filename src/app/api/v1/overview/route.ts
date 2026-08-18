import { NextResponse } from "next/server";
import { overviewEnvelopeSchema } from "@/contracts/public-contracts";
import {
  isValidPublicServerId,
  parseRuntimeConfig,
  resolvePublicServer,
} from "@/lib/server/config/runtime-config";
import { createFrmProvider } from "@/lib/server/providers/provider-factory";
import { getCachedOverviewEnvelope } from "@/lib/server/services/overview-service";
import { getClientKey, TokenBucketLimiter } from "@/lib/server/security/rate-limiter";

const overviewLimiter = new TokenBucketLimiter({
  capacity: 60,
  refillPerSecond: 1,
  maxEntries: 10_000,
});

const NOT_FOUND_BODY = {
  error: { code: "SERVER_NOT_FOUND", message: "Server not found." },
};

/**
 * GET /api/v1/overview?serverId=<opaque-id>
 *
 * Accepts only an opaque public server id. The id is resolved through the
 * server-only registry (never a client URL); malformed ids receive a generic
 * 400 while unknown, disabled, or non-public ids receive a generic 404. A resolved
 * server is handed to the provider factory, the service produces a normalized
 * envelope, and the envelope is validated against the strict public schema
 * before a private `no-store` cache policy is attached.
 */
export async function GET(request: Request) {
  let config;
  try {
    config = parseRuntimeConfig(process.env);
  } catch {
    return NextResponse.json(
      { error: { code: "CONFIGURATION_UNAVAILABLE", message: "Service configuration unavailable." } },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const limit = overviewLimiter.consume(getClientKey(request, config.trustProxyHeaders));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many requests." } },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(limit.retryAfterSeconds),
        },
      }
    );
  }

  const serverId =
    new URL(request.url).searchParams.get("serverId") ?? "";

  if (!isValidPublicServerId(serverId)) {
    return NextResponse.json(
      { error: { code: "INVALID_SERVER_ID", message: "Invalid server id." } },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  let server;
  try {
    server = resolvePublicServer(config, serverId);
  } catch {
    return NextResponse.json(NOT_FOUND_BODY, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const provider = createFrmProvider(config, server);
  const envelope = await getCachedOverviewEnvelope(serverId, provider);
  const body = overviewEnvelopeSchema.parse(envelope);

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
