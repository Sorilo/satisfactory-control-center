# ADR-006: Source and capability gates for the major-release slices

**Status:** Accepted — Phase 0 checkpoint  
**Reviewed:** 2026-08-21 against immutable upstream revisions and the current repository anchor

## Decision

Every later vertical slice must bind each public concept to an authoritative source, an observed or explicitly unobserved availability state, a privacy classification, and an empty/unavailable behavior before runtime code is added. A source capability is not a public feature merely because an upstream repository contains a collector or endpoint.

The canonical evidence ledger is [`../data-sources.md`](../data-sources.md). Synthetic, sanitized checkpoint fixtures are in [`../fixtures/source-capability/`](../fixtures/source-capability/).

## Accepted source boundaries

- **FRM** is the current-state source for read-only game objects and endpoints. The pinned source exposes production summaries, factory detail, storage inventories, players, map markers, trains/rail/stations, vehicles, drones, session state, and progression-adjacent objects. Raw object IDs, class names, coordinates, player names, station names, driver names, and inventories remain server-only until an individual public contract and privacy gate exists.
- **Companion/Prometheus** is a source for selected current and retained metric families. The pinned Companion source includes item production/consumption gauges, factory-building detail metrics, and vehicle/train/drone metrics. Its metric labels include private FRM URL and session selectors; those labels are never public identifiers.
- **Prometheus deployment cadence is configuration-owned.** The pinned monitoring repository currently declares a 15-second global scrape interval. A 5-second application request is therefore unsupported unless the selected deployment is independently observed and configured for 5-second scraping.
- **frmcache/PostgreSQL** is not assumed to be a power-history fallback. Its pinned schema contains current and historical JSONB cache tables, but the Control Center will not migrate or write that database. Any future use requires read-only schema introspection, a fixed parameterized query, and a separate ADR.
- **Map assets and code** are not copied from FRM or the game. The inspected FRM tree has no top-level license file; source inspection and citation do not grant reuse permission. The Control Center will render an original normalized map only.

## Explicit negative findings and blockers

- The pinned Companion source has no `power_production` gauge. Current generation and historical generation must remain unsupported unless a source-reviewed gauge is observed and retained; capacity or consumption is not a surrogate.
- The pinned monitoring Prometheus configuration is 15 seconds, despite older release-contract evidence describing a 5-second target. The runtime must use the selected deployment's verified cadence and report finer requested resolution as unsupported.
- The authorized live validation alias `unraid-phase10` was not DNS-resolvable from this workspace on 2026-08-21. No privileged fallback, direct-root connection, live container inspection, or credential capture was attempted. The older sanitized Task 0 fixtures remain historical evidence and are not silently relabeled as current deployment verification.
- Default/example database credentials observed in upstream deployment source are not copied into this repository; any future evidence must use `[REDACTED]`.
- Progress, milestones, achievements, and durable application history remain unclaimed until their exact source fields, retention behavior, and public semantics are separately verified.

## Capability state vocabulary

Public contracts use these meanings consistently:

- `live`: the source responded successfully and the normalized value is current.
- `stale`: a bounded last-known-good value is served with its observation time.
- `empty`: the source responded successfully with no matching objects/series.
- `unavailable`: the expected source or route failed, timed out, or could not be parsed.
- `unsupported`: the requested concept/resolution is not provided by the selected source or is intentionally privacy/license gated.
- `calculated`: derived only from explicitly observed normalized inputs; it is never presented as upstream-observed.

A successful empty response is never converted into `unavailable`. A documented source capability is never converted into `live` without deployment/metric discovery for the selected server.

## Consequences

- Production may begin with current item production/consumption and explicit unsupported historical-generation states.
- Map work may use normalized coordinates and opaque targets but cannot reuse upstream bundles, icons, fonts, or game assets.
- Player, storage, vehicle, train, and drone slices require separate privacy and cardinality tests even when FRM already exposes the underlying objects.
- Every historical route must publish its source cadence, retention horizon, allowed resolutions, series/point caps, and partial/empty/unsupported behavior.
- Release evidence must distinguish immutable source evidence from live deployment evidence and stop on source or environment drift.

## Evidence references

- [FRM pinned tree](https://github.com/porisius/FicsitRemoteMonitoring/tree/32fe64e0c22389a944c27222ef6c881f5e207072)
- [FRM session, production, map-marker, and player source](https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/Source/FicsitRemoteMonitoring/Private/Endpoints/World/Session.cpp)
- [FRM factory source](https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/Source/FicsitRemoteMonitoring/Private/Endpoints/Factory/FactoryLibrary.cpp)
- [FRM train and vehicle source](https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/Source/FicsitRemoteMonitoring/Private/Endpoints/Travel/Trains.cpp)
- [FRM drone source](https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/Source/FicsitRemoteMonitoring/Private/Endpoints/Travel/Drones.cpp)
- [Companion collector registration](https://github.com/featheredtoast/FicsitRemoteMonitoringCompanion/blob/725dc8cba4ae16cf533591f252cc15a85370e0c5/Companion/exporter/exporter.go)
- [Companion production collector](https://github.com/featheredtoast/FicsitRemoteMonitoringCompanion/blob/725dc8cba4ae16cf533591f252cc15a85370e0c5/Companion/exporter/production_collector.go)
- [Monitoring Prometheus configuration](https://github.com/featheredtoast/satisfactory-monitoring/blob/30cd8668117c17e7953b820edc1f1283a13bb0f1/prometheus/prometheus.yml)
- [Monitoring frmcache migrations](https://github.com/featheredtoast/satisfactory-monitoring/tree/30cd8668117c17e7953b820edc1f1283a13bb0f1/frmcache/src/db)
