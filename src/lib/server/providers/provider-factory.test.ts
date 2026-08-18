import { describe, expect, it } from "vitest";
import { parseRuntimeConfig, resolvePublicServer } from "@/lib/server/config/runtime-config";
import { createFrmProvider } from "./provider-factory";

describe("provider factory", () => {
  it("returns deterministic populated data in mock mode", async () => {
    const config = parseRuntimeConfig({ DATA_MODE: "mock" });
    const provider = createFrmProvider(config, resolvePublicServer(config, "main"));
    const first = await provider.getOverview();
    const second = await provider.getOverview();
    expect(first).toEqual(second);
    expect(first.server.online).toBe(true);
    expect(first.players.online).toBeGreaterThan(0);
    expect(first.power?.headroomMw).toBeGreaterThan(0);
  });
});
