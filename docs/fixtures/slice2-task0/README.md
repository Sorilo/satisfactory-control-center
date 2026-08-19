# Slice 2 Task 0 sanitized fixtures

These fixtures preserve the minimum non-secret evidence needed to bind Slice 2 planning and future adapter tests to the live deployment validation performed on 2026-08-18.

- `frm-get-power-live.json`: populated live `/getPower` response.
- `frm-get-power-no-circuits.json`: valid live response before a power circuit existed or was available.
- `companion-power-metric-availability.json`: observed metrics versus source-documented but unobserved capability.
- `prometheus-retention.json`: effective deployed TSDB retention flags.
- `deployed-artifacts.json`: deployed container names and immutable local image IDs.

The fixtures contain no internal URLs, IP addresses, hostnames, session/save names, Prometheus label values, credentials, or raw logs. Container image IDs bind tested artifacts but do not prove that the Satisfactory image's embedded FRM plugin equals the separately inspected upstream source commit.

## Interpretation contract

1. `frm-get-power-no-circuits.json` is a successful live state, not an outage.
2. `PowerCapacity`, `PowerConsumed`, and `PowerMaxConsumed` are validated deployed fields.
3. `PowerProduction` remains semantically unresolved and must not be presented as actual/current generation.
4. Only the three `observedMetricNames` are promised for initial historical power queries.
5. The configured history horizon is 15 days; actual per-series coverage can be shorter.
