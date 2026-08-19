# ADR-003: SSE public realtime transport

**Status:** Accepted for single-replica deployment; implementation phased

## Decision

Use one server-owned FRM subscription or bounded HTTP polling loop per configured server and same-origin SSE downstream. Telemetry is server-to-browser, so SSE provides automatic reconnect and simpler proxy behavior than a bidirectional public WebSocket. A shared process aggregator is required before enabling realtime fan-out.

The initial Slice 2 stream is power-only and normalized. It subscribes only to the fixed `getPower` endpoint or polls that same endpoint; generator and major-consumer detail remain bounded request/refresh reads unless later evidence justifies adding them to the shared loop. Public clients never choose an FRM endpoint and never receive the upstream `{endpoint,data}` envelope.

The stream sends an initial normalized snapshot, later changed snapshots, and heartbeat comments. It uses `Cache-Control: no-cache, no-transform`, is same-origin, and has explicit per-client and global connection limits, bounded event size, abort cleanup, and polling fallback. Upstream reconnect uses bounded backoff and jitter and does not create one FRM connection per browser.

Prometheus history is not multiplexed through the FRM realtime stream. FRM failure must not disable historical queries; Prometheus failure must not disable realtime power.

## Deployment boundary

The process-local singleton is accepted only for the documented one-replica Unraid deployment. Horizontal scaling requires an external pub/sub or ownership mechanism and a replacement/extension ADR. Reverse-proxy buffering and disconnect cleanup must be validated through the real deployment path before SSE is declared live.

## Evidence

FRM's inspected source maintains endpoint subscriber sets, accepts `subscribe`/`unsubscribe`, pushes one `{endpoint,data}` message per subscribed endpoint, and defaults to a five-second push cycle ([push loop](https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/Source/FicsitRemoteMonitoring/Private/FicsitRemoteMonitoring.cpp#L103-L121), [subscription/push handling](https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/Source/FicsitRemoteMonitoring/Private/FicsitRemoteMonitoring.cpp#L502-L587)). Exact compatibility assumptions are recorded in [`../data-sources.md`](../data-sources.md).
