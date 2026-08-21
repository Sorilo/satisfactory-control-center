# Changelog

All notable release changes are documented here.

## [0.2.0-rc.5] - 2026-08-21

### Changed

- Retained-history cache entries now expire at the configured Prometheus source cadence instead of a fixed 30-second TTL, and cadence is part of cache identity.
- The validated source cadence is passed through both the server-rendered Power page and the public Power history loader without changing current/SSE behavior.

### Added

- Service, component, and Chromium browser regression coverage for the complete `15m` / `5s` path: approximately 5-second requests, advancing history timestamps, stable 181-point rolling history, visible freshness, and SVG chart updates.

### Boundaries

- `PROMETHEUS_SCRAPE_INTERVAL_SECONDS=5` requires an externally verified 5-second Prometheus source; `15` remains the safe default and RC.4-compatible rollback configuration.
- No final `v0.2.0`, Slice 3, PostgreSQL persistence, map/location contract, viewport zoom, or `15m/1s` live trace.
- RC.4 remains the immediate rollback release; no existing tag or release is overwritten.

See [`docs/releases/v0.2.0-rc.5.md`](docs/releases/v0.2.0-rc.5.md) for the implementation delta, safety boundary, and release gates.


### Added

- Validated `PROMETHEUS_SCRAPE_INTERVAL_SECONDS` source-cadence configuration with safe 15-second default and 5-second RC.4 support.
- Source-aware 5-second Power history resolution, Auto policy, structured source-fidelity rejection, and no-query safety for unsupported requests.
- Regression coverage for zero-zero major-consumer filtering, 5-second provider/adapter propagation, 5-second history refresh, and point/source wording.

### Changed

- Major-consumer detail now omits every record whose current and maximum demand are both zero, regardless of circuit membership.
- Power history UI says points, uses `No telemetry points`, and separates current FRM freshness from `History source current <UTC timestamp>`.
- Compose, deployment, API, data-source, and release metadata now describe the RC.4 cadence contract and retain 15-day/2,000-point bounds.

### Boundaries

- External operator Prometheus configuration must be verified at global `scrape_interval: 5s` before setting the application cadence to `5`; the application repository contains no operator checkout and this gate remains deployment-owned.
- No final `v0.2.0`, Slice 3, PostgreSQL persistence, map/location contract, viewport zoom, or `15m/1s` live trace.
- RC.3 and RC.2 remain preserved rollback releases; no existing tag or release is overwritten.

See [`docs/releases/v0.2.0-rc.4.md`](docs/releases/v0.2.0-rc.4.md) for the implementation delta, safety boundary, and remaining release gates.

## [0.2.0-rc.3] - 2026-08-20

### Added

- Browser-proven named `power` and `power-details` SSE delivery with React DOM updates and safe default-message fallback.
- Bounded retained-history refresh, independent range/resolution controls, custom-range validation, and explicit unsupported retention/resolution states.
- Shared 15-day retention and 2,000-point-per-series planning bounds enforced before Prometheus queries.

### Changed

- Release identity, Compose defaults, and deployment guidance now target `v0.2.0-rc.3`; `POWER_STREAM_ENABLED` remains supported and disabled by default.
- Long ranges remain contract-visible but return structured unsupported coverage under current retention; no fabricated samples are produced.

### Boundaries

- No final `v0.2.0`, Slice 3, PostgreSQL persistence, map/location contract, viewport zoom, or `15m/1s` live trace.
- RC.2 remains the immediate rollback candidate; no existing RC tag or release is overwritten.

See [`docs/releases/v0.2.0-rc.3.md`](docs/releases/v0.2.0-rc.3.md) for validation, history contract, and rollback guidance.

## [0.2.0-rc.2] - 2026-08-20

### Added

- Reusable interactive telemetry history chart with mouse, touch-drag, keyboard, crosshair, markers, bounded all-series tooltips, exact derived values, and large-history downsampling.
- Slower shared `power-details` SSE channel for changed generator and major-consumer snapshots, with independent degradation and bounded per-channel coalescing.
- Human-readable existing battery empty/full estimates and evidence-grounded no-battery normalization.

### Changed

- Current Power totals, fuse state, and circuits update in place from accepted SSE without reloading the page.
- Realtime producer recovery now uses abortable bounded backoff; malformed detail messages do not disrupt the accepted current-Power stream.
- `POWER_STREAM_ENABLED` remains disabled by default and requires direct-LAN validation before final promotion.

### Boundaries

- No final `v0.2.0`, Slice 3, PostgreSQL persistence, map/location contract, or unresolved FRM production fields.
- Battery capacity and separate input/output remain omitted until nonzero live evidence verifies their units.

See [`docs/releases/v0.2.0-rc.2.md`](docs/releases/v0.2.0-rc.2.md) for validation and rollback guidance.

## [0.2.0-rc.1] - 2026-08-18

### Added

- Slice 2 Power page with normalized current totals/circuits and independently degradable fixed-query Prometheus history.
- Strict bounded `/getGenerators` and `/getPowerUsage` adapters with explicit disconnected-circuit state, normalized fuel/inventory detail, deterministic major-consumer ranking, sanitized fixtures, and no raw IDs/classes/locations.
- Shared cached current-Power composition for Overview and Power, plus opt-in bounded Power SSE with fast current and slower detail channels and HTTP polling fallback.
- Desktop/mobile browser coverage, contract/security/deployment guidance, and container smoke assertions for detail availability and private-field exclusion.

### Release-candidate boundaries

- Historical production remains explicitly unavailable; unresolved FRM production-like fields are not treated as actual generation.
- SSE remains disabled by default until the real proxy/Tunnel path is validated.
- PostgreSQL history, persistence, original normalized map/location, and Slice 3+ views remain deferred.

See [`docs/releases/v0.2.0-rc.1.md`](docs/releases/v0.2.0-rc.1.md) for validation and rollback guidance.

## [0.1.0] - 2026-08-18

### Added

- Production-shaped Slice 1 responsive application shell and staged navigation.
- Deterministic mock mode and curated read-only FRM overview integration.
- Opaque multi-server registry, versioned public APIs, and health endpoints.
- Strict public contracts, bounded upstream reads, redirect confinement, and abuse protection.
- Standalone non-root container, hardened Compose example, GitHub CI release gate, and GHCR publication.
- Architecture, security, testing, API, and Unraid deployment documentation.

### Deferred

- Data-rich Slice 2+ views, historical providers, realtime aggregation, persistence, and map implementation.

See [`docs/releases/v0.1.0.md`](docs/releases/v0.1.0.md) for release scope, image references, verification, and known limitations.
