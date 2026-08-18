import { NextResponse } from "next/server";
import { parseRuntimeConfig } from "@/lib/server/config/runtime-config";

/**
 * GET /api/health/ready
 *
 * Configuration readiness. Parses the runtime configuration and reports a
 * sanitized status only — never a URL, token, hostname, or raw error message.
 * Optional upstream degradation is intentionally out of scope here so a missing
 * upstream never forces restart loops.
 */
export function GET() {
  try {
    parseRuntimeConfig(process.env);
    return NextResponse.json(
      { status: "ready" },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { status: "not_ready" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
