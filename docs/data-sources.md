# Data sources

This document is the source-grounded compatibility ledger for the Control Center. Source references are pinned to the revisions inspected on 2026-08-18; a moving branch name is never sufficient implementation evidence.

## Evidence ledger

| System | Inspected revision | Role for Slice 2 |
|---|---|---|
| [Ficsit Remote Monitoring (FRM)](https://github.com/porisius/FicsitRemoteMonitoring/tree/32fe64e0c22389a944c27222ef6c881f5e207072) | `32fe64e0c22389a944c27222ef6c881f5e207072` (`main`, plugin `1.5.3`) | Authoritative current game-state reads |
| [FeatheredToast FRM Companion](https://github.com/featheredtoast/FicsitRemoteMonitoringCompanion/tree/725dc8cba4ae16cf533591f252cc15a85370e0c5) | `725dc8cba4ae16cf533591f252cc15a85370e0c5` (`featheredtoast-main`, `version.txt` 1.4.0) | Converts selected FRM fields and calculated values into Prometheus gauges |
| [FeatheredToast satisfactory-monitoring](https://github.com/featheredtoast/satisfactory-monitoring/tree/30cd8668117c17e7953b820edc1f1283a13bb0f1) | `30cd8668117c17e7953b820edc1f1283a13bb0f1` (`main`) | Prometheus/Grafana/alert/frmcache deployment behavior and operational query concepts |

The deployed v0.1.0 live overview has separately established that the configured FRM instance currently normalizes successfully. Source inspection proves an upstream contract; it does not replace redacted fixture capture and live compatibility tests for the deployed versions.

### Task 0 deployed compatibility tuple

Validated on 2026-08-18 through the authorized live deployment path:

| Component | Deployed binding | What this proves |
|---|---|---|
| Satisfactory server | `wolveix/satisfactory-server`, image ID `sha256:5eeddf2ad9391400bf973e47c2cdc8432d06159ea43950a76ee51c57fccc8b97` | Binds the tested game-server container artifact. It does not independently prove the embedded FRM plugin equals the inspected source commit. |
| FRM Companion | `featheredtoast/ficsit-remote-monitoring-companion`, image ID `sha256:6b0f0aa762b0d4c9e727bae3ba495e5a1bdde135757e6113b9741602ea530bc3` | Binds the tested exporter artifact and its observed metric inventory. The unversioned tag alone remains unsuitable as a future deployment pin. |
| Prometheus | `prom/prometheus`, image ID `sha256:8da6d95a8747c08872fbffa86d35a9c39433cbe908ce8e5939ad34087cceac86` | Binds the tested Prometheus artifact. Runtime flags establish time retention of 15 days and no size retention limit. |

Sanitized evidence fixtures are in [`fixtures/slice2-task0/`](fixtures/slice2-task0/). They deliberately exclude internal URLs, labels, hostnames, session names, and credentials.

## Canonical-source matrix for Slice 2

| Product concept | Authoritative current source | Authoritative history source | Notes |
|---|---|---|---|
| Power capacity | FRM `GET /getPower[].PowerCapacity` | Prometheus `power_capacity` | FRM source maps this to maximum production capacity, not current production. |
| Unresolved production value | FRM `GET /getPower[].PowerProduction` | **Unavailable in the existing monitoring stack** | Live FRM returned `PowerProduction: 0` while a 20 MW-capacity circuit consumed 5 MW. This disproves treating the field as self-evident actual/current generation. Preserve it only as an unresolved adapter field or omit it; do not present it as current generation without a controlled experiment or stronger upstream evidence. |
| Consumption | FRM `GET /getPower[].PowerConsumed` | Prometheus `power_consumed` | MW by game/Companion convention. |
| Maximum consumption | FRM `GET /getPower[].PowerMaxConsumed` is the reported value; Companion `power_max_consumed` is the operational corrected value | Prometheus `power_max_consumed` | Companion takes the larger of FRM's reported value and its building-category calculation because the game value is documented in source as unreliable. Keep reported and corrected semantics distinguishable. |
| Headroom | Derived as `PowerCapacity - PowerConsumed` | Derived from `power_capacity - power_consumed` | Can be negative. This is capacity headroom, not `PowerProduction - PowerConsumed`. |
| Utilization | Derived as `PowerConsumed / PowerCapacity * 100` | Derived from the corresponding Prometheus series | Return `null`, not infinity/NaN, when capacity is zero. Do not clamp overload above 100%. |
| Batteries | FRM `getPower` battery fields | **Not observed in the deployed metric set** | Companion source documents battery gauges as a capability, but Task 0 observed only the three `power_*` gauges. Normalize current FRM time strings to bounded numeric seconds; do not promise battery history until metric discovery proves availability. |
| Fuse status | FRM `getPower[].FuseTriggered`; per-building/circuit status is in `PowerInfo.FuseTriggered` | **Not observed in the deployed metric set** | Companion source documents `fuse_triggered`, but it was not observed during Task 0. Current FRM fuse state remains usable and read-only; historical fuse state is capability-gated. |
| Circuit groups and member circuits | FRM `getPower[].CircuitGroupID` and `AssociatedCircuits`; `getPowerUsage[].PowerInfo` joins consumers | No complete circuit topology history | Private `url`/`session_name` labels are selectors, never public identities. |
| Generators | FRM `GET /getGenerators` (or fixed per-type generator endpoints) | No Companion generator series | Generator detail is current-only unless a later approved metric is added upstream. The realtime detail channel polls this endpoint on a shared 30-second cadence and degrades to unavailable independently of the power stream. |
| Major consumers | FRM `GET /getPowerUsage`; the Control Center ranks the validated records server-side by `PowerInfo.PowerConsumed` | Prometheus category gauges provide category history, not per-building history | FRM does not sort the records. Bound input bytes and result count; never return raw IDs, class names, locations, or private labels without an explicit public schema decision. The realtime detail channel polls this endpoint on the same shared 30-second cadence. |
| Historical demand/capacity | Prometheus range queries over `power_consumed`, corrected `power_max_consumed`, and `power_capacity` | Prometheus | These are the three power metrics observed live. Effective retention is 15 days; the existing six-hour recording rules are alert heuristics, not raw history replacements. |
| Historical production | No existing source | No existing source | Defer/mark unavailable until Companion exports a source-reviewed production gauge and Prometheus has retained it. |

## FRM current-state contract

### Transport and endpoint registration

FRM registers the relevant fixed read endpoints in [`FicsitRemoteMonitoring.cpp`](https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/Source/FicsitRemoteMonitoring/Private/FicsitRemoteMonitoring.cpp#L745-L837):

- `GET /getPower`
- `GET /getPowerUsage`
- `GET /getSwitches`
- `GET /getCables`
- `GET /getGenerators`
- `GET /getBiomassGenerator`, `/getCoalGenerator`, `/getFuelGenerator`, `/getGeothermalGenerator`, `/getNuclearGenerator`

There are no separate `getCircuits`, `getBatteries`, `getFuse`, or `getConsumers` registrations. Those concepts are represented by `getPower`, `getPowerUsage`, and nested `PowerInfo`.

HTTP reads return top-level JSON arrays. FRM also supports a same-port WebSocket subscription message with `action: "subscribe" | "unsubscribe"` and one endpoint or endpoint array. The server stores endpoint subscribers and pushes `{ "endpoint": string, "data": array }` messages; the current source reads a default five-second `uWS.PushCycle` ([loop](https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/Source/FicsitRemoteMonitoring/Private/FicsitRemoteMonitoring.cpp#L103-L121), [subscription handling](https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/Source/FicsitRemoteMonitoring/Private/FicsitRemoteMonitoring.cpp#L502-L587)). The Control Center may use that transport privately, but never exposes or tunnels it to the browser.

### `GET /getPower`

The implementation emits one record per power circuit group. The exact fields are defined in [`Power.cpp` lines 18–53](https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/Source/FicsitRemoteMonitoring/Private/Endpoints/Factory/Power.cpp#L18-L53):

| Field | Type | Normalized meaning |
|---|---|---|
| `CircuitGroupID` | integer | Circuit-group identifier |
| `PowerProduction` | finite number | FRM `mBaseProduction`; unresolved semantics, not user-facing actual/current generation |
| `PowerConsumed` | finite number | Current consumption |
| `PowerCapacity` | finite number | Maximum production capacity |
| `PowerMaxConsumed` | finite number | FRM/game-reported maximum consumption |
| `BatteryInput` | finite number | Aggregate battery input |
| `BatteryOutput` | finite number | Aggregate battery output |
| `BatteryDifferential` | finite number | `BatteryInput - BatteryOutput`; positive charges, negative drains |
| `BatteryPercent` | finite number | Stored fraction multiplied by 100; zero when capacity is zero |
| `BatteryCapacity` | finite number | Aggregate stored-energy capacity |
| `BatteryTimeEmpty` | string | Game-formatted duration |
| `BatteryTimeFull` | string | Game-formatted duration |
| `AssociatedCircuits` | integer array | Member circuit IDs |
| `FuseTriggered` | boolean | Any fuse triggered in the group |

FRM emits raw game numeric values without unit metadata. Companion's consumer-category gauge help strings identify their power values as MW, supporting the game-unit convention; circuit-level help strings do not name units. Battery-energy units and the exact `mBaseProduction` semantics must remain documented compatibility assumptions until source/live evidence proves them.

Task 0 observed two valid live shapes:

- `[]` before a power circuit existed or was available. This is a successful live response representing **no circuits**, not an unavailable source or parser failure.
- one circuit with capacity `20`, consumption `5`, maximum consumption `5`, and `PowerProduction: 0`. Capacity, consumption, and maximum consumption are therefore validated deployed fields. The simultaneous zero production value is evidence against presenting `PowerProduction` as actual/current generation without further proof.

The initial public model must normalize a successful empty array to live current freshness, `topologyState: "no-circuits"`, `circuits: []`, and zero aggregate capacity/consumption/maximum values. It must not turn this state into a 503 or source-unavailable response.

### `GET /getPowerUsage`

`getPowerUsage` emits one record per `AFGBuildableFactory`, including base identity, display/class names, location, and nested `PowerInfo` ([endpoint implementation](https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/Source/FicsitRemoteMonitoring/Private/Endpoints/Factory/Power.cpp#L180-L197)). The reusable [`PowerInfo` serializer](https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/Source/FicsitRemoteMonitoring/Private/RemoteMonitoringLibrary.cpp#L628-L654) emits:

- `CircuitGroupID`
- `CircuitID`
- `FuseTriggered`
- `PowerConsumed`
- `MaxPowerConsumed`

Slice 2 uses a strict subset for a bounded major-consumer ranking. It sorts by `PowerConsumed` descending, `MaxPowerConsumed` descending, then deterministic name/circuit and private adapter-only ID tie-breakers; it publishes at most ten records. Positive draw/maximum records qualify, connected zero-draw records may fill unused slots as useful topology evidence, and disconnected all-zero structures are omitted. Raw locations, upstream IDs, class names, and undeclared metadata are discarded at the adapter boundary. `CircuitGroupID: -1` remains `{state:"disconnected",id:"-1"}` rather than being guessed as circuit `0`.

### `GET /getGenerators`

The generator endpoint includes current capacity/load/fuel information and nested `PowerInfo`. Current source fields include `BaseProd`, `DynamicProdCapacity`, `DynamicProdDemandFactor`, `RegulatedDemandProd`, `IsFullSpeed`, `CanStart`, `LoadPercentage`, `ProdPowerConsumption`, `CurrentPotential`, `ProductionCapacity`, `DefaultProductionCapacity`, `PowerProductionPotential`, shard/sloop counts, fuel/waste inventory, fuel-resource classification, geothermal min/max, and `PowerInfo` ([generator mapping](https://github.com/porisius/FicsitRemoteMonitoring/blob/32fe64e0c22389a944c27222ef6c881f5e207072/Source/FicsitRemoteMonitoring/Private/Endpoints/Factory/Power.cpp#L221-L370)). Slice 2 validates the reviewed field shape and publishes at most 100 records containing only display name, explicit circuit state, normalized fuel/inventory, capacity/load, start readiness, and fuse status. It deliberately does not interpret `PowerProduction`, `RegulatedDemandProd`, or dynamic-demand fields as actual current generation. Raw generator IDs, classes, coordinates/orientation, and inventory class identifiers are discarded; no location is public until the original normalized map contract exists.

## Companion metrics contract

Companion exposes `/metrics` on port 9000 and creates fixed collectors for power, production, vehicles/logistics, and power-consuming building categories ([`exporter.go`](https://github.com/featheredtoast/FicsitRemoteMonitoringCompanion/blob/725dc8cba4ae16cf533591f252cc15a85370e0c5/Companion/exporter/exporter.go#L18-L46)). Its collector loop runs every five seconds ([`collector_runner.go`](https://github.com/featheredtoast/FicsitRemoteMonitoringCompanion/blob/725dc8cba4ae16cf533591f252cc15a85370e0c5/Companion/exporter/collector_runner.go#L65-L73)). Every metric is a gauge and receives private `url` and `session_name` labels in addition to the declared labels ([`registration.go`](https://github.com/featheredtoast/FicsitRemoteMonitoringCompanion/blob/725dc8cba4ae16cf533591f252cc15a85370e0c5/Companion/exporter/registration.go#L16-L30)). `session_name` is sanitized by removing non-word/non-space characters and changes invalidate old in-process metric labels.

### Documented circuit-level gauge capability

All have labels `circuit_id`, `url`, `session_name`. Definitions are in [`metrics.go` lines 50–110](https://github.com/featheredtoast/FicsitRemoteMonitoringCompanion/blob/725dc8cba4ae16cf533591f252cc15a85370e0c5/Companion/exporter/metrics.go#L50-L110), and assignment is in [`power_collector.go`](https://github.com/featheredtoast/FicsitRemoteMonitoringCompanion/blob/725dc8cba4ae16cf533591f252cc15a85370e0c5/Companion/exporter/power_collector.go#L22-L147):

| Gauge | Source/semantics |
|---|---|
| `power_consumed` | FRM `PowerConsumed` |
| `power_capacity` | FRM `PowerCapacity` |
| `power_max_consumed` | Maximum of FRM `PowerMaxConsumed` and Companion's category calculation |
| `battery_differential` | FRM `BatteryDifferential` |
| `battery_percent` | FRM `BatteryPercent` |
| `battery_capacity` | FRM `BatteryCapacity` |
| `battery_seconds_empty` | Parsed FRM `BatteryTimeEmpty` |
| `battery_seconds_full` | Parsed FRM `BatteryTimeFull` |
| `fuse_triggered` | FRM boolean represented as 0/1 |

Companion's `PowerDetails` has no `PowerProduction` field. Therefore there is no existing `power_production` gauge; source inspection does not establish why it was omitted.

### Observed deployed availability

Task 0 metric discovery observed only:

- `power_capacity`
- `power_consumed`
- `power_max_consumed`

The documented battery and fuse gauges above were **not observed** in the current live metric set. This is not proof that the exporter can never emit them; it is an availability finding for the tested artifact/state. Slice 2 may rely on the three observed gauges for history. Battery/fuse history must remain `unavailable` or absent unless startup capability discovery confirms the required metric series for the selected server/session.

`power_max_consumed` is not a transparent copy. Companion sums maximum-consumption category gauges and takes that value when larger than FRM's reported maximum ([calculation](https://github.com/featheredtoast/FicsitRemoteMonitoringCompanion/blob/725dc8cba4ae16cf533591f252cc15a85370e0c5/Companion/exporter/power_collector.go#L35-L74)). The source documents unreliable game reporting and hard-coded/formula corrections for variable-rate buildings in [`power_info.go`](https://github.com/featheredtoast/FicsitRemoteMonitoringCompanion/blob/725dc8cba4ae16cf533591f252cc15a85370e0c5/Companion/exporter/power_info.go#L7-L59).

### Consumer-category gauges

Each pair has `circuit_id`, `url`, and `session_name` labels and represents current/max MW by category:

- `factory_power`, `factory_power_max`
- `extractor_power`, `extractor_power_max`
- `drone_port_power`, `drone_port_power_max`
- `fracking_power`, `fracking_power_max`
- `hypertube_power`, `hypertube_power_max`
- `portal_power`, `portal_power_max`
- `pump_power`, `pump_power_max`
- `resource_sink_power`, `resource_sink_power_max`
- `train_power_circuit_consumed`, `train_power_circuit_consumed_max`
- `train_station_power`, `train_station_power_max`
- `vehicle_station_power`, `vehicle_station_power_max`

These are useful for a bounded category breakdown and corrected maximum consumption. They do not identify individual major consumers; current per-building ranking comes from FRM `getPowerUsage`.

## Prometheus, Grafana, and alerts

The monitoring repository configures a global 15-second scrape interval and 10-second rule evaluation, loads `rules/*.yml`, discovers `frmcompanion:9000`, and drops `job` and `instance` labels ([Prometheus config](https://github.com/featheredtoast/satisfactory-monitoring/blob/30cd8668117c17e7953b820edc1f1283a13bb0f1/prometheus/prometheus.yml), [target](https://github.com/featheredtoast/satisfactory-monitoring/blob/30cd8668117c17e7953b820edc1f1283a13bb0f1/prometheus/nodes/node-exporter.yml)). Companion polls every five seconds, but Prometheus persistence is sampled at the configured scrape cadence.

The deployed runtime reports `storage.tsdb.retention.time = 15d` and `storage.tsdb.retention.size = 0B`. Time retention is therefore the active limit. Slice 2 advertises a maximum 15-day request range, reports partial/empty coverage distinctly when fewer samples exist, and rejects ranges beyond the configured horizon rather than implying complete 30-day history.

### Existing recording and alert rules

The exact rules are in [`prometheus/rules/power.yml`](https://github.com/featheredtoast/satisfactory-monitoring/blob/30cd8668117c17e7953b820edc1f1283a13bb0f1/prometheus/rules/power.yml):

```promql
power_consumed_overhead:min6h = min(1.2 * max_over_time(power_consumed[6h])) by (circuit_id,url,session_name)
power_consumed_overhead_or_max_consumed:min6h = min(power_consumed_overhead:min6h or last_over_time(power_max_consumed[1h])) by (circuit_id,url,session_name)
battery_minutes_empty = round(battery_seconds_empty/60)
```

| Alert | Expression | Hold | Meaning |
|---|---|---:|---|
| `FuseTriggered` | `fuse_triggered > 0` | none | Circuit-group fuse is triggered |
| `BatteryDrained` | `0 < battery_minutes_empty and battery_minutes_empty < 1800` | 10s | Battery has under 1,800 minutes remaining; despite its name, this means nearly drained, not empty |
| `BatteryDraining` | `battery_differential < 0` | 10s | Batteries are discharging |
| `MaxConsumption` | `power_capacity < power_consumed_overhead_or_max_consumed:min6h` | 10s | Corrected/observed demand threshold exceeds capacity |

The `min(...) by (...)` rule names and comments are preserved as upstream behavior, not treated as mathematically self-evident intent. Slice 2 should query raw series for charts and may use the named recorded threshold as an explicitly labeled operational risk signal.

### Grafana Power dashboard query inventory

The inspected dashboard is [`grafana/dashboards/power.json`](https://github.com/featheredtoast/satisfactory-monitoring/blob/30cd8668117c17e7953b820edc1f1283a13bb0f1/grafana/dashboards/power.json), UID `OFv4PopVz`, refresh `5s`. Its variables are private selectors:

- `server`: `label_values(url)`
- `session`: `label_values({url="$server"},session_name)`
- `circuit`: `{circuit_id=~".+",url=~"$server",session_name=~"$session"}`

Relevant panel expressions:

| Panel ID | Concept | Existing expression(s) |
|---:|---|---|
| 12 | Fuse | `fuse_triggered{circuit_id="$circuit", url="$server", session_name="$session"}` |
| 4 | Battery charge | `battery_percent{...}` |
| 10 | Battery time | `battery_seconds_empty{...} / 60` |
| 19 | Battery rate | `battery_differential{...}` |
| 2 | Power history | `power_capacity{...}`, `power_max_consumed{...}`, `power_consumed{...}`, `power_consumed_overhead_or_max_consumed:min6h{...}` |
| 29 | Category breakdown | `power_consumed{...}` plus `sum(last_over_time(<category>_power{...}[$__range]) or vector(0))` for the eleven categories; the dashboard calculates an unclassified remainder |
| 30/31/35/36 | Category detail | Current/max pairs for factory, vehicle station, train station, and trains |

Panels 26 and 28 query PostgreSQL `cache` only to map/count factory and extractor records by `PowerInfo.CircuitGroupID`. Grafana remains a private diagnostic UI and query-design reference; the public application neither embeds Grafana nor depends on its login/API.

### Control Center historical query policy

Slice 2 uses application-owned named methods and fixed server-side query templates. The browser may choose only bounded product parameters such as opaque `serverId`, allowed range up to 15 days, and allowed resolution. It cannot supply metric names, label names/values, PromQL, datasource identifiers, URLs, or arbitrary timestamps outside declared bounds.

Prometheus response bodies, series counts, points per series, range, step, wall-clock duration, redirects, and timeouts are bounded before normalization. `url` and `session_name` selectors are resolved from private runtime configuration and are never serialized or logged.

## frmcache/PostgreSQL behavior

frmcache is part of the monitoring repository, not a separate power-timeseries service. It reads FRM arrays, stores each object as JSONB, and owns migrations for `cache` and `cache_with_history` ([worker](https://github.com/featheredtoast/satisfactory-monitoring/blob/30cd8668117c17e7953b820edc1f1283a13bb0f1/frmcache/src/app/cache_worker.go), [migrations](https://github.com/featheredtoast/satisfactory-monitoring/tree/30cd8668117c17e7953b820edc1f1283a13bb0f1/frmcache/src/db)). The effective columns are:

- `cache(id, metric, data jsonb, url, session_name)` — current snapshot, replaced per metric/server/session
- `cache_with_history(id, metric, data jsonb, time timestamp, url, session_name)` — short positional/raw history

Indexes exist on metric, time, and `(url, session_name)`. History older than one hour is deleted per metric/server/session, and history is flushed at process start and on a session-name transition. The worker polls realtime groups every five seconds and low-cadence groups every 60 seconds.

Crucially, [`pullLowCadenceMetrics` and `pullRealtimeMetrics`](https://github.com/featheredtoast/satisfactory-monitoring/blob/30cd8668117c17e7953b820edc1f1283a13bb0f1/frmcache/src/app/cache_worker.go#L185-L239) do **not** include `getPower`. frmcache therefore provides no power history. Its `cache` table may later enrich circuit membership/location from current factory/extractor records, but that is not required for the Slice 2 power timeseries and must use a separate SELECT-only adapter if adopted.

The Control Center never runs frmcache migrations, writes this database, or relies on the monitoring repository's development credentials/TLS defaults. PostgreSQL access stays deferred for Slice 2 unless a narrowly scoped current circuit-enrichment requirement is approved after live read-only schema introspection.

## Compatibility assumptions and gates

1. **Pinned source versus deployed artifacts:** deployed container image IDs are now bound above, but the Satisfactory image ID does not independently prove the embedded FRM plugin equals inspected commit `32fe64e…`. The sanitized live field shapes are the implementation compatibility authority until a plugin build identity is captured.
2. **Valid empty FRM response:** `GET /getPower` can legitimately return `[]` before a circuit exists or is available. Treat it as live/no-circuits, not source failure.
3. **Production/unit assumptions:** live evidence shows `PowerProduction: 0` alongside 20 MW capacity and 5 MW consumption. Omit actual/current generation from the initial user-facing contract. Preserve `PowerProduction` only as an unresolved upstream field pending a controlled experiment or stronger implementation evidence. Companion's consumer-category help strings describe power as MW, while FRM JSON and Companion's circuit-level help strings do not carry unit metadata. Battery capacity's exact energy unit remains provisional.
4. **Production history gap:** no existing Companion gauge persists `PowerProduction`. Historical production is explicitly unavailable; no capacity/consumption surrogate is allowed.
5. **Corrected maximum semantics:** `power_max_consumed` can exceed FRM's reported value because Companion computes category maxima and hard-codes variable-rate corrections. Public naming/documentation must make this operational correction clear.
6. **Label identity is private and unstable:** `url` is an internal FRM address and `session_name` is a sanitized save/session label that can change. Both are server-side selectors, not public IDs. Multi-save continuity needs an explicit policy.
7. **Circuit IDs are numeric upstream labels, not globally stable identities:** scope them to an opaque configured server and observed session. Do not assume reuse stability across save/session changes.
8. **Battery duration parsing:** Companion accepts a strict `HH:MM:SS` pattern. FRM format changes or non-padded components can omit the series. The FRM adapter needs its own bounded parser and nullable result contract.
9. **Companion artifact is bound but provenance remains branch-moving:** Task 0 records deployed image ID `sha256:6b0f…0bc3`; the monitoring Dockerfile clones moving branch `featheredtoast-main` rather than a commit ([Dockerfile](https://github.com/featheredtoast/satisfactory-monitoring/blob/30cd8668117c17e7953b820edc1f1283a13bb0f1/frmcompanion/Dockerfile#L1-L13)). Preserve the image ID for rollback and pin future builds by immutable revision/digest.
10. **Scrape versus collection cadence:** Companion polls every five seconds; Prometheus currently scrapes every 15 seconds. Historical resolution cannot exceed retained scrape samples.
11. **Prometheus retention is deployment-owned and observed at 15 days:** `storage.tsdb.retention.time=15d` and `storage.tsdb.retention.size=0B`. Advertise no range beyond 15 days; distinguish configured horizon from actual per-series sample coverage.
12. **Documented capability is not observed availability:** Companion source lists battery/fuse gauges, but Task 0 observed only `power_capacity`, `power_consumed`, and `power_max_consumed`. Historical battery/fuse remains optional and unavailable until metric discovery proves it for the selected deployment.
13. **Grafana queries are evidence, not a public API:** dashboard PromQL/SQL is not copied into request parameters or returned to clients. Application query templates are independently named, reviewed, tested, and bounded.
14. **No database power fallback:** frmcache has no power rows and only one-hour history for selected non-power entities. PostgreSQL failure must not affect FRM realtime or Prometheus history.
15. **License boundary:** source inspection and citation do not grant permission to copy upstream code/assets. The Control Center implements original adapters and queries over documented normalized concepts.

## Mock provider

The deterministic mock provider supplies domain-owned populated, empty, and degraded cases in CI. Slice 2 fixtures must model normalized power snapshots and historical series, not copy private live payloads or promise unsupported historical production. The Task 0 fixtures preserve the sanitized populated and valid-empty FRM shapes, observed Companion metric names, retention settings, and image IDs that future adapter tests must bind explicitly.
