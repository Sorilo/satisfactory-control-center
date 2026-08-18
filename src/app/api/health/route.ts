import { NextResponse } from "next/server";
import { parseRuntimeConfig } from "@/lib/server/config/runtime-config";

/**
 * GET /api/health
 *
 * Combined sanitized health summary: liveness plus configuration readiness.
 * The body carries only stable public status words; it never includes private
 * connection details. Status is 200 when ready and 503 when not.
 */
export function GET() {
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

  return NextResponse.json(body, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
