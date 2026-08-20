/**
 * Pure, dependency-free tooltip model for telemetry charts. The tooltip is
 * bounded in pixels inside the chart. Callers may additionally cap the entry
 * list, but the default retains every available series and lets the bounded
 * scroll container make a large tooltip inspectable.
 */

export interface TooltipEntry {
  id: string;
  label: string;
  color?: string;
  value: number;
}

export interface TooltipModel {
  timestamp: number;
  entries: TooltipEntry[];
  truncated: boolean;
  omittedCount: number;
}

export interface TooltipSeriesValue {
  id: string;
  label: string;
  color?: string;
  /** null when the series has no point to report at the focus time. */
  value: number | null;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export interface PixelSize {
  width: number;
  height: number;
}

export const DEFAULT_MAX_TOOLTIP_ENTRIES = Number.MAX_SAFE_INTEGER;

/**
 * Build a tooltip model: only series with a value are included. When a caller
 * supplies `maxEntries`, truncation is reported explicitly.
 */
export function buildTooltipModel(
  timestamp: number,
  seriesValues: readonly TooltipSeriesValue[],
  maxEntries: number = DEFAULT_MAX_TOOLTIP_ENTRIES
): TooltipModel {
  const present = seriesValues.filter((item) => item.value !== null);
  const entries = present.slice(0, maxEntries).map((item) => ({
    id: item.id,
    label: item.label,
    color: item.color,
    value: item.value as number,
  }));
  return {
    timestamp,
    entries,
    truncated: present.length > maxEntries,
    omittedCount: Math.max(0, present.length - maxEntries),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface ClampedTooltip extends PixelPoint {
  /** true when the tooltip flipped to the left of the anchor. */
  flipped: boolean;
}

/**
 * Position a tooltip of `tooltipSize` near `anchor` so it always fits inside
 * `bounds`. Defaults to the right of the anchor and flips left on overflow,
 * then clamps both axes. `anchor.y` is treated as the desired vertical center.
 */
export function clampTooltipAnchor(
  anchor: PixelPoint,
  tooltipSize: PixelSize,
  bounds: PixelSize,
  gap = 12
): ClampedTooltip {
  let x = anchor.x + gap;
  let flipped = false;
  if (x + tooltipSize.width > bounds.width) {
    x = anchor.x - gap - tooltipSize.width;
    flipped = true;
  }
  const maxX = Math.max(0, bounds.width - tooltipSize.width);
  const maxY = Math.max(0, bounds.height - tooltipSize.height);
  x = clamp(x, 0, maxX);
  const y = clamp(anchor.y - tooltipSize.height / 2, 0, maxY);
  return { x, y, flipped };
}
