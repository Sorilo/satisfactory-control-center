import { describe, expect, it } from "vitest";
import { exactIndex, mergeTimestamps, minMaxDecimate, nearestIndex } from "./downsample";

describe("nearestIndex", () => {
  it("returns -1 for an empty timeline", () => {
    expect(nearestIndex([], 5)).toBe(-1);
  });

  it("returns the only index for a single point", () => {
    expect(nearestIndex([10], 999)).toBe(0);
  });

  it("returns the exact matching index", () => {
    expect(nearestIndex([0, 10, 20, 30], 20)).toBe(2);
  });

  it("resolves ties toward the earlier timestamp", () => {
    expect(nearestIndex([0, 10, 20], 15)).toBe(1);
    expect(nearestIndex([0, 10, 20, 30], 15)).toBe(1);
  });

  it("clamps targets before the first and after the last point", () => {
    expect(nearestIndex([100, 200, 300], 0)).toBe(0);
    expect(nearestIndex([100, 200, 300], 500)).toBe(2);
  });

  it("binary-searches into the middle of a large timeline", () => {
    const times = Array.from({ length: 1000 }, (_, i) => i * 10);
    expect(nearestIndex(times, 4321)).toBe(432);
  });
});

describe("exactIndex", () => {
  it("returns -1 for an empty timeline", () => {
    expect(exactIndex([], 5)).toBe(-1);
  });

  it("returns the index of an exact match", () => {
    expect(exactIndex([0, 10, 20, 30], 20)).toBe(2);
    expect(exactIndex([100], 100)).toBe(0);
  });

  it("returns -1 when the target is absent instead of snapping", () => {
    expect(exactIndex([0, 10, 20, 30], 15)).toBe(-1);
    expect(exactIndex([0, 10, 20, 30], 5)).toBe(-1);
    expect(exactIndex([0, 10, 20, 30], 25)).toBe(-1);
    expect(exactIndex([100, 200, 300], 0)).toBe(-1);
    expect(exactIndex([100, 200, 300], 500)).toBe(-1);
  });

  it("binary-searches into the middle of a large timeline", () => {
    const times = Array.from({ length: 1000 }, (_, i) => i * 10);
    expect(exactIndex(times, 4320)).toBe(432);
    expect(exactIndex(times, 4321)).toBe(-1);
  });
});

describe("mergeTimestamps", () => {
  it("merges and de-duplicates ragged series into ascending order", () => {
    const merged = mergeTimestamps([
      {
        points: [
          { timestamp: 3000, value: 0 },
          { timestamp: 1000, value: 0 },
          { timestamp: 2000, value: 0 },
        ],
      },
      { points: [{ timestamp: 2000, value: 0 }, { timestamp: 4000, value: 0 }] },
      { points: [] },
    ]);
    expect(merged).toEqual([1000, 2000, 3000, 4000]);
  });

  it("returns an empty timeline when there are no points", () => {
    expect(mergeTimestamps([])).toEqual([]);
    expect(mergeTimestamps([{ points: [] }])).toEqual([]);
  });
});

describe("minMaxDecimate", () => {
  const points = (values: number[]) =>
    values.map((value, index) => ({ timestamp: index, value }));

  it("returns every point with its source index when under budget", () => {
    const result = minMaxDecimate(points([5, 6, 7]), 10);
    expect(result).toEqual([
      { timestamp: 0, value: 5, index: 0 },
      { timestamp: 1, value: 6, index: 1 },
      { timestamp: 2, value: 7, index: 2 },
    ]);
  });

  it("returns nothing for empty input or a non-positive budget", () => {
    expect(minMaxDecimate([], 10)).toEqual([]);
    expect(minMaxDecimate(points([1, 2, 3]), 0)).toEqual([]);
  });

  it("always keeps the first and last point", () => {
    const result = minMaxDecimate(points([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), 4);
    expect(result[0]!.index).toBe(0);
    expect(result[result.length - 1]!.index).toBe(9);
  });

  it("preserves a spike inside a bucket instead of dropping it", () => {
    const result = minMaxDecimate(points([10, 10, 10, 10, 500, 10, 10, 10, 10]), 4);
    expect(result.map((p) => p.value)).toContain(500);
  });

  it("stays within budget and remains time-ordered", () => {
    const input = points(Array.from({ length: 101 }, (_, i) => Math.sin(i / 3) * 100));
    const result = minMaxDecimate(input, 20);
    expect(result.length).toBeLessThanOrEqual(20);
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i]!.index).toBeGreaterThan(result[i - 1]!.index);
    }
  });

  it("bounds a 250,000-point history to a 1,000-point render path without losing extremes", () => {
    const input = Array.from({ length: 250_000 }, (_, index) => ({
      timestamp: index * 60_000,
      value: index === 123_456 ? 1_000_000 : Math.sin(index / 97) * 100,
    }));

    const result = minMaxDecimate(input, 1_000);

    expect(result.length).toBeLessThanOrEqual(1_000);
    expect(result[0]?.index).toBe(0);
    expect(result.at(-1)?.index).toBe(input.length - 1);
    expect(result.some((point) => point.value === 1_000_000)).toBe(true);
  });
});
