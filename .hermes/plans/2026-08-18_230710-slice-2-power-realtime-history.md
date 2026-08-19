# Slice 2 Power Realtime and History Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Deliver a public-safe power vertical with normalized FRM current state, fixed Prometheus history, bounded generator/consumer detail, and same-origin realtime updates while preserving the existing adapter/domain/public-contract architecture.

**Architecture:** Extend the hexagonal boundary with a dedicated `PowerProvider` for FRM current state and a `PowerHistoryProvider` for named Prometheus reads. A service composes the sources independently into strict public envelopes; routes resolve only opaque server IDs and bounded product parameters. A process-local per-server aggregator privately owns FRM subscription/polling and fans normalized events to same-origin SSE clients.

**Tech Stack:** Next.js 16 App Router, TypeScript 5.9 strict mode, Zod 4, Vitest, Testing Library, Playwright, FRM HTTP/WebSocket, Prometheus HTTP API.

---

## 1. Current-state recap

Slice 1 is deployed and live against FRM. The repository currently has:

- normalized overview domain types and `FrmProvider` in `src/domain/overview.ts`;
- strict v1 public Zod contracts in `src/contracts/public-contracts.ts`;
- a bounded fixed-endpoint FRM adapter in `src/lib/server/adapters/frm/frm-overview-adapter.ts`;
- opaque server resolution in `src/lib/server/config/runtime-config.ts`;
- one provider factory and overview service/route;
- no Prometheus adapter, power-specific domain port, history port, or realtime aggregator;
- staged Power and History pages.

Source reconnaissance and compatibility decisions are recorded in:

- `docs/data-sources.md`
- `docs/adr/002-private-upstream-adapters.md`
- `docs/adr/003-sse-realtime.md`
- `docs/adr/004-constrained-history.md`

Pinned source references:

- FRM `32fe64e0c22389a944c27222ef6c881f5e207072`
- Companion `725dc8cba4ae16cf533591f252cc15a85370e0c5`
- satisfactory-monitoring `30cd8668117c17e7953b820edc1f1283a13bb0f1`

Task 0 live deployment evidence is preserved in `docs/fixtures/slice2-task0/` and binds:

- Satisfactory server image ID `sha256:5eeddf2ad9391400bf973e47c2cdc8432d06159ea43950a76ee51c57fccc8b97`;
- Companion image ID `sha256:6b0f0aa762b0d4c9e727bae3ba495e5a1bdde135757e6113b9741602ea530bc3`;
- Prometheus image ID `sha256:8da6d95a8747c08872fbffa86d35a9c39433cbe908ce8e5939ad34087cceac86`;
- populated and valid-empty FRM `/getPower` response shapes;
- only `power_capacity`, `power_consumed`, and `power_max_consumed` observed in the deployed Companion metric set;
- Prometheus `storage.tsdb.retention.time=15d` and `storage.tsdb.retention.size=0B`.

## 2. Frozen source and semantic decisions

1. **Production value:** FRM `getPower[].PowerProduction` is semantically unresolved. Live evidence returned `0` while a 20 MW-capacity circuit consumed 5 MW. Parse it only as an unresolved upstream field if useful for diagnostics, but omit it from the initial public current-generation contract and UI. A later controlled experiment or stronger implementation evidence requires a plan/contract amendment before exposure.
2. **Current capacity/consumption:** FRM `PowerCapacity` and `PowerConsumed`.
3. **Maximum consumption:** preserve two semantics where needed:
   - `reportedMaximumConsumptionMw`: FRM `PowerMaxConsumed`;
   - `correctedMaximumConsumptionMw`: Companion/Prometheus `power_max_consumed`.
4. **Headroom:** `capacityMw - consumptionMw`; negative values are valid.
5. **Utilization:** `consumptionMw / capacityMw * 100`; `null` at zero capacity; overload may exceed 100.
6. **Historical capacity/demand:** Prometheus `power_capacity`, `power_consumed`, `power_max_consumed`; these are the only deployed power metrics observed in Task 0.
7. **Historical production:** unavailable in the existing stack. Do not substitute capacity or derive a fake series.
8. **Battery/fuse:** current FRM fields remain available. Normalize battery duration strings to nullable seconds and omit an energy-unit suffix until verified. Companion battery/fuse gauges are documented capability but were not observed live, so no initial historical battery/fuse series is promised.
9. **Circuit identity:** canonical circuit-group IDs are decimal `String(CircuitGroupID)` values scoped to the selected opaque server and observed session. Prometheus `circuit_id` must parse to the same canonical decimal form. Major consumers join on `PowerInfo.CircuitGroupID`, never member `CircuitID`. Internal `url` and `session_name` labels remain private.
10. **Major consumers:** current-only, from a strict subset of `getPowerUsage`, ranked by the Control Center after validating the complete bounded response, then capped. No raw location, upstream object ID, or class name in v1. Public `name` comes from the display name only.
11. **Generators:** current-only, from a strict subset of `getGenerators`; inventory/location/class fields are discarded. Public `name` comes from display name only. Map to `biomass | coal | fuel | geothermal | nuclear` only when a reviewed discriminator proves it; otherwise return `unknown`. Reject non-finite/out-of-contract load values rather than silently clamping them.
12. **PostgreSQL:** not a Slice 2 power-history dependency. It may be considered later for current circuit-location enrichment through a separate SELECT-only adapter.
13. **Valid empty current state:** a successful FRM `getPower` response of `[]` means live/no circuits. Normalize it to `topologyState: "no-circuits"`, empty circuits, and zero aggregate capacity/consumption/maximum values; never classify it as unavailable.
14. **Retention:** deployed Prometheus time retention is 15 days with no size limit. Advertise at most 15 days and distinguish configured horizon from actual per-series coverage.

## 3. Proposed public contracts

The exact contract must be introduced test-first in `src/contracts/power-contracts.ts` and documented in `docs/api-contracts.md`.

### `GET /api/v1/power`

Allowlisted query parameters:

- `serverId`: existing bounded opaque ID;
- `range`: enum `1h | 6h | 24h | 7d | 15d`;
- `resolution`: enum `auto | 1m | 5m | 15m | 1h`.

Reject unknown query parameters. Resolution is a requested minimum bucket. The server auto-coarsens it to the smallest allowlisted effective step in this fixed map and returns the effective resolution:

| Range | `auto` / minimum effective step | Allowed effective steps |
|---|---:|---|
| `1h` | `1m` | `1m`, `5m`, `15m`, `1h` |
| `6h` | `1m` | `1m`, `5m`, `15m`, `1h` |
| `24h` | `1m` | `1m`, `5m`, `15m`, `1h` |
| `7d` | `15m` | `15m`, `1h` |
| `15d` | `15m` | `15m`, `1h` |

For example, `7d&resolution=1m` and `15d&resolution=5m` become `15m`. Requests beyond 15 days are rejected as outside the configured retention horizon rather than silently truncated. Tests cover every range/requested-resolution cell. The independent 2,000-point response cap still fails closed if upstream output exceeds the contract.

Proposed normalized payload:

```ts
type PowerEnvelope = {
  apiVersion: "v1";
  generatedAt: string;
  serverId: string;
  freshness: {
    current: { state: "live" | "stale" | "unavailable"; observedAt: string | null };
    history: { state: "live" | "stale" | "unavailable"; observedAt: string | null };
  };
  data: {
    current: {
      topologyState: "available" | "no-circuits";
      totals: {
        capacityMw: number;
        consumptionMw: number;
        reportedMaximumConsumptionMw: number;
        headroomMw: number;
        utilizationPercent: number | null;
        fuseTriggered: boolean;
      };
      circuits: Array<{
        id: string;
        capacityMw: number;
        consumptionMw: number;
        reportedMaximumConsumptionMw: number;
        headroomMw: number;
        utilizationPercent: number | null;
        fuseTriggered: boolean;
        associatedCircuitCount: number;
        battery: null | {
          chargePercent: number;
          netFlowMw: number;
          secondsToEmpty: number | null;
          secondsToFull: number | null;
        };
      }>;
      generators: {
        state: "live" | "unavailable";
        items: Array<{
          name: string;
          fuelType: "biomass" | "coal" | "fuel" | "geothermal" | "nuclear" | "unknown";
          productionCapacityMw: number;
          loadPercent: number;
          canStart: boolean;
        }>;
      };
      majorConsumers: {
        state: "live" | "unavailable";
        items: Array<{
          name: string;
          circuitId: string | null;
          consumptionMw: number;
          maximumConsumptionMw: number;
        }>;
      };
    } | null;
    history: {
      coverage: {
        state: "complete" | "partial" | "empty";
        requestedRange: "1h" | "6h" | "24h" | "7d" | "15d";
        effectiveResolution: "1m" | "5m" | "15m" | "1h";
        retentionHorizonDays: 15;
        oldestSampleAt: string | null;
        newestSampleAt: string | null;
      };
      series: Array<{
        key: "capacityMw" | "consumptionMw" | "correctedMaximumConsumptionMw";
        circuitId: string;
        points: Array<{ timestamp: string; value: number }>;
      }>;
      production: { state: "unavailable"; reason: "source-not-collected" };
    } | null;
  };
  unavailableSources: Array<"frm" | "prometheus">;
};
```

Contract decisions to prove in tests:

- FRM can fail while history remains populated and vice versa.
- `data` is not all-or-nothing; `current` and `history` degrade independently.
- unknown/raw fields are stripped or rejected before public serialization.
- no `url`, `session_name`, metric name, PromQL, raw FRM field, datasource UID, SQL, host, token, or stack message appears.
- arrays and points are deterministically sorted and bounded.
- consumer/generator reads degrade independently to `{state:"unavailable",items:[]}` without erasing valid totals/circuits; valid empty reads are `{state:"live",items:[]}`.
- valid FRM `[]` produces live freshness, `topologyState:"no-circuits"`, zero totals, and `circuits:[]`; this differs from FRM unavailability.
- no public `productionMw` or “current generation” field exists in the initial contract.
- history coverage distinguishes complete, partial, and empty retained data; outside-horizon ranges are rejected before querying Prometheus.
- this route intentionally uses a power-specific envelope with split source freshness rather than Slice 1's flat overview envelope; document the distinction. `stale` is reserved until last-known-good serving exists and is not emitted initially.
- `current.observedAt` is the successful FRM observation time; `history.observedAt` is the latest returned Prometheus sample timestamp, not query completion time.

### `GET /api/v1/power/stream`

Allowlisted input: opaque `serverId` only. Content type `text/event-stream`.

Define and test a dedicated `PowerStreamSnapshot` Zod schema containing only `totals` and `circuits`. It explicitly excludes `generators`, `majorConsumers`, and history because the aggregator owns only `getPower`.

Events:

- `event: snapshot` with a `PowerStreamSnapshot` only;
- `event: update` with a full replacement `PowerStreamSnapshot`, not an unbounded patch protocol;
- heartbeat comments at a fixed interval;
- an optional stable public `event: unavailable` code without upstream details.

Required headers:

```text
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

The route must not include history, private labels, Prometheus data, or upstream WebSocket envelopes.

## 4. Safety and resource contracts

- FRM paths are compile-time constants: `getPower`, `getPowerUsage`, and `getGenerators` only for this vertical.
- All HTTP reads retain redirect rejection, timeout, actual streamed-byte caps, typed errors, and strict Zod parsing.
- `getPowerUsage` and `getGenerators` have separate lower byte/time limits where practical; major-consumer output is capped (proposed 10).
- Prometheus supports only application methods such as `getPowerHistory(request)`; there is no generic query method exposed to routes.
- Prometheus query range and step use server-owned enum maps. Maximum: 15 days, 2,000 points per series, 100 series, 2 MiB response body, 5-second request timeout.
- Prometheus redirects are rejected. Matrix results with unexpected labels/types, duplicate logical series, non-finite samples, or excessive cardinality fail closed.
- Private selectors are configured per `ServerConfig`; the browser never submits them.
- History and SSE get distinct token-bucket policies. Proposed starting limits must be load-tested, not guessed into acceptance.
- Realtime ownership is one process singleton per server, one upstream connection/poll loop, bounded subscriber set, bounded event bytes, and abort-aware cleanup.
- Anchor the singleton in `globalThis` to survive Next development/module reload behavior; production remains one standalone Node process/replica.
- Upstream reconnect has capped exponential backoff with jitter and cancellation. Polling fallback remains available.
- Overview, the HTTP power route, and realtime could otherwise issue three independent `getPower` reads. Route current reads through the shared latest snapshot/coalescer where live, or document and cap the remaining calls.
- No app-owned database, migration, Docker socket, Grafana access, or raw upstream proxy is added.

## 5. Implementation tasks

### Task 0: Deployed compatibility checkpoint — complete for core Slice 2

**Objective:** Bind source assumptions to deployed artifacts and sanitized live shapes.

**Recorded evidence:**

1. Container image names and IDs are stored in `docs/fixtures/slice2-task0/deployed-artifacts.json`.
2. Populated and valid-empty `/getPower` shapes are stored as sanitized fixtures.
3. `PowerCapacity`, `PowerConsumed`, and `PowerMaxConsumed` are validated live fields.
4. `PowerProduction` is explicitly unresolved and omitted from initial user-facing generation semantics.
5. Deployed Companion availability is limited to the three observed `power_*` history metrics; documented battery/fuse capability is not promised.
6. Prometheus effective retention is 15 days by time with no size limit.

**Deferred non-blocking evidence:** capture sanitized `getPowerUsage` and `getGenerators` shapes immediately before Task 5. Those endpoints affect optional detail only and do not reopen the frozen core capacity/demand/history contract unless drift is found.

**Acceptance:** complete enough to begin Task 1 after this planning checkpoint is reviewed. No raw private evidence is staged in Git; any later source/deployment drift remains a stop gate.

### Task 1: Add power domain models and ports (TDD)

**Files:**
- Create: `src/domain/power.ts`
- Create: `src/domain/power.test.ts`

**Steps:**

1. Write failing tests for valid empty/no-circuits normalization, zero-capacity utilization, negative headroom, deterministic circuit aggregation, weighted/nullable battery behavior if adopted, and bounded top-consumer ordering.
2. Run `npm test -- src/domain/power.test.ts`; expect semantic RED.
3. Implement normalized types, `PowerProvider`, `PowerHistoryProvider`, and pure derivation helpers with no Zod/Next/fetch imports.
4. Run focused tests; expect pass.
5. Run `npm run typecheck` and commit `feat(power): define normalized power domain ports`.

### Task 2: Define strict public power contracts (TDD)

**Files:**
- Create: `src/contracts/power-contracts.ts`
- Create: `src/contracts/power-contracts.test.ts`
- Modify: `docs/api-contracts.md`

**Steps:**

1. Write RED tests for the proposed envelope, live no-circuits state, absence of public current-generation fields, independent freshness, unavailable history production, 15-day coverage metadata, finite numeric bounds, sorted/capped arrays, and rejection of private/raw fields.
2. Run focused tests and confirm failure for missing schema.
3. Implement strict Zod schemas and inferred public types.
4. Add adversarial leakage fixtures containing `url`, `session_name`, PromQL, SQL, hostnames, tokens, raw FRM names, and private locations; require rejection/absence.
5. Document the route/query/envelope and rerun focused tests/typecheck.
6. Commit `feat(power): define public power contracts`.

### Task 3: Extend private runtime configuration (TDD)

**Files:**
- Modify: `src/lib/server/config/runtime-config.ts`
- Modify: `src/lib/server/config/runtime-config.test.ts`
- Modify: `.env.example`
- Modify: `compose.example.yml`
- Modify: `docs/deployment-unraid.md`

**Rollback-safe private configuration:**

```ts
type PrometheusServerEntry = {
  serverId: string;
  baseUrl: string;
  urlLabel: string;
  sessionLabel: string;
};
```

Store these entries in a separate optional strict `PROMETHEUS_SERVERS_JSON`, joined by existing opaque server ID. Do **not** add keys to `SERVERS_JSON`: v0.1.0 parses those entries strictly, so extra keys would break image-only rollback. The previous image safely ignores the new environment variable.

**Steps:**

1. Add RED tests for valid single/multi-server history config, missing history config, unknown server references, embedded credentials, non-HTTP schemes, duplicate/unknown keys, and public-catalog non-leakage.
2. Decide whether Prometheus is optional per server; recommended: current power may remain live while history is unavailable.
3. Generalize safe internal HTTP URL validation without weakening FRM messages/tests.
4. Parse private selectors only from `PROMETHEUS_SERVERS_JSON`; never place them in legacy `SERVERS_JSON` or infer them from browser input.
5. Update deployment examples without real internal values or credentials.
6. Run focused tests/typecheck and commit `feat(config): add private power history selectors`.

### Task 4: Extract a shared bounded HTTP transport (TDD)

**Files:**
- Create: `src/lib/server/adapters/http/bounded-json-client.ts`
- Create: `src/lib/server/adapters/http/bounded-json-client.test.ts`
- Modify: `src/lib/server/adapters/frm/frm-overview-adapter.ts`
- Modify: `src/lib/server/adapters/frm/frm-overview-adapter.test.ts`

**Steps:**

1. Add RED transport tests for redirect rejection, timeout/abort, declared and streamed byte caps, malformed JSON, cancellation, and sanitized typed failures.
2. Extract only transport behavior already proven by Slice 1; preserve overview behavior byte-for-byte at its public boundary. Later have overview normalization delegate to the shared pure power helper while regression tests prove unchanged public output.
3. Re-run existing overview adapter/service/route tests before continuing.
4. Commit `refactor(adapters): share bounded private JSON transport`.

### Task 5: Implement the FRM power adapter (TDD)

**Files:**
- Create: `src/lib/server/adapters/frm/frm-power-adapter.ts`
- Create: `src/lib/server/adapters/frm/frm-power-adapter.test.ts`
- Create redacted, revision-labeled fixtures only if policy permits: `src/lib/server/adapters/frm/__fixtures__/power-*.json`

**Steps:**

1. Bind the sanitized Task 0 fixtures, then write RED tests for all `getPower` fields, semantically unresolved `PowerProduction` stripping, valid empty/no-circuits, zero capacity, negative headroom, fuse aggregation, malformed battery times, multiple circuits, and unexpected numeric values.
2. Add RED tests for strict-subset generator and consumer records, response-size limits, deterministic ranking, output cap, and location/inventory stripping.
3. Implement fixed endpoint reads and normalization into `PowerProvider` results.
4. Keep totals/circuits successful when optional generator or consumer detail fails; emit its explicit `{state:"unavailable",items:[]}` section while valid empty reads remain live.
5. Cross-check the overview power summary against the same normalized circuit helper to prevent semantic drift.
6. Run adapter + overview regressions and commit `feat(frm): add normalized power provider`.

### Task 6: Implement fixed Prometheus history adapter (TDD)

**Files:**
- Create: `src/lib/server/adapters/prometheus/prometheus-power-history-adapter.ts`
- Create: `src/lib/server/adapters/prometheus/prometheus-power-history-adapter.test.ts`
- Create: `src/lib/server/adapters/prometheus/prometheus-schemas.ts`

**Named templates:**

- capacity: `power_capacity{private selectors}`
- consumption: `power_consumed{private selectors}`
- corrected maximum: `power_max_consumed{private selectors}`

Templates are constants internal to the adapter. Do not accept or return query strings.

**Steps:**

1. Write RED tests for every range/requested-resolution cell, exact auto-coarsening/effective-step behavior, independent 2,000-point enforcement, and server-owned label escaping.
2. Write RED tests for valid matrix responses, warnings/errors, string timestamps/values, NaN/Inf, duplicate series, unexpected labels, cardinality/point overflow, timeout, redirect, and response-byte overflow.
3. Implement one `PowerHistoryProvider.getHistory` method that returns application-keyed normalized series and uses the shared `bounded-json-client.ts` transport with its redirect, timeout, streamed-byte, and typed-failure guarantees.
4. Represent production history as unsupported in the service/public contract; do not issue a query for it.
5. Run focused tests/typecheck and commit `feat(prometheus): add bounded power history provider`.

### Task 7: Compose independent source freshness (TDD)

**Files:**
- Create: `src/lib/server/services/power-service.ts`
- Create: `src/lib/server/services/power-service.test.ts`
- Modify: `src/lib/server/providers/provider-factory.ts`
- Modify: `src/lib/server/providers/provider-factory.test.ts`
- Create/modify mock providers under `src/lib/server/providers/`.

**Steps:**

1. Add a full matrix of RED tests: both live, FRM-only, Prometheus-only, both unavailable, valid live no-circuits current data, complete/partial/empty retained history, outside-retention rejection, and unsupported production history.
2. Implement independent orchestration; never collapse a Prometheus error into `frm` or erase valid current data. Add a canonical join test proving FRM `CircuitGroupID`, Prometheus `circuit_id`, and consumer `PowerInfo.CircuitGroupID` produce the same decimal string.
3. Add bounded promise coalescing with separate current/history TTLs and maximum entries; do not cache errors indefinitely.
4. Add deterministic mock current/history data and degraded fixtures.
5. Run focused tests and commit `feat(power): compose current and historical providers`.

### Task 8: Add curated HTTP route and abuse policy (TDD)

**Files:**
- Create: `src/app/api/v1/power/route.ts`
- Create: `src/app/api/v1/power/route.test.ts`
- Modify: `src/lib/server/security/rate-limiter.ts`
- Modify relevant limiter tests.

**Steps:**

1. Add RED tests for default server/range/resolution, all allowlisted combinations, unknown params, malformed/non-public IDs, 404/429/503/partial-success behavior, cache headers, and sanitized errors.
2. Resolve `serverId` through the existing registry before creating providers.
3. Use a history-specific limiter and explicit cache policy. Current data must not be stored in shared caches if later fields become sensitive.
4. Validate the final envelope with the public schema before returning it.
5. Run route/service/contracts tests and commit `feat(api): expose curated power endpoint`.

### Task 9: Build the Power page (TDD + responsive browser tests)

**Files:**
- Create: `src/features/power/power-dashboard.tsx`
- Create: `src/features/power/power-dashboard.test.tsx`
- Modify: `src/app/[section]/page.tsx`
- Modify/add Playwright coverage: `e2e/slice2-power.spec.ts`
- Modify styles only in the established component/style locations.

**Steps:**

1. Add RED component tests for loading, source-independent degradation, live no-circuits UX, zero capacity, negative headroom, overload, current batteries absent/present, current fuse alert, circuits, generators, consumers, complete/partial/empty history, and historical-production unavailable disclosure. Do not render current generation.
2. Implement original visualizations; do not copy Grafana UI/assets.
3. Ensure charts are accessible without color alone and have tabular/text summaries.
4. Add desktop and iPhone-sized Playwright flows using deterministic mock mode and same-origin APIs.
5. Run component tests and Playwright; commit `feat(ui): add responsive power operations view`.

### Task 10: Add process-local realtime aggregator (TDD)

**Files:**
- Create: `src/lib/server/realtime/power-aggregator.ts`
- Create: `src/lib/server/realtime/power-aggregator.test.ts`
- Create: `src/lib/server/realtime/frm-power-subscription.ts`
- Create: `src/lib/server/realtime/frm-power-subscription.test.ts`

**State machine:** `idle -> connecting -> live -> backing-off -> connecting`; any state -> `stopping -> idle`. HTTP polling is a bounded alternate producer, not a second simultaneous authority.

**Steps:**

1. Write RED tests for one upstream owner per server, multiple subscribers, initial snapshot, deduped updates, malformed upstream messages, disconnect/reconnect, backoff cap, abort during connect/backoff/poll, last-subscriber cleanup, and shutdown.
2. Implement a typed upstream subscription parser for only `{endpoint:"getPower",data:[...]}` and a `PowerStreamSnapshot` serializer that cannot include detail/history fields.
3. Reuse the FRM power normalization helper; never create a parallel interpretation.
4. Add bounded subscriber/event queues or latest-snapshot replacement to prevent slow-client memory growth.
5. Run fake-timer lifecycle tests and commit `feat(realtime): add shared power aggregator`.

### Task 11: Add same-origin SSE route (TDD)

**Files:**
- Create: `src/app/api/v1/power/stream/route.ts`
- Create: `src/app/api/v1/power/stream/route.test.ts`
- Modify: `src/features/power/power-dashboard.tsx`

**Steps:**

1. Write direct route/stream RED tests for headers, initial snapshot, update, heartbeat, disconnect cleanup, invalid ID, per-client/global limit, producer failure, event byte cap, and no private/raw fields.
2. Implement an abort-aware, `dynamic = "force-dynamic"` SSE route that subscribes to the singleton and always unsubscribes on cancellation.
3. Add browser `EventSource` with bounded reconnect UX and HTTP refresh fallback.
4. Validate through a non-buffering local proxy fixture where feasible; reserve actual reverse-proxy evidence for deployment acceptance.
5. Commit `feat(realtime): expose normalized power SSE`.

### Task 12: Deployment, docs, and full verification

**Files:**
- Modify: `docs/architecture.md`, `docs/security.md`, `docs/deployment-unraid.md`, `docs/requirements-matrix.md`, `TESTING.md`, `README.md`, `CHANGELOG.md`
- Modify: `.github/workflows/ci.yml` only for deterministic Slice 2 contract/smoke gates.

**Steps:**

1. Document monitoring-network attachment without exposing Prometheus publicly or mounting Docker socket.
2. Document private selectors, retention assumptions, rollback, and source-independent health/degradation.
3. Extend CI mock smoke checks and leakage scans for power/history contracts.
4. Run separately, with `set -euo pipefail` semantics:

```bash
npm run verify
npm run test:e2e
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
git diff --check
git status --short
```

5. Validate Compose syntax with an available parser/runtime; do not label static YAML parsing as container-runtime evidence.
6. Perform a fresh-clone/container smoke test in hosted CI and preserve the exact image identity.
7. Deploy first with polling/history HTTP only if SSE proxy validation is not yet green; keep the stream feature disabled rather than overclaiming.
8. On authorized Unraid deployment, prove:
   - current FRM power live;
   - Prometheus history live for supported ranges;
   - historical production disclosed as unavailable;
   - no private labels/URLs/query text in public responses/logs;
   - FRM-only and Prometheus-only degradation paths;
   - SSE heartbeat/update/disconnect through the actual proxy;
   - rollback restores v0.1.0 without monitoring/database mutation; boot v0.1.0 against the post-Slice-2 environment and prove separate `PROMETHEUS_SERVERS_JSON` is harmless.

## 6. Risk review

| Priority | Risk | Impact | Mitigation / stop gate |
|---|---|---|---|
| P0 | Deployed FRM/Companion differs from inspected commits | Schema failure or wrong semantics | Task 0 image/live-shape fixtures bind the initial implementation; stop on later drift. Keep `PowerProduction` omitted unless a separate semantic experiment resolves it. |
| P0 | New history config breaks v0.1.0 strict `SERVERS_JSON` rollback | Full configuration outage after image rollback | Keep history in separate `PROMETHEUS_SERVERS_JSON`; boot-test old image with new environment. |
| P0 | Range/resolution exceeds point cap or behaves unpredictably | Amplification or unstable clients | Frozen auto-coarsening table plus independent 2,000-point guard; exhaustive matrix tests. |
| P0 | Historical production does not exist | Misleading chart if capacity is substituted | Explicit unavailable contract; no production query; add adversarial semantic test. |
| P0 | Private `url`/`session_name` labels leak | Internal topology/save disclosure | Server-only config, domain keys, final public schema validation, full-response leakage tests. |
| P0 | Arbitrary PromQL/labels become request data | Internal query proxy/DoS | Named methods and fixed templates only; query enum maps; reject unknown params. |
| P0 | SSE leaks resources or creates one upstream connection per client | FRM overload/memory exhaustion | Singleton ownership, connection caps, latest-value queues, abort cleanup, lifecycle tests. |
| P1 | FRM `PowerMaxConsumed` and Companion corrected max disagree | Confusing realtime/history transitions | Preserve reported/corrected names; do not present them as identical. |
| P1 | Companion branch-moving build changes metrics silently | Historical/API drift | Pin Companion commit or image digest before acceptance; verify metric metadata. |
| P1 | Session label changes split history | Apparently missing/duplicated history | Configure expected private session label; detect no-series separately; document continuity. Do not query all sessions by default. |
| P1 | Circuit IDs are reused or unstable across saves | Incorrect cross-session joins | Scope to opaque server + configured session; never claim globally stable identity. |
| P1 | Unbounded `getPowerUsage` or Prometheus matrix | Memory/latency amplification | Streamed byte caps, timeouts, series/point caps, top-N, separate limiter/cache. |
| P1 | Battery duration/unit drift | Invalid countdown or mislabeled energy | Nullable bounded parser; live fixtures; exclude unit-suffixed capacity field until proven. |
| P1 | Actual per-series coverage is shorter than configured 15-day retention | Empty/misleading charts | Cap requests at 15 days and return explicit complete/partial/empty coverage separately from source unavailable. |
| P1 | Documented battery/fuse metrics are absent from the deployed metric set | Broken promised panels/queries | Promise only the three observed power metrics; capability-discover optional series and degrade them independently. |
| P1 | Grafana rule intent is ambiguous (`min` aggregation/name) | Wrong risk signal | Treat recording rule as upstream-labeled heuristic; raw series remain chart authority. |
| P1 | Optional generator/consumer reads degrade core current power | Whole page outage | Preserve totals/circuits and emit explicit detail-section state; no accidental all-or-nothing Promise. |
| P1 | Reverse proxy buffers SSE | No visible realtime despite healthy origin | Actual-path heartbeat/update test; retain HTTP polling fallback; feature flag stream. |
| P2 | Process-local cache/aggregator cannot scale horizontally | Duplicate upstream ownership/stale fan-out | One-replica deployment contract; replacement ADR before scaling. |
| P2 | PostgreSQL is prematurely added as a power source | Added secrets/network/schema coupling without data | Keep out of Slice 2 power history; separate future enrichment decision. |
| P2 | Upstream code/dashboard licensing is unclear | Reuse risk | Cite/inspect only; implement original adapters/UI; copy no code/assets. |
| P2 | Summary and power route derivations drift | Inconsistent numbers | One pure normalization/aggregation helper used by both adapters/services. |

## 7. Non-goals

- No game-control, fuse reset, switch mutation, chat, or administrative endpoint.
- No arbitrary FRM proxy, Prometheus proxy, Grafana embedding/API, SQL route, or datasource browser.
- No application database, migrations, or long-term persistence.
- No fabricated historical production.
- No raw map/location/inventory exposure.
- No horizontal-replica realtime guarantee.
- No copied Grafana/FRM UI or proprietary game assets.

## 8. Slice 2 acceptance checklist

- [x] Deployed container bindings, core FRM shapes, observed Companion metrics, and 15-day retention are evidence-bound; embedded FRM source provenance variance is documented.
- [ ] Public power/current/history schemas are strict and leak-free.
- [ ] Initial public current contract omits actual/current generation and strips unresolved FRM `PowerProduction` semantics.
- [ ] Historical production is explicitly unavailable.
- [ ] Capacity, consumption, and corrected maximum history use fixed Prometheus methods; battery/fuse history remains capability-gated and unpromised.
- [ ] FRM and Prometheus degrade independently.
- [ ] Zero capacity, overload, negative headroom, valid live no-circuits, malformed durations, and complete/partial/empty retained history are tested.
- [ ] Generator/consumer detail is bounded and strips raw/private fields.
- [ ] Range, step, bytes, series, points, consumers, timeouts, redirects, and rate limits are bounded.
- [ ] One upstream realtime owner serves multiple clients; disconnect/shutdown cleanup is proven.
- [ ] Actual reverse-proxy SSE evidence is green or SSE remains disabled with polling fallback.
- [ ] Responsive desktop/mobile Power flow passes Playwright.
- [ ] Lint, typecheck, unit/integration, build, browser, audit, Compose/static, and hosted container gates are green against the final tree.
- [ ] Documentation, deployment, security, requirements, and rollback records match the shipped behavior.
