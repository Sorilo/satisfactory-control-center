# Deploy v0.2.0-rc.6 on Unraid

## Slice 3 production-candidate boundary

`v0.2.0-rc.6` is the current Slice 3 release candidate. It retains the RC.5 Power runtime and source-aware history cache correction, and adds the bounded current-only Production view backed by normalized FRM `getProdStats` data. Production history remains explicitly unsupported until selected-deployment retention evidence exists; no PostgreSQL, Prometheus production history, Grafana, or Map work is included. `POWER_STREAM_ENABLED` remains opt-in and disabled by default. The operator-validated Power profile uses a 5-second Prometheus cadence; the repository-safe application default remains 15 seconds outside that profile.

Published images after the tag release gate succeeds:

- `ghcr.io/sorilo/satisfactory-control-center:latest` — current default branch.
- `ghcr.io/sorilo/satisfactory-control-center:v0.2.0-rc.6` — current Slice 3 release candidate.
- `ghcr.io/sorilo/satisfactory-control-center:<full-git-sha>` — exact source revision and preferred RC validation pin.
- `ghcr.io/sorilo/satisfactory-control-center:v0.2.0-rc.5` — prior validated Power rollback release.
- `ghcr.io/sorilo/satisfactory-control-center:v0.2.0-rc.4` — earlier Slice 2 rollback release.
- `ghcr.io/sorilo/satisfactory-control-center:v0.1.0` — prior Slice 1 rollback release.

Pin the full release-candidate Git SHA for validation, or `v0.2.0-rc.6` when a human-readable prerelease pin is required. The image runs as UID/GID `10001` (`app`), has no development dependencies, contains no runtime credentials, and accepts integration configuration only through runtime environment variables.

## Authenticate and pull

The repository/package is private by default. Create a GitHub token with only `read:packages`, keep it outside the repository, and authenticate on the authorized Unraid terminal without placing it in Compose:

```bash
echo "$GHCR_READ_TOKEN" | docker login ghcr.io --username Sorilo --password-stdin
docker pull ghcr.io/sorilo/satisfactory-control-center:v0.2.0-rc.6
docker image inspect ghcr.io/sorilo/satisfactory-control-center:v0.2.0-rc.6 \
  --format '{{.Config.User}} {{json .Config.Healthcheck.Test}}'
```

Expected user: `app`. Never use build arguments for URLs or tokens.

## Discover required private networks

The base Compose contract requires only the existing Satisfactory/FRM Docker network. Live Prometheus history additionally requires reachability to Prometheus, normally through an existing private monitoring network added in a site-owned Compose override. No mode needs database, Docker-socket, or management-plane access.

On an authorized Unraid terminal, inspect rather than guess:

```bash
docker network ls
docker network inspect <candidate-game-network>
```

Confirm the FRM service alias and set that exact network as `GAME_NETWORK`. When enabling history, inspect and attach the existing monitoring network only if Prometheus is not reachable on the game network. Never mount `/var/run/docker.sock` and never publish the Prometheus port.

## Runtime environment

Copy `.env.example` to an Unraid-managed path outside the repository and image.

| Variable | Required/default | Purpose |
|---|---|---|
| `CONTROL_CENTER_IMAGE` | Defaults to `ghcr.io/sorilo/satisfactory-control-center:v0.2.0-rc.6` | Immutable image reference; the release-candidate full Git SHA is preferred for validation. |
| `CONTROL_CENTER_BIND` | `127.0.0.1` | Host bind address. Change only when the LAN/reverse-proxy design requires it. |
| `CONTROL_CENTER_PORT` | `3000` | Host-side application port. |
| `GAME_NETWORK` | `sorilonet` placeholder | Existing external network shared with Satisfactory/FRM; inspect and replace if different. |
| `DATA_MODE` | `mock` | Set deliberately to `live` for FRM connectivity. |
| `DEFAULT_SERVER_ID` | `main` | Opaque public ID; must match `[a-z0-9][a-z0-9_-]{0,63}`. |
| `DEFAULT_SERVER_NAME` | `Main World` | Public display name. |
| `FRM_BASE_URL` | Required for single-server live mode | Server-only HTTP(S) FRM base URL using its Docker-network alias. |
| `FRM_TOKEN` | Optional | Server-only FRM read token; never place it in the image or repository. |
| `SERVERS_JSON` | Optional alternative to single-server fields | Multi-server registry with unique opaque IDs and server-only URLs/tokens. |
| `PROMETHEUS_SERVERS_JSON` | Optional; defaults to no history source | Separate strict array of `{serverId,baseUrl,urlLabel,sessionLabel}` mappings. Each `serverId` must already exist in the FRM registry. Values remain server-only. |
| `PROMETHEUS_SCRAPE_INTERVAL_SECONDS` | `15` repository-safe default; `5` in the validated Unraid Power profile | Source cadence used for retained Power history. Do not set `5` unless the selected Prometheus deployment is configured and verified at a 5-second global scrape interval. |
| `TRUST_PROXY_HEADERS` | `false` | Enable only behind a trusted proxy that overwrites forwarded-client headers. |
| `POWER_STREAM_ENABLED` | `false` | Enables the bounded power SSE route, including the additive `power-details` channel. Keep false until buffering and disconnect cleanup pass through the actual proxy/Tunnel path. |

For live mode, provide either one `FRM_BASE_URL` plus optional `FRM_TOKEN`, or `SERVERS_JSON`. Enabled live entries require HTTP(S) URLs without embedded credentials. The public server catalog exposes only `id` and `displayName`.

Prometheus history is independently optional. `PROMETHEUS_SERVERS_JSON` does not alter `SERVERS_JSON`; unknown or duplicate server references, unknown keys, non-HTTP(S) URLs, and embedded URL credentials fail configuration validation. The configured `baseUrl` must be reachable through a network attached by the site-specific deployment. Do not expose Prometheus publicly merely to satisfy this connection.

The operator-validated Unraid Power deployment uses the following monitoring profile:

```yaml
global:
  scrape_interval: 5s
  evaluation_interval: 10s
```

The matching Control Center environment sets `PROMETHEUS_SCRAPE_INTERVAL_SECONDS=5`. Retention remains `storage.tsdb.retention.time=15d` with `storage.tsdb.retention.size=0B`, and the application retains the existing 2,000-point-per-series bound. This 5-second setting is deployment-specific evidence and must not be generalized to an unverified Prometheus deployment; the repository-safe default remains `15` for mock mode and rollback. If another operator deployment remains at 15s, leave the application value at `15`; a requested 5s history resolution must return structured unsupported coverage without issuing an upstream query.

## Start in mock mode

```bash
docker compose --env-file /path/outside/repo/control-center.env \
  -f compose.example.yml pull
docker compose --env-file /path/outside/repo/control-center.env \
  -f compose.example.yml up -d
docker compose --env-file /path/outside/repo/control-center.env \
  -f compose.example.yml ps
```

The Compose contract adds a read-only root filesystem, bounded `/tmp` tmpfs, dropped capabilities, `no-new-privileges`, PID/memory bounds, and only the external game network. If Prometheus is not reachable on that network, add the existing private monitoring network in an Unraid-managed Compose override only when enabling history; do not require it for mock/current-only rollback.

## Verify liveness, readiness, and API contracts

```bash
curl --fail --silent http://127.0.0.1:3000/api/health/live | jq -e '.status == "live"'
curl --fail --silent http://127.0.0.1:3000/api/health/ready | jq -e '.status == "ready"'
curl --fail --silent http://127.0.0.1:3000/api/v1/servers | \
  jq -e '.defaultServerId and (.servers | length > 0)'
curl --fail --silent 'http://127.0.0.1:3000/api/v1/overview?serverId=main' | \
  jq -e '.apiVersion == "v1" and .serverId == "main"'
curl --fail --silent 'http://127.0.0.1:3000/api/v1/power?serverId=main&range=6h&resolution=auto' | \
  jq -e '
    .apiVersion == "v1" and .serverId == "main" and
    .data.current != null and
    (.data.current.generators.state == "live") and
    (.data.current.generators.items | type == "array") and
    (.data.current.majorConsumers.state == "live") and
    (.data.current.majorConsumers.items | length <= 10) and
    ([.. | objects | keys[]] | any(. == "location" or . == "ClassName" or . == "PowerProduction") | not)
  '

curl --fail --silent 'http://127.0.0.1:3000/api/v1/production?serverId=main' | \
  jq -e '
    .apiVersion == "v1" and .serverId == "main" and
    .data.history.state == "unsupported" and
    .data.history.reason == "production-history-not-observed" and
    ([.. | objects | keys[]] | any(. == "ClassName" or . == "items_produced_per_min" or . == "http" or . == "location") | not)
  '
```

- `/api/health/live` proves the process serves HTTP and is appropriate for restart health.
- `/api/health/ready` validates runtime configuration only. It intentionally does not turn an optional FRM outage into a restart loop.
- The overview envelope is the authoritative live-upstream check.
- The Power envelope reports current FRM and historical Prometheus freshness independently; one unavailable source must not erase the other.

## Opt in to power realtime

Keep `POWER_STREAM_ENABLED=false` for the initial current/history rollout. After ordinary Power requests pass, enable it in the external environment, recreate only Control Center, and validate the stream through the same public reverse-proxy/Tunnel hostname used by browsers—not only loopback. Require an initial `event: power`, the slower `event: power-details` cadence (about every 30 seconds), periodic heartbeat comments, prompt disconnect cleanup, and no proxy buffering. If validation fails, set the flag back to false; the client continues using the curated Power HTTP route.

The detail channel is additive and does not promote the stream out of its opt-in, disabled-by-default state: it shares the same `POWER_STREAM_ENABLED` gate and connection limits, and its availability never blocks the accepted power stream. A direct-LAN test path (browsing `http://<host>:3000` and opening the stream without the reverse proxy/Tunnel) does not exercise the buffering and disconnect behavior the public path will; treat it only as a smoke check and keep the authoritative validation on the same public hostname browsers use.

When `TRUST_PROXY_HEADERS=false`, all public clients intentionally share one conservative rate-limit identity, so at most three Power streams can be active across the deployment. To use distinct per-client quotas, terminate access at a trusted proxy that strips and overwrites forwarded-client headers, set `TRUST_PROXY_HEADERS=true`, and prevent direct access to application port 3000.

## Enable and verify live FRM connectivity

1. Set `DATA_MODE=live` and the reviewed `FRM_BASE_URL`/optional `FRM_TOKEN`, or `SERVERS_JSON`, in the external environment file.
2. Recreate only this service.
3. Require readiness and then require a live overview with no unavailable sources:

```bash
docker compose --env-file /path/outside/repo/control-center.env \
  -f compose.example.yml up -d --force-recreate
curl --fail --silent http://127.0.0.1:3000/api/health/ready | jq -e '.status == "ready"'
curl --fail --silent 'http://127.0.0.1:3000/api/v1/overview?serverId=main' | \
  jq -e '.apiVersion == "v1" and .freshness.state == "live" and .data != null and .unavailableSources == []'
```

A response with `freshness.state == "unavailable"`, `data == null`, and `unavailableSources` containing `"frm"` means application configuration was valid but live FRM connectivity or normalization failed. Inspect sanitized logs with:

```bash
docker compose --env-file /path/outside/repo/control-center.env \
  -f compose.example.yml logs --tail 200 control-center
```

Never paste environment dumps, tokens, or raw credentials into support channels.

## Reverse proxy

- Terminate TLS at the reverse proxy or Cloudflare Tunnel.
- Preserve same-origin `/api/*` routing and overwrite—do not append untrusted values to—`X-Forwarded-For`.
- Apply an outer per-IP/CDN rate limit. The in-process bounded bucket is defense-in-depth for one replica and is not distributed.
- Forward only application port 3000.

## Rollback

Keep the previous known-good image tag and external environment file. To roll back RC.6, set `CONTROL_CENTER_IMAGE=ghcr.io/sorilo/satisfactory-control-center:v0.2.0-rc.5`, retain `PROMETHEUS_SCRAPE_INTERVAL_SECONDS=5` for the validated Power profile, set `POWER_STREAM_ENABLED=false`, and recreate only Control Center. The RC.5 rollback removes the current-only Production view but requires no application data migration or persistent volume.

For a current-only rollback, remove `PROMETHEUS_SERVERS_JSON` (and any site-specific monitoring-network override) while retaining the unchanged FRM `SERVERS_JSON`. No data migration or application volume is involved.
