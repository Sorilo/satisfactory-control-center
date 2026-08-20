# Public API contracts

All product APIs are same-origin and versioned under `/api/v1`. JSON is UTF-8. Unknown request fields are rejected where a request body exists. GET inputs are bounded and allowlisted.

## Envelope

```ts
type PublicEnvelope<T> = {
  apiVersion: "v1";
  generatedAt: string;
  serverId: string;
  freshness: { state: "live" | "stale" | "unavailable"; observedAt: string | null };
  data: T | null;
  unavailableSources: Array<"frm" | "prometheus" | "postgres">;
};
```

Internal exception messages, URLs, query text, and container names are never fields.

## Current Slice 1 routes

- `GET /api/v1/servers` — public `{id, displayName}` entries and default ID.
- `GET /api/v1/overview?serverId=<opaque-id>` — normalized server/session/summary.
- `GET /api/health/live` — process liveness.
- `GET /api/health/ready` — sanitized readiness/degradation.
- `GET /api/health` — combined health summary.

Unknown, disabled, or non-public server IDs return a generic 404. Malformed IDs return 400. Summary responses use a short public cache; health and streams use `no-store`/`no-cache`.

## Slice 2 power contract

`GET /api/v1/power` accepts only an opaque `serverId` plus allowlisted `range` (`1h`, `6h`, `24h`, `7d`, `15d`) and `resolution` (`auto`, `1m`, `5m`, `15m`, `1h`). It uses a power-specific envelope with independent `freshness.current` and `freshness.history` states. FRM current data may therefore remain available when Prometheus history fails, and retained history may remain available when FRM fails.

Current power exposes capacity, consumption, reported maximum consumption, derived headroom and capacity-denominator utilization, fuse state, bounded circuit data, and independently available generator/major-consumer detail groups. Generator details are capped at 100 and expose only display name, explicit connected/disconnected circuit membership, normalized fuel type, optional `{name,amount,capacity}` inventory, capacity/load, start readiness, and fuse state. Major consumers are ranked server-side by consumption descending, maximum descending, then deterministic safe tie-breakers and capped at 10; disconnected all-zero structures are omitted while connected zero-draw records may remain as useful topology detail. A successful detail `[]` is `state:"live"` with an empty `items` array, not source failure.

Circuit membership never maps upstream `-1` to circuit `0`: it is serialized as `{state:"disconnected",id:"-1"}`; connected membership is `{state:"connected",id:"<nonnegative decimal>"}`. Raw IDs, class names, coordinates/orientation, inventory class names, and unresolved generator production/demand fields are validated server-side where required and discarded before the domain/public boundary. No map/location field is exposed because Slice 2 has no implemented public normalized map contract. A successful aggregate FRM `[]` is live data with `topologyState: "no-circuits"`, zero totals, and no circuits—not an upstream failure.

History exposes only `capacityMw`, `consumptionMw`, and `correctedMaximumConsumptionMw`. Coverage is explicitly `complete`, `partial`, or `empty`, has a literal 15-day retention horizon, and reports the effective coarsened resolution. Historical production is frozen as `{state:"unavailable",reason:"source-not-collected"}`. The initial contract contains no `productionMw` or current-generation field because the reviewed FRM `PowerProduction` meaning is unresolved.

`GET /api/v1/power/stream?serverId=<opaque-id>` is enabled only when `POWER_STREAM_ENABLED=true`. It accepts exactly one `serverId`; malformed/unknown IDs, duplicate/unknown parameters, invalid `Last-Event-ID`, disabled streaming, and connection exhaustion return sanitized errors. SSE `power` events contain observation time, topology state, totals, and circuits; they exclude history, generators, and major consumers. An additive `power-details` event carries the independently degraded generator and major-consumer groups using the same strict bounded item shapes as the envelope (generators capped at 100, major consumers at 10) and no raw or private fields. Power event IDs are `serverId:<sequence>` and detail event IDs are `serverId:details:<sequence>`. Each channel coalesces to a single pending frame under backpressure so a slow reader retains the latest power and detail frames, frames are byte-bounded, heartbeat comments keep idle connections observable, and responses use `no-store, no-transform`. A malformed or oversized detail event detaches only that connection's detail channel; the accepted power stream is unaffected. `Last-Event-ID` accepts either the power form (`serverId:<sequence>`) or the details form (`serverId:details:<sequence>`) and suppresses only the exactly matching channel replay.

All nested objects are strict. Public serialization rejects private URLs, selectors, raw FRM names, PromQL, datasource identifiers, SQL, hosts, credentials, and stack/error details. History is bounded to 100 series and 2,000 points per series; major consumers are bounded to 10.

## Planned routes

`/production`, `/bottlenecks`, `/factories`, `/storage`, `/trains`, `/drones`, `/players`, `/history`, `/progress`, `/map/*`, and non-power streams are implemented only with their vertical slice. No catch-all upstream route will be added.

## Error shape

```json
{
  "error": {
    "code": "UPSTREAM_UNAVAILABLE",
    "message": "Realtime data is temporarily unavailable."
  }
}
```

Codes are stable within `v1`; messages may improve without a version change.
