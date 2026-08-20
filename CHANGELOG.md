# Changelog

All notable release changes are documented here.

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
