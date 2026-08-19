# Deploy v0.1.0 on Unraid

## Slice 1 release boundary

Slice 1 ships one public-safe, read-only Next.js control-center image with a responsive shell, deterministic mock mode, curated live FRM overview reads, opaque multi-server selection, versioned overview/server APIs, and health endpoints. It does **not** include Prometheus/PostgreSQL history, realtime SSE aggregation, persistence, the full map, or the later data-rich views. Those remain in [`requirements-matrix.md`](requirements-matrix.md).

Published images:

- `ghcr.io/sorilo/satisfactory-control-center:latest` — current default branch.
- `ghcr.io/sorilo/satisfactory-control-center:v0.1.0` — Slice 1 release.
- `ghcr.io/sorilo/satisfactory-control-center:<full-git-sha>` — exact source revision.

Pin `v0.1.0` or a full SHA in production. The image runs as UID/GID `10001` (`app`), has no development dependencies, contains no runtime credentials, and accepts integration configuration only through runtime environment variables.

## Authenticate and pull

The repository/package is private by default. Create a GitHub token with only `read:packages`, keep it outside the repository, and authenticate on the authorized Unraid terminal without placing it in Compose:

```bash
echo "$GHCR_READ_TOKEN" | docker login ghcr.io --username Sorilo --password-stdin
docker pull ghcr.io/sorilo/satisfactory-control-center:v0.1.0
docker image inspect ghcr.io/sorilo/satisfactory-control-center:v0.1.0 \
  --format '{{.Config.User}} {{json .Config.Healthcheck.Test}}'
```

Expected user: `app`. Never use build arguments for URLs or tokens.

## Discover the one required network

Slice 1 requires only the existing Satisfactory/FRM Docker network. It does not need monitoring, database, Docker-socket, or management-plane access.

On an authorized Unraid terminal, inspect rather than guess:

```bash
docker network ls
docker network inspect <candidate-game-network>
```

Confirm the FRM service alias and set that exact network as `GAME_NETWORK`. Never mount `/var/run/docker.sock`. Add a monitoring network only in a later slice that actually implements Prometheus/PostgreSQL access.

## Runtime environment

Copy `.env.example` to an Unraid-managed path outside the repository and image.

| Variable | Required/default | Purpose |
|---|---|---|
| `CONTROL_CENTER_IMAGE` | Defaults to `ghcr.io/sorilo/satisfactory-control-center:v0.1.0` | Immutable image reference; a full Git SHA is preferred for maximum pinning. |
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
```

- `/api/health/live` proves the process serves HTTP and is appropriate for restart health.
- `/api/health/ready` validates runtime configuration only. It intentionally does not turn an optional FRM outage into a restart loop.
- The overview envelope is the authoritative live-upstream check.

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
