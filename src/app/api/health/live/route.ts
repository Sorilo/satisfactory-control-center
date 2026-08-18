import { NextResponse } from "next/server";

/**
 * GET /api/health/live
 *
 * Process liveness. This route deliberately performs no configuration or
 * upstream work: if the process can serve this response it is live. The result
 * must never be cached.
 */
export function GET() {
  return NextResponse.json(
    { status: "live" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
