"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import {
  buildTooltipModel,
  clampTooltipAnchor,
  type PixelSize,
  type TooltipSeriesValue,
} from "./bounded-tooltip";
import { exactIndex, mergeTimestamps, minMaxDecimate, nearestIndex } from "./downsample";

export interface TelemetryPoint {
  /** Epoch milliseconds; each series must be sorted ascending by this field. */
  timestamp: number;
  value: number;
}

export interface TelemetrySeries {
  id: string;
  label: string;
  points: TelemetryPoint[];
  color?: string;
  /**
   * Optional per-series value formatter. When present it overrides the
   * component-level `formatValue` for this series in the tooltip and the
   * screen-reader text, so mixed-unit charts (MW, percent) format cleanly.
   */
  formatValue?: (value: number) => string;
  /**
   * When true the series still contributes its values to the tooltip and
   * accessible text but is not drawn as a line. Useful for client-derived
   * values (e.g. headroom/utilization) that have no independent trend line.
   */
  hidden?: boolean;
  /**
   * How tooltip and marker lookups resolve a focus timestamp against this
   * series' points. `nearest` (default) snaps to the closest full-data point,
   * which is correct for raw telemetry. `exact` only reports a value when the
   * focus timestamp is actually present, so derived series built from the
   * exact intersection of two raw series are omitted at non-intersections
   * instead of fabricating a value.
   */
  sampleMode?: "nearest" | "exact";
}

export interface TelemetryTimeSeriesChartProps {
  series: TelemetrySeries[];
  width?: number;
  height?: number;
  /**
   * Per-series render budget for min/max decimation. Only the drawn path is
   * downsampled; tooltip and scrub lookups always run against the full data.
   */
  maxRenderPoints?: number;
  /** Delegated value formatting (keeps the component domain-agnostic). */
  formatValue?: (value: number) => string;
  formatTime?: (timestamp: number) => string;
  ariaLabel?: string;
  emptyLabel?: string;
  /** Cap for how many series appear in the tooltip. */
  maxTooltipEntries?: number;
}

const PAD = { top: 12, right: 16, bottom: 20, left: 48 } as const;
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 300;
const DEFAULT_MAX_RENDER_POINTS = 1_000;
const DEFAULT_ARIA_LABEL = "Telemetry time series chart";
const DEFAULT_EMPTY_LABEL = "No telemetry samples";
const TOOLTIP_SIZE = { width: 240, height: 132 };
const TOOLTIP_GAP = 12;

function defaultFormatValue(value: number): string {
  return String(value);
}

function defaultFormatTime(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

interface Layout {
  minTime: number;
  maxTime: number;
  timeline: number[];
  x: (timestamp: number) => number;
  y: (value: number) => number;
}

interface FocusState {
  index: number;
  timestamp: number;
  x: number;
  tooltip: ReturnType<typeof buildTooltipModel>;
  tooltipPosition: ReturnType<typeof clampTooltipAnchor>;
  tooltipSize: PixelSize;
  markers: Array<{ id: string; color?: string; x: number; y: number }>;
  valueText: string;
}

export function TelemetryTimeSeriesChart({
  series,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  maxRenderPoints = DEFAULT_MAX_RENDER_POINTS,
  formatValue = defaultFormatValue,
  formatTime = defaultFormatTime,
  ariaLabel = DEFAULT_ARIA_LABEL,
  emptyLabel = DEFAULT_EMPTY_LABEL,
  maxTooltipEntries,
}: TelemetryTimeSeriesChartProps) {
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);

  // Keep the rendered SVG 1:1 with its container so tooltip pixel clamping
  // and pointer scrubbing share one coordinate space. The `width` prop acts as
  // the logical fallback until the container is measurable (SSR / first paint).
  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0) setMeasuredWidth(Math.floor(rect.width));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const effectiveWidth = measuredWidth ?? width;

  const layout = useMemo<Layout | null>(() => {
    let minTime = Number.POSITIVE_INFINITY;
    let maxTime = Number.NEGATIVE_INFINITY;
    let minValue = Number.POSITIVE_INFINITY;
    let maxValue = Number.NEGATIVE_INFINITY;
    let pointCount = 0;
    for (const item of series) {
      if (item.hidden === true) continue;
      for (const point of item.points) {
        minTime = Math.min(minTime, point.timestamp);
        maxTime = Math.max(maxTime, point.timestamp);
        minValue = Math.min(minValue, point.value);
        maxValue = Math.max(maxValue, point.value);
        pointCount += 1;
      }
    }
    if (pointCount === 0) return null;
    const timeSpan = Math.max(1, maxTime - minTime);
    const valueSpan = Math.max(1, maxValue - minValue);
    const innerWidth = effectiveWidth - PAD.left - PAD.right;
    const innerHeight = height - PAD.top - PAD.bottom;
    return {
      minTime,
      maxTime,
      timeline: mergeTimestamps(series),
      x: (timestamp) => PAD.left + ((timestamp - minTime) / timeSpan) * innerWidth,
      y: (value) => height - PAD.bottom - ((value - minValue) / valueSpan) * innerHeight,
    };
  }, [series, effectiveWidth, height]);

  const indexedSeries = useMemo(
    () =>
      series.map((item) => ({
        id: item.id,
        label: item.label,
        color: item.color,
        hidden: item.hidden === true,
        sampleMode: item.sampleMode === "exact" ? "exact" : "nearest",
        formatValue: item.formatValue ?? formatValue,
        timestamps: item.points.map((point) => point.timestamp),
        values: item.points.map((point) => point.value),
      })),
    [series, formatValue]
  );

  const formatValueById = useMemo(() => {
    const map = new Map<string, (value: number) => string>();
    for (const item of indexedSeries) map.set(item.id, item.formatValue);
    return map;
  }, [indexedSeries]);

  const renderedSeries = useMemo(() => {
    if (layout === null) return [];
    return series
      .filter((item) => item.hidden !== true)
      .map((item) => {
        const decimated = minMaxDecimate(item.points, maxRenderPoints);
        const d = decimated
          .map((point, index) => {
            const command = index === 0 ? "M" : "L";
            return `${command}${layout.x(point.timestamp).toFixed(1)},${layout.y(point.value).toFixed(1)}`;
          })
          .join(" ");
        return { id: item.id, label: item.label, color: item.color, d };
      });
  }, [series, layout, maxRenderPoints]);

  const focus = useMemo<FocusState | null>(() => {
    if (layout === null || focusIndex === null) return null;
    const timestamp = layout.timeline[focusIndex];
    if (timestamp === undefined) return null;

    // Derived (`exact`) series must report only at timestamps they actually
    // contain; raw series keep nearest-point snapping.
    const resolveIndex = (item: (typeof indexedSeries)[number]): number =>
      item.sampleMode === "exact"
        ? exactIndex(item.timestamps, timestamp)
        : nearestIndex(item.timestamps, timestamp);

    const snapshots: TooltipSeriesValue[] = indexedSeries.map((item) => {
      const index = resolveIndex(item);
      return {
        id: item.id,
        label: item.label,
        color: item.color,
        value: index < 0 ? null : item.values[index] ?? null,
      };
    });

    const tooltip = buildTooltipModel(timestamp, snapshots, maxTooltipEntries);
    const markerX = layout.x(timestamp);
    const markers = indexedSeries
      .filter((item) => !item.hidden)
      .map((item) => {
        const index = resolveIndex(item);
        const value = index < 0 ? undefined : item.values[index];
        if (value === undefined) return null;
        return {
          id: item.id,
          color: item.color,
          x: markerX,
          y: layout.y(value),
        };
      })
      .filter((marker): marker is NonNullable<typeof marker> => marker !== null);

    // Narrow plots are narrower than the default tooltip; clamp the tooltip
    // width to the actual plot width so it always fits inside the bounds.
    const tooltipSize: PixelSize = {
      width: Math.min(TOOLTIP_SIZE.width, effectiveWidth),
      height: TOOLTIP_SIZE.height,
    };
    const tooltipPosition = clampTooltipAnchor(
      { x: markerX, y: PAD.top + (height - PAD.top - PAD.bottom) / 2 },
      tooltipSize,
      { width: effectiveWidth, height },
      TOOLTIP_GAP
    );

    const entriesText = tooltip.entries
      .map((entry) => {
        const format = formatValueById.get(entry.id) ?? formatValue;
        return `${entry.label} ${format(entry.value)}`;
      })
      .join(", ");
    const valueText = `${formatTime(timestamp)}: ${entriesText}${
      tooltip.truncated ? ` (+${tooltip.omittedCount} more)` : ""
    }`;

    return {
      index: focusIndex,
      timestamp,
      x: markerX,
      tooltip,
      tooltipPosition,
      tooltipSize,
      markers,
      valueText,
    };
  }, [
    layout,
    focusIndex,
    indexedSeries,
    formatValueById,
    formatValue,
    maxTooltipEntries,
    effectiveWidth,
    height,
    formatTime,
  ]);

  const moveToTime = (clientX: number, element: HTMLElement): void => {
    if (layout === null) return;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const viewX = ((clientX - rect.left) / rect.width) * effectiveWidth;
    const clampedX = Math.min(Math.max(viewX, PAD.left), effectiveWidth - PAD.right);
    const ratio = (clampedX - PAD.left) / (effectiveWidth - PAD.left - PAD.right);
    const target = layout.minTime + ratio * (layout.maxTime - layout.minTime);
    const index = nearestIndex(layout.timeline, target);
    if (index >= 0) setFocusIndex(index);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    moveToTime(event.clientX, event.currentTarget);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    draggingRef.current = true;
    const target = event.currentTarget;
    if (typeof target.setPointerCapture === "function") {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is optional; move handlers still drive focus.
      }
    }
    moveToTime(event.clientX, target);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    draggingRef.current = false;
    const target = event.currentTarget;
    if (typeof target.hasPointerCapture === "function" && target.hasPointerCapture(event.pointerId)) {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore release failures.
      }
    }
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>): void => {
    // The browser can cancel a pointer (touch scroll takeover, gesture). Clear
    // the drag latch and release capture exactly like pointerup, but leave the
    // focused tooltip in place so a cancelled touch does not blank the tap it
    // already opened.
    draggingRef.current = false;
    const target = event.currentTarget;
    if (typeof target.hasPointerCapture === "function" && target.hasPointerCapture(event.pointerId)) {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore release failures.
      }
    }
  };

  const handlePointerLeave = (event: PointerEvent<HTMLDivElement>): void => {
    // Touch pointers are removed from the element right after pointerup, so a
    // tap would otherwise clear the tooltip it just opened. Only a mouse
    // leaving the plot clears hover focus.
    if (!draggingRef.current && event.pointerType !== "touch") setFocusIndex(null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (layout === null) return;
    const lastIndex = layout.timeline.length - 1;
    if (lastIndex < 0) return;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = focusIndex === null ? 0 : Math.min(focusIndex + 1, lastIndex);
        break;
      case "ArrowLeft":
        next = focusIndex === null ? lastIndex : Math.max(focusIndex - 1, 0);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = lastIndex;
        break;
      default:
        return;
    }
    event.preventDefault();
    setFocusIndex(next);
  };

  if (layout === null) {
    // A live region announces the visible empty label instead of a chart image
    // that would swallow its text (and re-state the group label via aria-label).
    return (
      <div className="ttsc ttsc--empty" role="status">
        <p className="ttsc__empty">{emptyLabel}</p>
      </div>
    );
  }

  const sliderValue = focusIndex ?? 0;
  const sliderValueText = focus?.valueText ?? "No point selected";

  return (
    <div className="ttsc" role="group" aria-label={ariaLabel}>
      <div
        ref={plotRef}
        className="ttsc__plot"
        style={{ position: "relative", width: "100%", height }}
      >
        <svg
          className="ttsc__svg"
          viewBox={`0 0 ${effectiveWidth} ${height}`}
          width={effectiveWidth}
          height={height}
          aria-hidden="true"
          focusable="false"
        >
          <g className="ttsc__grid">
            {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
              const y = PAD.top + fraction * (height - PAD.top - PAD.bottom);
              return (
                <line
                  key={fraction}
                  x1={PAD.left}
                  x2={effectiveWidth - PAD.right}
                  y1={y}
                  y2={y}
                />
              );
            })}
          </g>
          {renderedSeries.map((item) =>
            item.d ? (
              <path
                key={item.id}
                className="ttsc__line"
                d={item.d}
                fill="none"
                stroke={item.color ?? "currentColor"}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            ) : null
          )}
          {focus ? (
            <>
              <line
                className="ttsc__crosshair"
                x1={focus.x}
                x2={focus.x}
                y1={PAD.top}
                y2={height - PAD.bottom}
              />
              {focus.markers.map((marker) => (
                <circle
                  key={marker.id}
                  className="ttsc__marker"
                  cx={marker.x}
                  cy={marker.y}
                  r={3.5}
                  fill={marker.color ?? "currentColor"}
                  stroke="#fff"
                  strokeWidth={1}
                />
              ))}
            </>
          ) : null}
        </svg>

        <div
          className="ttsc__slider"
          role="slider"
          tabIndex={0}
          aria-label="Scrub telemetry timeline"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, layout.timeline.length - 1)}
          aria-valuenow={sliderValue}
          aria-valuetext={sliderValueText}
          onKeyDown={handleKeyDown}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerLeave}
          style={{ position: "absolute", inset: 0, touchAction: "pan-y", cursor: "ew-resize" }}
        />

        {focus ? (
          <div
            className="ttsc__tooltip"
            aria-hidden="true"
            style={{
              position: "absolute",
              left: focus.tooltipPosition.x,
              top: focus.tooltipPosition.y,
              width: focus.tooltipSize.width,
              pointerEvents: "none",
            }}
          >
            <time
              className="ttsc__tooltip-time"
              dateTime={new Date(focus.timestamp).toISOString()}
            >
              {formatTime(focus.timestamp)}
            </time>
            <ul className="ttsc__tooltip-list">
              {focus.tooltip.entries.map((entry) => (
                <li key={entry.id} className="ttsc__tooltip-entry">
                  <span
                    className="ttsc__tooltip-swatch"
                    style={{ background: entry.color ?? "currentColor" }}
                    aria-hidden="true"
                  />
                  <span className="ttsc__tooltip-label">{entry.label}</span>
                  <strong className="ttsc__tooltip-value">
                    {(formatValueById.get(entry.id) ?? formatValue)(entry.value)}
                  </strong>
                </li>
              ))}
            </ul>
            {focus.tooltip.truncated ? (
              <p className="ttsc__tooltip-more">+{focus.tooltip.omittedCount} more series</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
