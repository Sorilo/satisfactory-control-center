import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ProductionPage } from "./production-page";
import { clearProductionServiceCachesForTests } from "@/lib/server/services/production-service";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  clearProductionServiceCachesForTests();
});

describe("ProductionPage", () => {
  it("falls back to the configured default server for a stale bookmark", async () => {
    process.env.DATA_MODE = "mock";
    delete process.env.SERVERS_JSON;
    delete process.env.FRM_BASE_URL;
    process.env.DEFAULT_SERVER_ID = "main";

    const element = await ProductionPage({
      searchParams: Promise.resolve({ serverId: "removed-server" }),
    });

    const productionElement = element as ReactElement<{ envelope: { serverId: string } }>;
    expect(productionElement.props.envelope.serverId).toBe("main");
  });
});
