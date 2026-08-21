import { describe, expect, it } from "vitest";
import {
  buildProductionItem,
  normalizeItemKey,
  type ProductionRecord,
} from "./production";

const record = (overrides: Partial<ProductionRecord> = {}): ProductionRecord => ({
  name: "Iron Rod",
  form: "Solid",
  productionPerMinute: 120,
  consumptionPerMinute: 60,
  maxProductionPerMinute: 240,
  maxConsumptionPerMinute: 120,
  productionEfficiencyPercent: 50,
  consumptionEfficiencyPercent: 50,
  ...overrides,
});

describe("production domain", () => {
  it("normalizes bounded public item keys and calculates net throughput", () => {
    const item = buildProductionItem(record({ name: "Iron Rod / Mk.1" }));
    expect(item.itemKey).toBe("iron-rod-mk-1");
    expect(item.netPerMinute).toBe(60);
    expect(item.provenance).toEqual({
      throughput: "observed",
      capacity: "observed",
      net: "calculated",
    });
  });

  it("normalizes Unicode and punctuation deterministically", () => {
    expect(normalizeItemKey("  Reinforced-Iron Plate  ")).toBe("reinforced-iron-plate");
    expect(normalizeItemKey(" ")).toBeNull();
  });

  it("rejects non-finite or negative source values instead of guessing", () => {
    expect(() => buildProductionItem(record({ productionPerMinute: Number.NaN }))).toThrow("invalid-production-value");
    expect(() => buildProductionItem(record({ maxConsumptionPerMinute: -1 }))).toThrow("invalid-production-value");
  });
});
