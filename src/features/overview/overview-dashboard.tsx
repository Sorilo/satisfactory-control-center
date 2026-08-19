import type { OverviewEnvelope, UnavailableSource } from "@/contracts/public-contracts";

export interface OverviewDashboardProps {
  envelope: OverviewEnvelope;
  dataMode: "mock" | "live";
}

const SOURCE_LABELS: Record<UnavailableSource, string> = {
  frm: "FRM", prometheus: "Prometheus", postgres: "PostgreSQL",
};

const formatGw = (mw: number) => `${(mw / 1000).toFixed(2)} GW`;
const formatUptime = (seconds: number) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
};

export function OverviewDashboard({ envelope, dataMode }: OverviewDashboardProps) {
  const data = envelope.data;
  if (data === null || envelope.freshness.state === "unavailable") {
    const sources = envelope.unavailableSources.map((source) => SOURCE_LABELS[source]).join(", ") || "realtime telemetry";
    return (
      <section className="panel unavailable-state">
        <p className="eyebrow">System state</p>
        <h1>Realtime telemetry unavailable</h1>
        <p>The control plane is healthy, but {sources} could not provide a current snapshot.</p>
        <p className="muted">No empty-world assumptions have been made. Retry after checking the upstream service.</p>
      </section>
    );
  }

  const badge = dataMode === "mock" ? "Mock telemetry" : envelope.freshness.state === "stale" ? "Stale telemetry" : "Live telemetry";
  const attentionItems = data.progress?.items.map((item) => ({ ...item, remaining: Math.max(0, item.required - item.delivered) })) ?? [];
  const kpis = [
    ["Power headroom", data.power ? formatGw(data.power.headroomMw) : "—", "Reserve before capacity"],
    ["Power capacity", data.power ? formatGw(data.power.capacityMw) : "—", "Maximum grid capacity"],
    ["Power consumption", data.power ? formatGw(data.power.consumptionMw) : "—", "Current grid demand"],
    ["Power utilization", data.power?.utilizationPercent === null || !data.power ? "—" : `${data.power.utilizationPercent.toFixed(1)}%`, "Consumption divided by capacity"],
    ["Machines producing", `${data.factory.producingCount} / ${data.factory.machineCount}`, "Active factory equipment"],
    ["Average efficiency", data.factory.averageEfficiencyPercent === null ? "—" : `${data.factory.averageEfficiencyPercent.toFixed(1)}%`, "Across known machines"],
    ["Players online", String(data.players.online), data.players.online ? "Current session roster" : "No players online"],
  ] as const;

  return (
    <div className="overview-stack">
      <header className="page-header">
        <div><p className="eyebrow">Operations / Overview</p><h1>Factory overview</h1><p>Current operating state and the next items that need attention.</p></div>
        <div className="page-header__meta"><span className={`status-badge ${dataMode === "mock" ? "status-badge--mock" : "status-badge--live"}`}>{badge}</span><small>Observed {new Date(envelope.freshness.observedAt ?? envelope.generatedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC</small></div>
      </header>

      <section className="kpi-grid" aria-label="Factory key performance indicators">
        {kpis.map(([label, value, detail]) => <article className="kpi-card" key={label}><p>{label}</p><strong>{value}</strong><span>{detail}</span></article>)}
      </section>

      <section className="overview-grid">
        <article className="panel session-panel"><div className="panel__heading"><div><p className="eyebrow">Current session</p><h2>{data.session?.name ?? "Session not reported"}</h2></div><span className={`signal-pill ${data.server.online ? "signal-pill--good" : "signal-pill--bad"}`}>{data.server.online ? "Online" : "Offline"}</span></div><div className="session-stats"><div><span>Uptime</span><strong>{data.session ? formatUptime(data.session.uptimeSeconds) : "—"}</strong></div><div><span>State</span><strong>{data.session?.paused ? "Paused" : "Running"}</strong></div><div><span>Players</span><strong>{data.players.online}</strong></div></div><p className="player-roster">{data.players.online ? data.players.names.join(", ") : "No players online"}</p></article>

        <article className="panel attention-panel"><div className="panel__heading"><div><p className="eyebrow">Priorities</p><h2>Needs attention</h2></div><span className="count-badge">{attentionItems.length}</span></div>{attentionItems.length ? <ul className="attention-list">{attentionItems.map((item) => <li key={item.name}><div><strong>{item.name}</strong><span>{item.delivered.toLocaleString("en-US")} of {item.required.toLocaleString("en-US")} delivered</span></div><b>{item.remaining.toLocaleString("en-US")} remaining</b><progress aria-label={`${item.name}: ${item.delivered} of ${item.required} delivered`} value={item.delivered} max={item.required}>{item.delivered}/{item.required}</progress></li>)}</ul> : <p className="muted">No active deliveries.</p>}</article>
      </section>
    </div>
  );
}
