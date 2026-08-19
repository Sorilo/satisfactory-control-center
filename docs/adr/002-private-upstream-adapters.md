# ADR-002: Private upstream adapter boundary

**Status:** Accepted; Slice 2 source policy clarified 2026-08-18

## Decision

FRM, Prometheus, Grafana, and PostgreSQL remain private. Explicit server-only providers parse bounded upstream payloads and return application-owned domain models. Public handlers are curated and versioned. Generic proxying is rejected because it bypasses field allowlists, enables SSRF/amplification, and risks query, write, label, and credential exposure.

For Slice 2, source ownership is explicit:

- FRM is authoritative for current circuit-group capacity, consumption, reported maximum consumption, batteries, fuses, generators, and per-building consumers. Its `PowerProduction`/`mBaseProduction` value remains semantically unresolved and is omitted from user-facing actual/current generation.
- Companion/Prometheus is authoritative for retained capacity, consumption, and corrected maximum-consumption history. Battery/fuse gauges are documented upstream capability but were not observed in Task 0 and are not promised historical series.
- Grafana is a private diagnostic/query-design reference, never a runtime dependency or embedded public UI.
- frmcache/PostgreSQL does not ingest power and is not a power-history fallback. Any later circuit/location enrichment requires a separate SELECT-only adapter and live schema verification.

Adapters may use only fixed reviewed FRM paths, named Prometheus methods with fixed templates, and fixed parameterized SQL. Private FRM URLs, Prometheus `url`/`session_name` labels, raw metric names, PromQL, SQL, Grafana datasource IDs, and upstream records never cross the public contract.

## Compatibility consequence

The same product concept can have different upstream semantics. In particular, FRM reports `PowerMaxConsumed`, while Companion's `power_max_consumed` is the greater of that value and a calculated category maximum. Domain/public models must name or document that distinction rather than silently treating the series as identical.

Historical production is unavailable in the inspected stack because Companion does not export FRM `PowerProduction`. The application fails honestly with a nullable/unavailable series; it does not substitute capacity or consumption.

A successful FRM `GET /getPower` response of `[]` is a valid live no-circuits state. Adapters and services must preserve live freshness, emit an empty circuit collection and zero aggregate demand/capacity values, and must not classify it as upstream unavailability.

## Evidence

The pinned source and field/query inventory is maintained in [`../data-sources.md`](../data-sources.md), including:

- [FRM power fields](https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/Source/FicsitRemoteMonitoring/Private/Endpoints/Factory/Power.cpp#L18-L53)
- [Companion power collector](https://github.com/featheredtoast/FicsitRemoteMonitoringCompanion/blob/725dc8cba4ae16cf533591f252cc15a85370e0c5/Companion/exporter/power_collector.go#L22-L147)
- [Monitoring power rules](https://github.com/featheredtoast/satisfactory-monitoring/blob/30cd8668117c17e7953b820edc1f1283a13bb0f1/prometheus/rules/power.yml)
- [frmcache ingestion list](https://github.com/featheredtoast/satisfactory-monitoring/blob/30cd8668117c17e7953b820edc1f1283a13bb0f1/frmcache/src/app/cache_worker.go#L185-L239)
