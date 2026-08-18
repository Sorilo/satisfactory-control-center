# Data sources

## FRM (current/evidenced)

Source inspected: `https://github.com/porisius/FicsitRemoteMonitoring`, commit `32fe64e0c22389a944c27222ef6c881f5e207072` on 2026-08-18.

- HTTP and WebSocket share configurable port 8080 by default.
- HTTP read example: `GET /getPower`.
- Authentication header: `X-FRM-Authorization: <token>`.
- WebSocket connects at the root and accepts `{ "action": "subscribe", "endpoints": [...] }` and `unsubscribe`; messages have `{ "endpoint", "data" }`.
- Upstream WebSocket is not public-facing and supports no documented `wss` itself; the Control Center terminates public HTTPS.

Documented read endpoints (58):

`getAll`, `getArtifacts`, `getBelts`, `getCables`, `getChatMessages`, `getCloudInv`, `getCrateInv`, `getCreatures`, `getDoggo`, `getDrone`, `getDroneStation`, `getDropPod`, `getElevators`, `getExtractor`, `getFactory`, `getFrackingActivator`, `getGenerators`, `getHUBTerminal`, `getHazards`, `getHyperEntrance`, `getHypertube`, `getMapMarkers`, `getModList`, `getPipeJunctions`, `getPipes`, `getPlayer`, `getPortal`, `getPower`, `getPowerSlug`, `getPowerUsage`, `getProdStats`, `getPump`, `getRadarTower`, `getRecipes`, `getResearchTrees`, `getResourceNode`, `getResourceSink`, `getResourceSinkBuilding`, `getSPWN`, `getSchematics`, `getSessionInfo`, `getSinkList`, `getSpaceElevator`, `getSplitterMerger`, `getStorageInv`, `getSwitches`, `getTapes`, `getTradingPost`, `getTrainRails`, `getTrainStation`, `getTrains`, `getTruckStation`, `getUObjectCount`, `getUnlockItems`, `getVehiclePaths`, `getVehicles`, `getWorldInv`.

Presence in documentation does not automatically make an endpoint publicly appropriate. Each adapter slice needs schema fixtures and a field-level privacy review.

## Prometheus (reported/planned)

Configured by `PROMETHEUS_BASE_URL`. Only named, server-owned query templates are permitted. Range, step, item IDs, and result sizes are bounded. Dashboard PromQL must be inspected before implementation; no arbitrary query endpoint exists.

## frmcache/PostgreSQL (reported/deferred)

The adapter will use a dedicated SELECT-only role, parameterized SQL, timeouts, row limits, and explicit result schemas. The existing schema will not be mutated. Table names and SQL are unknown until read-only schema inspection.

## Grafana (reported)

Grafana remains a private admin/diagnostic UI and a source of query concepts. Public operation does not depend on Grafana login or embedding.

## Mock provider (current target)

The deterministic mock provider supplies a populated world. Test-local domain fixtures also cover a valid empty world and upstream degradation. Stale serving is deferred. Fixture shapes are domain-owned—not raw FRM claims—and run in CI without private services.
