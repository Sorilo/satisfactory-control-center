# ADR-003: SSE public realtime transport

**Status:** Accepted for single-replica deployment; implementation phased

Use server-owned FRM WebSocket/polling upstream and same-origin SSE downstream. Telemetry is server-to-browser, so SSE provides automatic reconnect and simpler proxy behavior than a bidirectional public WebSocket. Poll curated HTTP routes when SSE is unavailable. A shared process aggregator is required before enabling broad realtime fan-out.
