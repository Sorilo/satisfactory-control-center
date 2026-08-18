import { NextResponse } from "next/server";
import { serverCatalogSchema } from "@/contracts/public-contracts";
import { getPublicServerCatalog, parseRuntimeConfig } from "@/lib/server/config/runtime-config";

const CONFIGURATION_UNAVAILABLE = {
  error: {
    code: "CONFIGURATION_UNAVAILABLE",
    message: "Service configuration is unavailable.",
  },
};

export function GET() {
  try {
    const config = parseRuntimeConfig(process.env);
    const body = serverCatalogSchema.parse({
      defaultServerId: config.defaultServerId,
      servers: getPublicServerCatalog(config),
    });
    return NextResponse.json(body, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch {
    return NextResponse.json(CONFIGURATION_UNAVAILABLE, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
