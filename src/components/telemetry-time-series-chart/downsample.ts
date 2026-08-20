/**
 * Pure, dependency-free indexing and downsampling utilities for telemetry time
 * series. These operate on plain timestamp/value pairs so any chart domain can
 * reuse them without pulling in React or a chart library.
 */

export interface Point {
  timestamp: number;
  value: number;
}

export interface DecimatedPoint extends Point {
  /** Index of this point in the source array it was decimated from. */
  index: number;
}

/**
 * Binary search for an exact timestamp match. Returns the index of `target`
 * when it is present in the (ascending) timeline, otherwise -1. Unlike
 * `nearestIndex` this never clamps or snaps — a missing timestamp is simply
 * absent, which is the semantics derived series (e.g. headroom/utilization
 * built from the exact intersection of two raw series) require so they are
 * reported only at timestamps where both inputs actually exist.
 */
export function exactIndex(timestamps: readonly number[], target: number): number {
  let lo = 0;
  let hi = timestamps.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const value = timestamps[mid]!;
    if (value === target) return mid;
    if (value < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * Binary search for the index of the timestamp nearest to `target`.
 * Ties resolve toward the earlier index; out-of-range targets clamp to the
 * first/last index; an empty timeline returns -1.
 */
export function nearestIndex(timestamps: readonly number[], target: number): number {
  const n = timestamps.length;
  if (n === 0) return -1;
  const first = timestamps[0]!;
  const last = timestamps[n - 1]!;
  if (target <= first) return 0;
  if (target >= last) return n - 1;

  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timestamps[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  const after = timestamps[lo]!;
  const before = timestamps[lo - 1]!;
  return target - before <= after - target ? lo - 1 : lo;
}

/**
 * Merge the timestamps of every series into one ascending, de-duplicated
 * timeline. Used to build the shared scrub axis across ragged series.
 */
export function mergeTimestamps(
  series: ReadonlyArray<{ points: readonly Point[] }>
): number[] {
  const seen = new Set<number>();
  const merged: number[] = [];
  for (const item of series) {
    for (const point of item.points) {
      if (!seen.has(point.timestamp)) {
        seen.add(point.timestamp);
        merged.push(point.timestamp);
      }
    }
  }
  merged.sort((a, b) => a - b);
  return merged;
}

/**
 * Min/max decimation: keeps at most `maxPoints` points while always preserving
 * the first and last point plus the minimum and maximum value of each interior
 * bucket. This keeps spikes and troughs that naive striding would drop, so a
 * downsampled render still hints at the true signal shape. Returns points in
 * source (time) order with their original indices.
 *
 * Budgets below four fall back to a small even selection: 1 -> first only,
 * 2 -> first + last, 3 -> first + middle + last.
 */
export function minMaxDecimate(points: readonly Point[], maxPoints: number): DecimatedPoint[] {
  const n = points.length;
  if (n === 0 || maxPoints <= 0) return [];
  if (n <= maxPoints) return points.map((point, index) => ({ ...point, index }));
  if (maxPoints === 1) return [{ ...points[0]!, index: 0 }];
  if (maxPoints === 2) {
    return [
      { ...points[0]!, index: 0 },
      { ...points[n - 1]!, index: n - 1 },
    ];
  }
  if (maxPoints === 3) {
    const middle = Math.floor((n - 1) / 2);
    return [
      { ...points[0]!, index: 0 },
      { ...points[middle]!, index: middle },
      { ...points[n - 1]!, index: n - 1 },
    ];
  }

  const bucketCount = Math.floor((maxPoints - 2) / 2);
  const interiorCount = n - 2;
  const result: DecimatedPoint[] = [{ ...points[0]!, index: 0 }];

  for (let b = 0; b < bucketCount; b += 1) {
    const start = 1 + Math.floor((b * interiorCount) / bucketCount);
    const end = 1 + Math.floor(((b + 1) * interiorCount) / bucketCount);
    if (start >= end) continue;
    let minIndex = start;
    let maxIndex = start;
    for (let i = start; i < end; i += 1) {
      const value = points[i]!.value;
      if (value < points[minIndex]!.value) minIndex = i;
      if (value > points[maxIndex]!.value) maxIndex = i;
    }
    const lo = Math.min(minIndex, maxIndex);
    const hi = Math.max(minIndex, maxIndex);
    if (lo === hi) {
      result.push({ ...points[lo]!, index: lo });
    } else {
      result.push({ ...points[lo]!, index: lo });
      result.push({ ...points[hi]!, index: hi });
    }
  }

  result.push({ ...points[n - 1]!, index: n - 1 });
  return result;
}
