"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  powerDetailsStreamSnapshotSchema,
  powerEnvelopeSchema,
  powerStreamSnapshotSchema,
  type PowerEnvelope,
} from "@/contracts/power-contracts";
import type {
  PowerBattery,
  PowerHistoryRange,
  PowerHistoryResolution,
  PowerHistorySeries,
} from "@/domain/power";
import {
  TelemetryTimeSeriesChart,
  type TelemetryPoint,
  type TelemetrySeries,
} from "@/components/telemetry-time-series-chart";

export interface PowerDashboardProps {
  envelope: PowerEnvelope;
  dataMode: "mock" | "live";
  streamEnabled?: boolean;
  selectedRange?: PowerHistoryRange;
  selectedResolution?: PowerHistoryResolution;
  selectedStartAt?: string;
  selectedEndAt?: string;
  sourceIntervalSeconds?: number;
}

const RANGES = ["15m", "1h", "6h", "24h", "7d", "15d", "ytd", "1y", "lifetime", "custom"] as const;
const RESOLUTIONS = ["auto", "5s", "15s", "30s", "1m", "2m", "5m", "10m", "15m", "1h"] as const;
const HISTORY_REFRESH_INTERVAL_MS: Record<PowerHistoryRange, number> = {
  "15m": 15_000,
  "1h": 15_000,
  "6h": 30_000,
  "24h": 60_000,
  "7d": 120_000,
  "15d": 300_000,
  ytd: 300_000,
  "1y": 300_000,
  lifetime: 300_000,
  custom: 15_000,
};

const formatGw = (mw: number) => `${(mw / 1000).toFixed(2)} GW`;
const formatMw = (mw: number) => `${mw.toLocaleString("en-US", { maximumFractionDigits: 1 })} MW`;
const formatPercent = (percent: number) => `${percent.toFixed(1)}%`;
const rangeLabel = (range: PowerHistoryRange) => ({
  "15m": "15m",
  "1h": "1h",
  "6h": "6h",
  "24h": "24h",
  "7d": "7d",
  "15d": "15d",
  ytd: "YTD",
  "1y": "1y",
  lifetime: "Lifetime",
  custom: "Custom",
}[range]);
const resolutionLabel = (resolution: PowerHistoryResolution) => resolution === "auto" ? "Auto" : resolution;
const formatDateInput = (value: string | undefined) => value?.replace(/Z$/, "").slice(0, 16) ?? "";
const seriesLabel = (series: PowerHistorySeries) => ({
  capacityMw: "Capacity",
  consumptionMw: "Consumption",
  correctedMaximumConsumptionMw: "Maximum demand",
}[series.key]);

const SERIES_COLORS: Record<PowerHistorySeries["key"], string> = {
  capacityMw: "#59d38c",
  consumptionMw: "#f47a24",
  correctedMaximumConsumptionMw: "#f2bd4d",
};

/** Floors seconds to whole minutes; <1h renders "42m", >=1h renders "1h 2m". */
function formatBatteryDuration(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours >= 1 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Chooses direction from the non-null estimate; empty wins when both exist. */
function batteryDurationLabel(battery: PowerBattery): string {
  if (battery.secondsToEmpty !== null) {
    return `${formatBatteryDuration(battery.secondsToEmpty)} to empty`;
  }
  if (battery.secondsToFull !== null) {
    return `${formatBatteryDuration(battery.secondsToFull)} to full`;
  }
  return "";
}

function formatBatteryCell(battery: PowerBattery): string {
  const base = `${battery.chargePercent.toFixed(0)}% · ${formatMw(battery.netFlowMw)}`;
  const duration = batteryDurationLabel(battery);
  return duration ? `${base} · ${duration}` : base;
}

function formatChartTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatObservedAt(timestamp: string | null): string {
  return timestamp
    ? `${new Date(timestamp).toLocaleString("en-US", { timeZone: "UTC" })} UTC`
    : "unknown";
}

/**
 * Translate history series into chart series. Base capacity/consumption/
 * corrected-maximum series are drawn; per-circuit headroom and utilization are
 * derived client-side from the exact intersection of capacity and consumption
 * timestamps and appear only in the tooltip (not as independent lines).
 *
 * Derived series are marked `sampleMode: "exact"` so the chart reports them
 * only at the shared timestamps they actually contain, while the raw series
 * keep nearest-point snapping. Exported as a pure helper so tests can assert
 * the transformation (and its exact-intersection semantics) directly.
 */
export function buildChartSeries(historySeries: PowerHistorySeries[]): TelemetrySeries[] {
  const base: TelemetrySeries[] = historySeries.map((item) => ({
    id: `${item.circuitId}:${item.key}`,
    label: `${seriesLabel(item)} · Circuit ${item.circuitId}`,
    color: SERIES_COLORS[item.key],
    points: item.points.map((point) => ({
      timestamp: Date.parse(point.timestamp),
      value: point.value,
    })),
    formatValue: formatMw,
  }));

  const byCircuit = new Map<
    string,
    { capacity?: PowerHistorySeries; consumption?: PowerHistorySeries }
  >();
  for (const item of historySeries) {
    let entry = byCircuit.get(item.circuitId);
    if (!entry) {
      entry = {};
      byCircuit.set(item.circuitId, entry);
    }
    if (item.key === "capacityMw") entry.capacity = item;
    else if (item.key === "consumptionMw") entry.consumption = item;
  }

  const derived: TelemetrySeries[] = [];
  for (const [circuitId, entry] of byCircuit) {
    const capacity = entry.capacity;
    const consumption = entry.consumption;
    if (!capacity || !consumption) continue;
    const consumptionByTime = new Map(
      consumption.points.map((point) => [Date.parse(point.timestamp), point.value])
    );
    const headroomPoints: TelemetryPoint[] = [];
    const utilizationPoints: TelemetryPoint[] = [];
    for (const point of capacity.points) {
      const timestamp = Date.parse(point.timestamp);
      const consumptionValue = consumptionByTime.get(timestamp);
      if (consumptionValue === undefined) continue;
      headroomPoints.push({ timestamp, value: point.value - consumptionValue });
      if (point.value > 0) {
        utilizationPoints.push({ timestamp, value: (consumptionValue / point.value) * 100 });
      }
    }
    if (headroomPoints.length > 0) {
      derived.push({
        id: `${circuitId}:headroomMw`,
        label: `Headroom · Circuit ${circuitId}`,
        points: headroomPoints,
        hidden: true,
        sampleMode: "exact",
        formatValue: formatMw,
      });
    }
    if (utilizationPoints.length > 0) {
      derived.push({
        id: `${circuitId}:utilizationPercent`,
        label: `Utilization · Circuit ${circuitId}`,
        points: utilizationPoints,
        hidden: true,
        sampleMode: "exact",
        formatValue: formatPercent,
      });
    }
  }

  return [...base, ...derived];
}

export function PowerDashboardLoading() {
  return (
    <section className="panel power-loading" role="status" aria-label="Loading power telemetry">
      <p className="eyebrow">Operations / Power</p>
      <h1>Loading power grid</h1>
      <p className="muted">Retrieving current and retained telemetry independently…</p>
    </section>
  );
}

export function PowerDashboard({
  envelope,
  dataMode,
  streamEnabled,
  selectedRange,
  selectedResolution,
  selectedStartAt,
  selectedEndAt,
  sourceIntervalSeconds,
}: PowerDashboardProps) {
  const [current, setCurrent] = useState(envelope.data.current);
  const [history, setHistory] = useState(envelope.data.history);
  const [currentFreshness, setCurrentFreshness] = useState(envelope.freshness.current);
  const [historyFreshness, setHistoryFreshness] = useState(envelope.freshness.history);
  const [refreshStatus, setRefreshStatus] = useState(
    streamEnabled === true
      ? "Connecting realtime"
      : streamEnabled === false
        ? "Polling fallback"
        : "Server snapshot"
  );
  const requestedRange = selectedRange ?? history?.coverage.requestedRange ?? "1h";
  const requestedResolution = selectedResolution ?? "auto";
  const historyRefreshIntervalMs = sourceIntervalSeconds === 5 &&
    (requestedRange === "15m" || requestedRange === "1h" || requestedRange === "custom")
    ? 5_000
    : HISTORY_REFRESH_INTERVAL_MS[requestedRange];
  const effectiveResolution = history?.coverage.effectiveResolution ?? "1m";
  // Both derivations depend only on the retained history series, so memoize
  // them on that reference: live current updates re-render the dashboard but
  // must not re-parse timestamps or rebuild/downsample the chart series.
  const historyPointCount = useMemo(
    () => history?.series.reduce((count, item) => count + item.points.length, 0) ?? 0,
    [history?.series]
  );
  const chartSeries = useMemo(
    () => buildChartSeries(history?.series ?? []),
    [history?.series]
  );
  const drawableSeries = chartSeries.filter((item) => !item.hidden && item.points.length >= 2);

  useEffect(() => {
    if (streamEnabled === undefined) return;

    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let historyTimer: ReturnType<typeof setInterval> | null = null;
    let failures = 0;

    const pollingParams = new URLSearchParams({
      serverId: envelope.serverId,
      range: requestedRange,
      resolution: requestedResolution,
    });
    if (selectedStartAt) pollingParams.set("startAt", selectedStartAt);
    if (selectedEndAt) pollingParams.set("endAt", selectedEndAt);
    const pollingUrl = `/api/v1/power?${pollingParams.toString()}`;

    const applyRefreshedEnvelope = (refreshed: PowerEnvelope) => {
      if (disposed) return;
      setCurrent(refreshed.data.current);
      setCurrentFreshness(refreshed.freshness.current);
      setHistory(refreshed.data.history);
      setHistoryFreshness(refreshed.freshness.history);
    };

    const refreshHistory = async () => {
      try {
        const response = await fetch(pollingUrl, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("power history refresh unavailable");
        const refreshed = powerEnvelopeSchema.parse(await response.json());
        if (refreshed.serverId !== envelope.serverId) {
          throw new Error("power history refresh server mismatch");
        }
        if (!disposed) {
          setHistory(refreshed.data.history);
          setHistoryFreshness(refreshed.freshness.history);
        }
      } catch {
        // Current realtime remains independent. The last retained result stays
        // rendered and its source freshness remains visible to the operator.
      }
    };

    const poll = async () => {
      try {
        const response = await fetch(pollingUrl, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("power refresh unavailable");
        const refreshed = powerEnvelopeSchema.parse(await response.json());
        if (refreshed.serverId !== envelope.serverId) {
          throw new Error("power refresh server mismatch");
        }
        if (!disposed) {
          applyRefreshedEnvelope(refreshed);
          setRefreshStatus("Polling fallback");
        }
      } catch {
        if (!disposed) setRefreshStatus("Polling degraded");
      }
    };

    const startPolling = () => {
      source?.close();
      source = null;
      if (historyTimer !== null) {
        clearInterval(historyTimer);
        historyTimer = null;
      }
      if (pollTimer !== null) return;
      void poll();
      pollTimer = setInterval(() => void poll(), 15_000);
    };

    const connect = () => {
      if (disposed || typeof EventSource === "undefined") {
        startPolling();
        return;
      }
      const candidate = new EventSource(
        `/api/v1/power/stream?serverId=${encodeURIComponent(envelope.serverId)}`
      );
      source = candidate;
      candidate.onopen = () => {
        if (disposed || source !== candidate) return;
        failures = 0;
        setRefreshStatus("Realtime live");
      };
      const fail = () => {
        if (disposed || source !== candidate) return;
        candidate.close();
        source = null;
        failures += 1;
        if (failures >= 3) {
          startPolling();
          return;
        }
        setRefreshStatus(`Reconnecting realtime (${failures}/3)`);
        const delayMs = Math.min(1_000 * 2 ** (failures - 1), 5_000);
        reconnectTimer = setTimeout(connect, delayMs);
      };
      candidate.onerror = fail;
      const applyPowerSnapshot = (value: unknown, closeOnInvalid: boolean) => {
        const parsed = powerStreamSnapshotSchema.safeParse(value);
        if (!parsed.success) {
          if (closeOnInvalid) fail();
          return false;
        }
        if (disposed || source !== candidate) return true;
        const snapshot = parsed.data;
        setCurrent((previous) => ({
          topologyState: snapshot.topologyState,
          totals: snapshot.totals,
          circuits: snapshot.circuits,
          generators: previous?.generators ?? { state: "unavailable", items: [] },
          majorConsumers: previous?.majorConsumers ?? { state: "unavailable", items: [] },
        }));
        setCurrentFreshness({ state: "live", observedAt: snapshot.observedAt });
        setRefreshStatus("Realtime live");
        return true;
      };

      const applyDetailsSnapshot = (value: unknown) => {
        if (disposed || source !== candidate) return false;
        const parsed = powerDetailsStreamSnapshotSchema.safeParse(value);
        if (!parsed.success) return false;
        setCurrent((previous) =>
          previous
            ? {
                ...previous,
                generators: parsed.data.generators,
                majorConsumers: parsed.data.majorConsumers,
              }
            : previous
        );
        setRefreshStatus("Realtime live");
        return true;
      };

      const parseEventData = (event: Event): unknown => {
        try {
          return JSON.parse((event as MessageEvent<string>).data);
        } catch {
          return undefined;
        }
      };

      candidate.addEventListener("power", (event) => {
        applyPowerSnapshot(parseEventData(event), true);
      });
      candidate.addEventListener("power-details", (event) => {
        // Detail telemetry is optional and independently degraded. A malformed
        // details event must never fail/close the healthy stream.
        applyDetailsSnapshot(parseEventData(event));
      });
      candidate.onmessage = (event) => {
        // Some reverse proxies preserve the SSE data field but drop `event:`.
        // Accept only the two public schemas so unrelated default messages are
        // ignored and a valid frame cannot be mistaken for the other stream.
        const value = parseEventData(event);
        if (applyPowerSnapshot(value, false)) return;
        applyDetailsSnapshot(value);
      };
    };

    if (streamEnabled) {
      connect();
      if (typeof EventSource !== "undefined") {
        historyTimer = setInterval(
          () => void refreshHistory(),
          historyRefreshIntervalMs
        );
      }
    } else startPolling();

    return () => {
      disposed = true;
      source?.close();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (pollTimer !== null) clearInterval(pollTimer);
      if (historyTimer !== null) clearInterval(historyTimer);
    };
  }, [
    envelope.serverId,
    requestedRange,
    requestedResolution,
    selectedStartAt,
    selectedEndAt,
    streamEnabled,
    historyRefreshIntervalMs,
  ]);
  const badge = dataMode === "mock" ? "Mock telemetry" :
    currentFreshness.state === "unavailable" || historyFreshness.state === "unavailable" ? "Degraded telemetry" : "Live telemetry";

  const coverageMessage = history?.coverage.state === "unsupported"
    ? history.coverage.reason === "retention-unavailable"
      ? `Not available under the current ${history.coverage.retentionHorizonDays}-day retention horizon`
      : history.coverage.reason === "source-fidelity-too-fine"
        ? `Resolution ${effectiveResolution} is finer than the configured history source cadence`
        : history.coverage.reason === "resolution-too-fine"
        ? `Resolution ${effectiveResolution} is too fine for this range; choose Auto or coarsen it`
        : history.coverage.reason === "custom-range-required"
          ? "Custom history requires both a start and end date"
          : "Custom history dates are invalid or outside the retained window"
    : history?.coverage.state === "partial"
      ? `Partial retained coverage · ${effectiveResolution} buckets · oldest point ${formatObservedAt(history.coverage.oldestSampleAt)}`
      : history?.coverage.state === "empty"
        ? `No retained points in this range · ${effectiveResolution} buckets`
        : history ? `Complete retained coverage · ${effectiveResolution} buckets` : null;
  const latestSampleMessage = history?.coverage.newestSampleAt
    ? ` · latest point ${formatObservedAt(history.coverage.newestSampleAt)}`
    : "";

  return (
    <div className="power-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations / Power</p>
          <h1>Power grid</h1>
          <p>Capacity, demand, reserve, batteries, and retention-aware history.</p>
        </div>
        <div className="page-header__meta">
          <span className={`status-badge ${dataMode === "mock" ? "status-badge--mock" : "status-badge--live"}`}>{badge}</span>
          <small>Current {currentFreshness.state} · History {historyFreshness.state}</small>
          <small>Current FRM observed {formatObservedAt(currentFreshness.observedAt)} · History source current {formatObservedAt(historyFreshness.observedAt)}</small>
          <small role="status" aria-label="Power refresh status">{refreshStatus}</small>
        </div>
      </header>

      {current && (current.totals.headroomMw < 0 || current.totals.fuseTriggered) ? (
        <section className="power-alert" role="alert">
          <strong>{current.totals.headroomMw < 0 ? "Grid overload" : "Fuse triggered"}</strong>
          <span>{current.totals.headroomMw < 0 ? `${current.totals.fuseTriggered ? "Fuse triggered. " : ""}Demand exceeds available capacity by ${formatMw(Math.abs(current.totals.headroomMw))}.` : "A source circuit reports a triggered fuse."}</span>
        </section>
      ) : null}

      {current ? (
        <>
          <section className="power-kpi-grid" aria-label="Power key performance indicators">
            {[
              ["Grid capacity", formatGw(current.totals.capacityMw), "Maximum available capacity"],
              ["Consumption", formatGw(current.totals.consumptionMw), "Current grid demand"],
              ["Headroom", formatGw(current.totals.headroomMw), "Capacity minus demand"],
              ["Utilization", current.totals.utilizationPercent === null ? "—" : `${current.totals.utilizationPercent.toFixed(1)}%`, "Demand divided by capacity"],
              ["Reported maximum demand", formatGw(current.totals.reportedMaximumConsumptionMw), "Current FRM-reported maximum"],
            ].map(([label, value, detail]) => (
              <article className="kpi-card" key={label}><p>{label}</p><strong>{value}</strong><span>{detail}</span></article>
            ))}
          </section>
          {current.topologyState === "no-circuits" ? (
            <section className="panel power-inline-state"><h2>No power circuits reported</h2><p className="muted">The source returned a valid empty circuit list. This is not treated as an outage.</p></section>
          ) : null}
        </>
      ) : (
        <section className="panel power-inline-state"><p className="eyebrow">FRM</p><h2>Current power unavailable</h2><p className="muted">Retained history remains independent and may still be available below.</p></section>
      )}

      <section className="panel power-history-panel">
        <div className="panel__heading power-history-heading">
          <div><p className="eyebrow">Retained telemetry</p><h2>Power history</h2></div>
          {coverageMessage ? <span className="power-coverage">{coverageMessage}{latestSampleMessage}</span> : null}
        </div>
        <div className="power-controls" aria-label="Power history controls">
          <div className="power-range" aria-label="History range">
            {RANGES.map((range) => (
              <a key={range} aria-current={requestedRange === range ? "page" : undefined} href={`?serverId=${encodeURIComponent(envelope.serverId)}&range=${range}&resolution=${requestedResolution}`}>{rangeLabel(range)}</a>
            ))}
          </div>
          <form method="get" className="power-resolution">
            <input type="hidden" name="serverId" value={envelope.serverId} />
            <input type="hidden" name="range" value={requestedRange} />
            <label htmlFor="power-resolution">Resolution</label>
            <select id="power-resolution" name="resolution" defaultValue={requestedResolution}>
              {RESOLUTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolutionLabel(resolution)}</option>)}
            </select>
            {requestedRange === "custom" ? <>
              <label htmlFor="power-history-start">Start</label>
              <input id="power-history-start" type="datetime-local" name="startAt" defaultValue={formatDateInput(selectedStartAt)} required />
              <label htmlFor="power-history-end">End</label>
              <input id="power-history-end" type="datetime-local" name="endAt" defaultValue={formatDateInput(selectedEndAt)} required />
            </> : null}
            <button type="submit">Apply</button>
          </form>
        </div>
        {!history ? (
          <div className="power-chart-empty"><h2>Power history unavailable</h2><p>Historical source unavailable. Current FRM data remains independent and visible above.</p></div>
        ) : history.coverage.state === "unsupported" ? (
          <div className="power-chart-empty"><h2>Requested history is not available</h2><p>{coverageMessage}</p><p>Choose Auto or a coarser resolution, or select a range within the current retention horizon.</p></div>
        ) : historyPointCount === 0 ? (
          <div className="power-chart-empty"><h2>No retained points</h2><p>The history source answered successfully but has no points for this range.</p></div>
        ) : (
          <>
            {drawableSeries.length > 0 ? (
              <>
                <TelemetryTimeSeriesChart
                  series={chartSeries}
                  height={240}
                  formatValue={formatMw}
                  formatTime={formatChartTime}
                  ariaLabel="Power history trend"
                  emptyLabel="No telemetry points"
                />
                <ul className="power-chart-legend">
                  {drawableSeries.map((item) => (
                    <li key={item.id} style={{ "--legend-color": item.color } as CSSProperties}>{item.label}</li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="power-chart-empty"><h2>{historyPointCount === 1 ? "One retained point" : "Retained points"}</h2><p>There are not yet enough points to draw a trend. Values remain available in the summary.</p></div>
            )}
            <div className="power-history-summary-wrap"><table className="power-history-summary" aria-label="Power history series summary"><thead><tr><th>Series</th><th>Circuit</th><th>Latest</th><th>Points</th></tr></thead><tbody>{history.series.map((item) => <tr key={`${item.key}:${item.circuitId}`}><th scope="row">{seriesLabel(item)}</th><td>Circuit {item.circuitId}</td><td>{item.points.length ? formatMw(item.points[item.points.length - 1]!.value) : "—"}</td><td>{item.points.length} {item.points.length === 1 ? "point" : "points"}</td></tr>)}</tbody></table></div>
          </>
        )}
        {history ? <p className="power-production-note">Historical production is not collected; charts show capacity, consumption, and corrected maximum demand only.</p> : null}
      </section>

      {current?.circuits.length ? (
        <section className="panel power-circuits-panel">
          <div className="panel__heading"><div><p className="eyebrow">Current topology</p><h2>Circuits</h2></div><span className="count-badge">{current.circuits.length}</span></div>
          <div className="power-table-wrap"><table className="power-table" aria-label="Current power circuits"><thead><tr><th>Circuit</th><th>Capacity</th><th>Demand</th><th>Headroom</th><th>Utilization</th><th>Battery</th><th>Fuse</th></tr></thead><tbody>{current.circuits.map((circuit) => <tr key={circuit.id}><th scope="row">{circuit.id}</th><td>{formatMw(circuit.capacityMw)}</td><td>{formatMw(circuit.consumptionMw)}</td><td>{formatMw(circuit.headroomMw)}</td><td>{circuit.utilizationPercent === null ? "—" : `${circuit.utilizationPercent.toFixed(1)}%`}</td><td>{circuit.battery ? formatBatteryCell(circuit.battery) : "Not reported"}</td><td><span className={`signal-pill ${circuit.fuseTriggered ? "signal-pill--bad" : "signal-pill--good"}`}>{circuit.fuseTriggered ? "Tripped" : "Ready"}</span></td></tr>)}</tbody></table></div>
        </section>
      ) : null}

      <section className="power-detail-grid" aria-label="Optional power details">
        <article className="panel">
          <p className="eyebrow">Generation</p>
          {current?.generators.state === "live" ? current.generators.items.length ? (
            <>
              <h2>Generator details</h2>
              <ul className="power-detail-list">
                {current.generators.items.map((item, index) => (
                  <li key={`${item.circuit.state}:${item.circuit.id}:${item.name}:${index}`}>
                    <strong>{item.name}</strong>
                    <span>
                      {item.circuit.state === "connected" ? `Circuit ${item.circuit.id}` : "Disconnected"} · {item.fuelInventory ? `${item.fuelInventory.name} inventory ${item.fuelInventory.amount.toLocaleString("en-US")} of ${item.fuelInventory.capacity.toLocaleString("en-US")}` : `${item.fuelType} · inventory not reported`} · {formatMw(item.productionCapacityMw)} capacity · {item.loadPercent.toFixed(1)}% load · {item.canStart ? "Can start" : "Cannot start"}{item.fuseTriggered ? " · Fuse tripped" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <><h2>No generators reported</h2><p className="muted">The generator source answered successfully with no records.</p></>
          ) : (
            <><h2>Generator details unavailable</h2><p className="muted">Generator detail telemetry is unavailable. Aggregate current power remains visible.</p></>
          )}
        </article>
        <article className="panel">
          <p className="eyebrow">Demand</p>
          {current?.majorConsumers.state === "live" ? current.majorConsumers.items.length ? (
            <>
              <h2>Major consumers</h2>
              <ul className="power-detail-list">
                {current.majorConsumers.items.map((item, index) => (
                  <li key={`${item.circuit.state}:${item.circuit.id}:${item.name}:${index}`}>
                    <strong>{item.name}</strong>
                    <span>{item.circuit.state === "connected" ? `Circuit ${item.circuit.id}` : "Disconnected"} · {formatMw(item.consumptionMw)} of {formatMw(item.maximumConsumptionMw)}{item.fuseTriggered ? " · Fuse tripped" : ""}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <><h2>No major consumers reported</h2><p className="muted">The consumer source answered successfully with no useful records.</p></>
          ) : (
            <><h2>Major-consumer details unavailable</h2><p className="muted">Consumer detail telemetry is unavailable. Aggregate current power remains visible.</p></>
          )}
        </article>
      </section>
    </div>
  );
}
