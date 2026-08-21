import { describe, expect, it } from "vitest";
import { MockProductionProvider } from "./mock-production-providers";

describe("mock production provider", () => {
  it("returns deterministic current-only items without upstream identities", async () => {
    const snapshot = await new MockProductionProvider().getProduction();
    expect(snapshot.items.map((item) => item.itemKey)).toEqual(["iron-rod", "copper-sheet", "water"]);
    expect(snapshot.items[0]).not.toHaveProperty("className");
  });
});
