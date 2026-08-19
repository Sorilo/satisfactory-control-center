# Deploy v0.2.0-rc.1 on Unraid

## Slice 2 release-candidate boundary

`v0.2.0-rc.1` is the Slice 2 release candidate. It adds normalized current Power, strict bounded generator and major-consumer details from fixed FRM endpoints, fixed-query optional Prometheus history, independent detail/source degradation, and an opt-in bounded power-only SSE stream with HTTP polling fallback. It still does **not** include PostgreSQL history, persistence, the full map/location contract, or later data-rich views. Those remain in [`requirements-matrix.md`](requirements-matrix.md).

Published images after the tag release gate succeeds:

- `ghcr.io/sorilo/satisfactory-control-center:latest` — current default branch.
- `ghcr.io/sorilo/satisfactory-control-center:v0.2.0-rc.1` — Slice 2 release candidate.
- `ghcr.io/sorilo/satisfactory-control-center:<full-git-sha>` — exact source revision and preferred RC validation pin.
- `ghcr.io/sorilo/satisfactory-control-center:v0.1.0` — prior Slice 1 rollback release.

Pin the full release-candidate Git SHA for validation, or `v0.2.0-rc.1` when a human-readable prerelease pin is required. The image runs as UID/GID `10001` (`app`), has no development dependencies, contains no runtime credentials, and accepts integration configuration only through runtime environment variables.

## Authenticate and pull

The repository/package is private by default. Create a GitHub token with only `read:packages`, keep it outside the repository, and authenticate on the authorized Unraid terminal without placing it in Compose:

```bash
echo "$GHCR_READ_TOKEN" | docker login ghcr.io --username Sorilo --password-stdin
docker pull ghcr.io/sorilo/satisfactory-control-center:v0.2.0-rc.1
docker image inspect ghcr.io/sorilo/satisfactory-control-center:v0.2.0-rc.1 \
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
| `CONTROL_CENTER_IMAGE` | Defaults to `ghcr.io/sorilo/satisfactory-control-center:v0.2.0-rc.1` | Immutable image reference; the release-candidate full Git SHA is preferred for validation. |
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
| `TRUST_PROXY_HEADERS` | `false` | Enable only behind a trusted proxy that overwrites forwarded-client headers. |
| `POWER_STREAM_ENABLED` | `false` | Enables the bounded power-only SSE route. Keep false until buffering and disconnect cleanup pass through the actual proxy/Tunnel path. |

For live mode, provide either one `FRM_BASE_URL` plus optional `FRM_TOKEN`, or `SERVERS_JSON`. Enabled live entries require HTTP(S) URLs without embedded credentials. The public server catalog exposes only `id` and `displayName`.

Prometheus history is independently optional. `PROMETHEUS_SERVERS_JSON` does not alter `SERVERS_JSON`; unknown or duplicate server references, unknown keys, non-HTTP(S) URLs, and embedded URL credentials fail configuration validation. The configured `baseUrl` must be reachable through a network attached by the site-specific deployment. Do not expose Prometheus publicly merely to satisfy this connection.

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
```

- `/api/health/live` proves the process serves HTTP and is appropriate for restart health.
- `/api/health/ready` validates runtime configuration only. It intentionally does not turn an optional FRM outage into a restart loop.
- The overview envelope is the authoritative live-upstream check.
- The Power envelope reports current FRM and historical Prometheus freshness independently; one unavailable source must not erase the other.

## Opt in to power realtime

Keep `POWER_STREAM_ENABLED=false` for the initial current/history rollout. After ordinary Power requests pass, enable it in the external environment, recreate only Control Center, and validate the stream through the same public reverse-proxy/Tunnel hostname used by browsers—not only loopback. Require an initial `event: power`, periodic heartbeat comments, prompt disconnect cleanup, and no proxy buffering. If validation fails, set the flag back to false; the client continues using the curated Power HTTP route.

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

Keep the previous known-good image tag and external environment file. Roll back by setting `CONTROL_CENTER_IMAGE` to the prior immutable tag and recreating only this service. Slice 1 owns no database migration or persistent application volume.

For a current-only rollback, remove `PROMETHEUS_SERVERS_JSON` (and any site-specific monitoring-network override) while retaining the unchanged FRM `SERVERS_JSON`. No data migration or application volume is involved.
