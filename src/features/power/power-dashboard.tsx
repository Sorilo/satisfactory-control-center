"use client";

import { useEffect, useState } from "react";
import {
  powerEnvelopeSchema,
  powerStreamSnapshotSchema,
  type PowerEnvelope,
} from "@/contracts/power-contracts";
import type {
  PowerHistoryRange,
  PowerHistoryResolution,
  PowerHistorySeries,
} from "@/domain/power";

export interface PowerDashboardProps {
  envelope: PowerEnvelope;
  dataMode: "mock" | "live";
  streamEnabled?: boolean;
  selectedRange?: PowerHistoryRange;
  selectedResolution?: PowerHistoryResolution;
}

const RANGES = ["1h", "6h", "24h", "7d", "15d"] as const;
const RESOLUTIONS = ["auto", "1m", "5m", "15m", "1h"] as const;

const formatGw = (mw: number) => `${(mw / 1000).toFixed(2)} GW`;
const formatMw = (mw: number) => `${mw.toLocaleString("en-US", { maximumFractionDigits: 1 })} MW`;
const seriesLabel = (series: PowerHistorySeries) => ({
  capacityMw: "Capacity",
  consumptionMw: "Consumption",
  correctedMaximumConsumptionMw: "Maximum demand",
}[series.key]);

function historyPaths(series: PowerHistorySeries[]): Array<{ label: string; className: string; d: string }> {
  let pointCount = 0;
  let minTime = Number.POSITIVE_INFINITY;
  let maxTime = Number.NEGATIVE_INFINITY;
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const item of series) {
    for (const point of item.points) {
      const time = Date.parse(point.timestamp);
      pointCount += 1;
      minTime = Math.min(minTime, time);
      maxTime = Math.max(maxTime, time);
      minValue = Math.min(minValue, point.value);
      maxValue = Math.max(maxValue, point.value);
    }
  }
  if (pointCount < 2) return [];
  const timeSpan = Math.max(1, maxTime - minTime);
  const valueSpan = Math.max(1, maxValue - minValue);
  return series
    .filter((item) => item.points.length > 1)
    .map((item) => ({
      label: `${seriesLabel(item)} · Circuit ${item.circuitId}`,
      className: `power-chart__line power-chart__line--${item.key}`,
      d: item.points.map((point, index) => {
        const x = 24 + ((Date.parse(point.timestamp) - minTime) / timeSpan) * 752;
        const y = 196 - ((point.value - minValue) / valueSpan) * 164;
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(" "),
    }));
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
}: PowerDashboardProps) {
  const [current, setCurrent] = useState(envelope.data.current);
  const [refreshStatus, setRefreshStatus] = useState(
    streamEnabled === true
      ? "Connecting realtime"
      : streamEnabled === false
        ? "Polling fallback"
        : "Server snapshot"
  );
  const history = envelope.data.history;
  const requestedRange = selectedRange ?? history?.coverage.requestedRange ?? "1h";
  const requestedResolution = selectedResolution ?? "auto";
  const effectiveResolution = history?.coverage.effectiveResolution ?? "1m";
  const chartPaths = historyPaths(history?.series ?? []);
  const historyPointCount = history?.series.reduce((count, item) => count + item.points.length, 0) ?? 0;

  useEffect(() => {
    if (streamEnabled === undefined) return;

    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let failures = 0;

    const pollingUrl = `/api/v1/power?serverId=${encodeURIComponent(envelope.serverId)}&range=${requestedRange}&resolution=${requestedResolution}`;

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
        if (!disposed && refreshed.data.current) {
          setCurrent(refreshed.data.current);
          setRefreshStatus("Polling fallback");
        }
      } catch {
        if (!disposed) setRefreshStatus("Polling degraded");
      }
    };

    const startPolling = () => {
      source?.close();
      source = null;
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
      candidate.addEventListener("power", (event) => {
        try {
          const message = event as MessageEvent<string>;
          const snapshot = powerStreamSnapshotSchema.parse(JSON.parse(message.data));
          if (disposed || source !== candidate) return;
          setCurrent((previous) => ({
            topologyState: snapshot.topologyState,
            totals: snapshot.totals,
            circuits: snapshot.circuits,
            generators: previous?.generators ?? { state: "unavailable", items: [] },
            majorConsumers: previous?.majorConsumers ?? { state: "unavailable", items: [] },
          }));
          setRefreshStatus("Realtime live");
        } catch {
          fail();
        }
      });
    };

    if (streamEnabled) connect();
    else startPolling();

    return () => {
      disposed = true;
      source?.close();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (pollTimer !== null) clearInterval(pollTimer);
    };
  }, [
    envelope.serverId,
    requestedRange,
    requestedResolution,
    streamEnabled,
  ]);
  const badge = dataMode === "mock" ? "Mock telemetry" :
    envelope.freshness.current.state === "unavailable" || envelope.freshness.history.state === "unavailable" ? "Degraded telemetry" : "Live telemetry";

  const coverageMessage = history?.coverage.state === "partial"
    ? `Partial retained coverage · ${effectiveResolution} buckets · oldest sample ${history.coverage.oldestSampleAt ? new Date(history.coverage.oldestSampleAt).toLocaleString("en-US", { timeZone: "UTC" }) : "unknown"} UTC`
    : history?.coverage.state === "empty"
      ? `No retained samples in this range · ${effectiveResolution} buckets`
      : history ? `Complete retained coverage · ${effectiveResolution} buckets` : null;

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
          <small>Current {envelope.freshness.current.state} · History {envelope.freshness.history.state}</small>
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
          {coverageMessage ? <span className="power-coverage">{coverageMessage}</span> : null}
        </div>
        <div className="power-controls" aria-label="Power history controls">
          <div className="power-range" aria-label="History range">
            {RANGES.map((range) => (
              <a key={range} aria-current={requestedRange === range ? "page" : undefined} href={`?serverId=${encodeURIComponent(envelope.serverId)}&range=${range}&resolution=${requestedResolution}`}>{range}</a>
            ))}
          </div>
          <form method="get" className="power-resolution">
            <input type="hidden" name="serverId" value={envelope.serverId} />
            <input type="hidden" name="range" value={requestedRange} />
            <label htmlFor="power-resolution">Resolution</label>
            <select id="power-resolution" name="resolution" defaultValue={requestedResolution}>
              {RESOLUTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
            </select>
            <button type="submit">Apply</button>
          </form>
        </div>
        {!history ? (
          <div className="power-chart-empty"><h2>Power history unavailable</h2><p>Historical source unavailable. Current FRM data remains independent and visible above.</p></div>
        ) : historyPointCount > 0 ? (
          <>
            {chartPaths.length ? <>
              <svg className="power-chart" viewBox="0 0 800 220" role="img" aria-label="Power history trend">
                <g className="power-chart__grid" aria-hidden="true">
                  {[32, 73, 114, 155, 196].map((y) => <line key={y} x1="24" x2="776" y1={y} y2={y} />)}
                </g>
                {chartPaths.map((path) => <path key={path.label} className={path.className} d={path.d} vectorEffect="non-scaling-stroke" />)}
              </svg>
              <ul className="power-chart-legend">{chartPaths.map((path) => <li key={path.label}>{path.label}</li>)}</ul>
            </> : <div className="power-chart-empty"><h2>{historyPointCount === 1 ? "One retained sample" : "Retained samples"}</h2><p>There are not yet enough points to draw a trend. Values remain available in the summary.</p></div>}
            <div className="power-history-summary-wrap"><table className="power-history-summary" aria-label="Power history series summary"><thead><tr><th>Series</th><th>Circuit</th><th>Latest</th><th>Samples</th></tr></thead><tbody>{history.series.map((item) => <tr key={`${item.key}:${item.circuitId}`}><th scope="row">{seriesLabel(item)}</th><td>Circuit {item.circuitId}</td><td>{item.points.length ? formatMw(item.points[item.points.length - 1]!.value) : "—"}</td><td>{item.points.length} {item.points.length === 1 ? "sample" : "samples"}</td></tr>)}</tbody></table></div>
          </>
        ) : (
          <div className="power-chart-empty"><h2>No retained samples</h2><p>The history source answered successfully but has no samples for this range.</p></div>
        )}
        {history ? <p className="power-production-note">Historical production is not collected; charts show capacity, consumption, and corrected maximum demand only.</p> : null}
      </section>

      {current?.circuits.length ? (
        <section className="panel power-circuits-panel">
          <div className="panel__heading"><div><p className="eyebrow">Current topology</p><h2>Circuits</h2></div><span className="count-badge">{current.circuits.length}</span></div>
          <div className="power-table-wrap"><table className="power-table" aria-label="Current power circuits"><thead><tr><th>Circuit</th><th>Capacity</th><th>Demand</th><th>Headroom</th><th>Utilization</th><th>Battery</th><th>Fuse</th></tr></thead><tbody>{current.circuits.map((circuit) => <tr key={circuit.id}><th scope="row">{circuit.id}</th><td>{formatMw(circuit.capacityMw)}</td><td>{formatMw(circuit.consumptionMw)}</td><td>{formatMw(circuit.headroomMw)}</td><td>{circuit.utilizationPercent === null ? "—" : `${circuit.utilizationPercent.toFixed(1)}%`}</td><td>{circuit.battery ? `${circuit.battery.chargePercent.toFixed(0)}% · ${formatMw(circuit.battery.netFlowMw)}` : "Not reported"}</td><td><span className={`signal-pill ${circuit.fuseTriggered ? "signal-pill--bad" : "signal-pill--good"}`}>{circuit.fuseTriggered ? "Tripped" : "Ready"}</span></td></tr>)}</tbody></table></div>
        </section>
      ) : null}

      <section className="power-detail-grid" aria-label="Optional power details">
        <article className="panel"><p className="eyebrow">Generation</p>{current?.generators.state === "live" ? <><h2>Generator details</h2><ul className="power-detail-list">{current.generators.items.map((item) => <li key={item.name}><strong>{item.name}</strong><span>{item.fuelType ?? "Fuel not reported"} · {formatMw(item.productionCapacityMw)} capacity · {item.loadPercent.toFixed(1)}% load</span></li>)}</ul></> : <><h2>Generator details unavailable</h2><p className="muted">No reviewed generator payload fixture is available, so no generator records are inferred.</p></>}</article>
        <article className="panel"><p className="eyebrow">Demand</p>{current?.majorConsumers.state === "live" ? <><h2>Major consumers</h2><ul className="power-detail-list">{current.majorConsumers.items.map((item) => <li key={`${item.circuitId}:${item.name}`}><strong>{item.name}</strong><span>Circuit {item.circuitId} · {formatMw(item.consumptionMw)} of {formatMw(item.maximumConsumptionMw)}</span></li>)}</ul></> : <><h2>Major-consumer details unavailable</h2><p className="muted">No reviewed consumer payload fixture is available, so no consumer records are inferred.</p></>}</article>
      </section>
    </div>
  );
}
