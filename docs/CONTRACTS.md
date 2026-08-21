# Repository contracts

## Security boundary

The browser may call only same-origin Control Center pages and `/api/*` routes. Route handlers resolve opaque `serverId` values through a server-only registry. They never accept an upstream hostname, URL, FRM endpoint, PromQL expression, or SQL statement from a request.

## Data boundary

Upstream payloads are `unknown` until parsed by strict runtime schemas. Adapters map parsed values into normalized domain objects. Public API view models may contain only fields explicitly declared in `src/contracts`.

## State layers

1. **Runtime configuration:** immutable after process startup.
2. **Upstream adapters:** read-only network clients with timeout and size bounds.
3. **In-process cache/aggregator:** disposable, bounded, and non-authoritative.
4. **Browser state:** selected public server ID, filters, and presentation state only.
5. **Application persistence:** none in Slice 1 or Slice 3; future timeline persistence requires a separate schema/datastore ADR.

Current production is intentionally a read-through FRM snapshot: calculated net throughput is labeled calculated, and absent retained history is labeled unsupported rather than synthesized.

## Failure contract

A valid empty world is represented as available data with empty collections. Loading is browser-local. Upstream failure is an unavailable/degraded source with a sanitized public error code. Stale cached data includes an observed timestamp and `stale` freshness; it is never silently presented as current.

## Realtime contract

The server owns upstream FRM connections. Public clients receive normalized same-origin SSE events. Polling of curated API routes is the fallback. Upstream WebSockets are never exposed or tunneled.

## Change contract

Breaking public API changes require a new `/api/vN` namespace or a documented compatibility period. Upstream schema changes are absorbed inside adapters and fixture-backed tests.
