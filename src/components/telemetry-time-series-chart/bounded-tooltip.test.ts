import { describe, expect, it } from "vitest";
import { buildTooltipModel, clampTooltipAnchor } from "./bounded-tooltip";

describe("buildTooltipModel", () => {
  it("includes every available series by default", () => {
    const snapshots = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`,
      label: `S${i}`,
      value: i,
    }));

    const model = buildTooltipModel(1000, snapshots);

    expect(model.entries).toHaveLength(12);
    expect(model.truncated).toBe(false);
    expect(model.omittedCount).toBe(0);
  });

  it("keeps only series with a value and marks none truncated", () => {
    const model = buildTooltipModel(1000, [
      { id: "a", label: "A", value: 10 },
      { id: "b", label: "B", value: null },
      { id: "c", label: "C", value: 30 },
    ]);
    expect(model.timestamp).toBe(1000);
    expect(model.entries.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(model.truncated).toBe(false);
    expect(model.omittedCount).toBe(0);
  });

  it("caps entries at the bounded maximum and reports the omitted count", () => {
    const snapshots = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`,
      label: `S${i}`,
      value: i,
    }));
    const model = buildTooltipModel(2000, snapshots, 8);
    expect(model.entries).toHaveLength(8);
    expect(model.truncated).toBe(true);
    expect(model.omittedCount).toBe(4);
  });
});

describe("clampTooltipAnchor", () => {
  const bounds = { width: 800, height: 300 };
  const tooltip = { width: 200, height: 80 };

  it("places the tooltip to the right and centers vertically when there is room", () => {
    const result = clampTooltipAnchor({ x: 100, y: 50 }, tooltip, bounds, 12);
    expect(result.flipped).toBe(false);
    expect(result.x).toBe(112);
    expect(result.y).toBe(10);
  });

  it("flips left when the right edge would overflow", () => {
    const result = clampTooltipAnchor({ x: 700, y: 50 }, tooltip, bounds, 12);
    expect(result.flipped).toBe(true);
    expect(result.x).toBe(700 - 12 - 200);
  });

  it("clamps both axes inside the chart bounds", () => {
    const result = clampTooltipAnchor({ x: 790, y: 290 }, tooltip, bounds, 12);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.x).toBeLessThanOrEqual(bounds.width - tooltip.width);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeLessThanOrEqual(bounds.height - tooltip.height);
  });
});
