# ADR-004: Constrained historical queries

**Status:** Accepted; Slice 2 RC.4 source-cadence correction defined 2026-08-20

## Decision

Prometheus and any later PostgreSQL integration are accessed through named domain/provider methods with fixed server-owned query templates, bounded parameters, timeouts, response-byte limits, series/point limits, and explicit schemas. Arbitrary PromQL, SQL, metric selection, label selection, or upstream URLs are rejected.

Slice 2 power history uses Prometheus only:

- demand: `power_consumed`
- maximum demand: Companion-corrected `power_max_consumed`
- capacity: `power_capacity`
- the existing `power_consumed_overhead_or_max_consumed:min6h` recording rule only as an explicitly labeled operational threshold

Existing Prometheus contains no current-production gauge because Companion omits FRM `PowerProduction`; historical production remains unavailable. Capacity must not be substituted for production.

Companion source documents battery/fuse gauges, but Task 0 observed only `power_capacity`, `power_consumed`, and `power_max_consumed` in the deployed metric set. Battery/fuse history is an optional capability, not an initial contract: it remains unavailable unless runtime metric discovery proves the required series for the selected server/session.

Public history requests can choose only an opaque server ID and allowlisted range/resolution values up to the deployed 15-day retention horizon. The server resolves private `url`, sanitized `session_name`, and circuit selectors. Responses contain normalized timestamps/values, coverage, and freshness/source availability only—not selectors, metric names, PromQL, datasource IDs, or upstream error text. Requests beyond 15 days are rejected as outside retained history; in-range partial or empty series are represented distinctly from source failure.

## PostgreSQL boundary

frmcache does not poll `getPower`; its history table retains roughly one hour for selected non-power entities and is flushed at startup/session changes. It is therefore not a Slice 2 power-history source or fallback. PostgreSQL remains deferred unless a separately approved, SELECT-only current circuit/location enrichment is required. The Control Center never migrates or writes the frmcache schema. Application-owned persistence still requires a separate ADR.

## Operational assumptions

Task 0 binds deployed Prometheus image ID `sha256:8da6d95a8747c08872fbffa86d35a9c39433cbe908ce8e5939ad34087cceac86` and runtime values `storage.tsdb.retention.time=15d`, `storage.tsdb.retention.size=0B`. Time retention is the active horizon, but actual per-series coverage may be shorter because of service age, missing metrics, or private session-label transitions. The required RC.4 Prometheus source cadence is 5 seconds, while runtime configuration defaults to 15 seconds for rollback compatibility until the external operator deployment is verified. Public `5s` resolution is source-fidelity gated; the application never implies 5-second data when the configured scrape source is coarser.

## Evidence

- [Companion metric labels and registration](https://github.com/featheredtoast/FicsitRemoteMonitoringCompanion/blob/725dc8cba4ae16cf533591f252cc15a85370e0c5/Companion/exporter/registration.go#L16-L30)
- [Companion power collection and corrected maximum](https://github.com/featheredtoast/FicsitRemoteMonitoringCompanion/blob/725dc8cba4ae16cf533591f252cc15a85370e0c5/Companion/exporter/power_collector.go#L22-L147)
- [Prometheus scrape configuration](https://github.com/featheredtoast/satisfactory-monitoring/blob/30cd8668117c17e7953b820edc1f1283a13bb0f1/prometheus/prometheus.yml)
- [Power recording/alert rules](https://github.com/featheredtoast/satisfactory-monitoring/blob/30cd8668117c17e7953b820edc1f1283a13bb0f1/prometheus/rules/power.yml)
- [frmcache retention and endpoint inventory](https://github.com/featheredtoast/satisfactory-monitoring/blob/30cd8668117c17e7953b820edc1f1283a13bb0f1/frmcache/src/app/cache_worker.go#L120-L239)

The complete field, metric, dashboard, alert, and schema ledger is in [`../data-sources.md`](../data-sources.md).
