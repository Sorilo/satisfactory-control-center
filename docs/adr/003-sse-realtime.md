# ADR-003: SSE public realtime transport

**Status:** Accepted and implemented for opt-in normalized Power single-replica deployment

## Decision

Use one server-owned FRM subscription or bounded HTTP polling loop per configured server and same-origin SSE downstream. Telemetry is server-to-browser, so SSE provides automatic reconnect and simpler proxy behavior than a bidirectional public WebSocket. A shared process aggregator is required before enabling realtime fan-out.

The Slice 2 stream is Power-only in product scope and normalized; it contains no map, production, inventory-detail, or raw upstream event channel. Its fast current producer polls only the fixed `getPower` endpoint; a future reviewed FRM WebSocket producer may replace that implementation without changing the public contract. Generator and major-consumer detail is streamed through a second, slower (30-second) shared process-local producer that degrades each group independently and emits additively as a distinct `power-details` SSE event with IDs `serverId:details:<sequence>` so the unchanged `power` event keeps its existing `serverId:<sequence>` IDs and five-second cadence. A malformed or oversized detail event detaches only that connection's detail channel rather than failing the accepted power stream. Public clients never choose an FRM endpoint and never receive the upstream `{endpoint,data}` envelope.

The stream sends an initial normalized snapshot, later changed snapshots, later changed details, and heartbeat comments. It uses `Cache-Control: no-store, no-transform`, is same-origin, and has explicit per-client and global connection limits, bounded event size, per-channel backpressure coalescing (one pending power frame and one pending detail frame), abort cleanup, and browser polling fallback. Producer restart uses bounded backoff and jitter and does not create one FRM poll loop per browser. The browser attempts two delayed reconnects (one and two seconds); after the third failure it refreshes the strict `/api/v1/power` envelope every 15 seconds.

Prometheus history is not multiplexed through the FRM realtime stream. FRM failure must not disable historical queries; Prometheus failure must not disable realtime power.

## Deployment boundary

The process-local singleton is accepted only for the documented one-replica Unraid deployment. Horizontal scaling requires an external pub/sub or ownership mechanism and a replacement/extension ADR. Reverse-proxy buffering and disconnect cleanup must be validated through the real deployment path before SSE is declared live.

## Evidence

FRM's inspected source maintains endpoint subscriber sets, accepts `subscribe`/`unsubscribe`, pushes one `{endpoint,data}` message per subscribed endpoint, and defaults to a five-second push cycle ([push loop](https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/Source/FicsitRemoteMonitoring/Private/FicsitRemoteMonitoring.cpp#L103-L121), [subscription/push handling](https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/Source/FicsitRemoteMonitoring/Private/FicsitRemoteMonitoring.cpp#L502-L587)). Exact compatibility assumptions are recorded in [`../data-sources.md`](../data-sources.md).
