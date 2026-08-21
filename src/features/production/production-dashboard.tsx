import Link from "next/link";
import type { ProductionEnvelope } from "@/contracts/production-contracts";

interface ProductionDashboardProps {
  envelope: ProductionEnvelope;
  dataMode: "mock" | "live";
  search?: string;
  selectedItemKey?: string;
}

const formatRate = (value: number) => `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}/min`;
const formatPercent = (value: number) => `${value.toFixed(1)}%`;

export function ProductionDashboard({ envelope, dataMode, search = "", selectedItemKey }: ProductionDashboardProps) {
  const data = envelope.data;
  if (data === null || envelope.freshness.state === "unavailable") {
    return (
      <section className="panel unavailable-state production-state">
        <p className="eyebrow">Production / Source state</p>
        <h1>Production telemetry unavailable</h1>
        <p>The current FRM production source did not provide a usable snapshot. No item or history values have been inferred.</p>
      </section>
    );
  }

  const selected = selectedItemKey === undefined
    ? null
    : data.items.find((item) => item.itemKey === selectedItemKey) ?? null;
  const query = new URLSearchParams({ serverId: envelope.serverId });
  if (search) query.set("search", search);

  return (
    <div className="production-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations / Production</p>
          <h1>Production</h1>
          <p>Current item throughput, capacity, consumption, and explainable net balance.</p>
        </div>
        <div className="page-header__meta">
          <span className={`status-badge ${dataMode === "mock" ? "status-badge--mock" : "status-badge--live"}`}>
            {dataMode === "mock" ? "Mock telemetry" : "Live telemetry"}
          </span>
          <small>Current source only · {data.total} matching item{data.total === 1 ? "" : "s"}</small>
        </div>
      </header>

      <section className="panel production-search-panel" aria-label="Production item search">
        <form method="get" className="production-search-form">
          <input type="hidden" name="serverId" value={envelope.serverId} />
          <label htmlFor="production-search">Search normalized item</label>
          <div>
            <input id="production-search" name="search" defaultValue={search} maxLength={80} placeholder="Iron Rod" />
            <button type="submit">Search</button>
            {search ? <Link href={`/production?serverId=${encodeURIComponent(envelope.serverId)}`}>Clear</Link> : null}
          </div>
        </form>
        <p className="muted">History is not shown because a retained production series has not been observed at the pinned source checkpoint.</p>
      </section>

      {data.items.length === 0 ? (
        <section className="panel production-empty" role="status">
          <h2>No matching items</h2>
          <p className="muted">The current source returned a valid empty result for this bounded selection.</p>
        </section>
      ) : (
        <section className="panel production-table-panel">
          <div className="panel__heading">
            <div><p className="eyebrow">Current normalized items</p><h2>Throughput ledger</h2></div>
            <span className="status-badge status-badge--planned">History unsupported</span>
          </div>
          <div className="production-table-wrap">
            <table className="production-table">
              <caption className="sr-only">Current production and consumption by item</caption>
              <thead><tr><th scope="col">Item</th><th scope="col">Produced</th><th scope="col">Consumed</th><th scope="col">Net</th><th scope="col">Capacity</th><th scope="col">Provenance</th></tr></thead>
              <tbody>
                {data.items.map((item) => {
                  const itemQuery = new URLSearchParams({ serverId: envelope.serverId, itemKey: item.itemKey });
                  return (
                    <tr key={item.itemKey}>
                      <th scope="row"><Link href={`/production?${itemQuery}`}>{item.name}</Link><small>{item.form}</small></th>
                      <td>{formatRate(item.productionPerMinute)}<small>{formatPercent(item.productionEfficiencyPercent)} used</small></td>
                      <td>{formatRate(item.consumptionPerMinute)}<small>{formatPercent(item.consumptionEfficiencyPercent)} used</small></td>
                      <td className={item.netPerMinute < 0 ? "production-negative" : "production-positive"}>{formatRate(item.netPerMinute)}</td>
                      <td>{formatRate(item.maxProductionPerMinute)}<small>max production</small></td>
                      <td><span className="provenance-chip">{item.provenance.net}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selected ? (
        <section className="panel production-detail-panel" aria-label={`${selected.name} item detail`}>
          <div className="panel__heading"><div><p className="eyebrow">Item detail / {selected.itemKey}</p><h2>{selected.name}</h2></div><span className="status-badge status-badge--live">Current</span></div>
          <div className="production-detail-grid">
            <div><span>Current production</span><strong>{formatRate(selected.productionPerMinute)}</strong></div>
            <div><span>Current consumption</span><strong>{formatRate(selected.consumptionPerMinute)}</strong></div>
            <div><span>Net balance</span><strong className={selected.netPerMinute < 0 ? "production-negative" : "production-positive"}>{formatRate(selected.netPerMinute)}</strong></div>
            <div><span>Derived value</span><strong>{selected.provenance.net}</strong></div>
          </div>
          <p className="muted">The net balance is calculated as observed production minus observed consumption. It is not a retained historical trend.</p>
        </section>
      ) : null}
    </div>
  );
}
