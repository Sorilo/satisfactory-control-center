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

## Planned routes

`/api/v1/power`, `/production`, `/bottlenecks`, `/factories`, `/storage`, `/trains`, `/drones`, `/players`, `/history`, `/progress`, `/map/*`, and `/stream` are implemented only with their vertical slice. No catch-all upstream route will be added.

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
