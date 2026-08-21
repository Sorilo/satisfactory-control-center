import { NextResponse } from "next/server";
import { parseRuntimeConfig } from "@/lib/server/config/runtime-config";
import { createRequestContext, withRequestId } from "@/lib/server/observability/request-context";

/**
 * GET /api/health
 *
 * Combined sanitized health summary: liveness plus configuration readiness.
 * The body carries only stable public status words; it never includes private
 * connection details. Status is 200 when ready and 503 when not.
 */
export function GET(request?: Request) {
  const context = createRequestContext(
    request ?? new Request("http://app/api/health"),
    "/api/health"
  );
  let ready = true;
  try {
    parseRuntimeConfig(process.env);
  } catch {
    ready = false;
  }

  const body = {
    status: ready ? "ok" : "degraded",
    liveness: "ok",
    readiness: ready ? "ready" : "not_ready",
  };

  return withRequestId(NextResponse.json(body, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  }), context);
}
