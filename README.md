# Satisfactory Control Center

[![CI](https://github.com/Sorilo/satisfactory-control-center/actions/workflows/ci.yml/badge.svg)](https://github.com/Sorilo/satisfactory-control-center/actions/workflows/ci.yml)

A public-safe, read-only operations portal for multiplayer Satisfactory dedicated servers.

> **Project status:** the production-shaped **Slice 1 foundation is implemented**: responsive shell, deterministic mock mode, curated live FRM overview adapter, multi-server registry, public v1 overview API, health semantics, abuse guard, CI, and a standalone container. The larger major release is intentionally incomplete; each remaining data-rich vertical is tracked in [`docs/requirements-matrix.md`](docs/requirements-matrix.md).

## Principles

- Browser clients communicate only with this application.
- FRM, Prometheus, PostgreSQL, Grafana, Alertmanager, and frmcompanion remain private.
- Every upstream response is parsed and normalized into application-owned contracts.
- No raw FRM path, PromQL, SQL, internal URL, or credential is accepted from or returned to clients.
- One standalone Next.js image runs the frontend and backend-for-frontend.
- Runtime environment configuration selects mock or live providers and supports opaque public server IDs.

## Quick start

```bash
cp .env.example .env.local
npm ci --include=dev
npm run dev
```

Open <http://localhost:3000>. The example uses `DATA_MODE=mock`; no Satisfactory server is required.

## Commands

```bash
npm run lint
npm run typecheck
npm test
PLAYWRIGHT_BROWSERS_PATH=.playwright npx playwright install chromium
npm run test:e2e
npm run build
npm run verify
```

## Container

The production image is published as:

```text
ghcr.io/sorilo/satisfactory-control-center:latest
ghcr.io/sorilo/satisfactory-control-center:v0.1.0
ghcr.io/sorilo/satisfactory-control-center:<full-git-sha>
```

For a source build or local smoke test:

```bash
docker build -t satisfactory-control-center:local .
docker run --rm -p 127.0.0.1:3000:3000 -e DATA_MODE=mock satisfactory-control-center:local
```

Use [`compose.example.yml`](compose.example.yml) and the [Unraid deployment guide](docs/deployment-unraid.md) for the hardened production deployment. Slice 1 attaches only to the existing Satisfactory/FRM Docker network. Never pass secrets as build arguments, mount the Docker socket, or expose upstream ports publicly.

## Documentation

- [v0.1.0 release notes](docs/releases/v0.1.0.md)
- [Architecture](docs/architecture.md)
- [Data sources](docs/data-sources.md)
- [Security](docs/security.md)
- [API contracts](docs/api-contracts.md)
- [Development](docs/development.md)
- [Testing](TESTING.md)
- [Unraid deployment](docs/deployment-unraid.md)
- [Requirements matrix](docs/requirements-matrix.md)
- [ADRs](docs/adr/README.md)

Satisfactory is a trademark of Coffee Stain Studios. This independent project is not affiliated with or endorsed by Coffee Stain Studios. No proprietary game artwork is bundled.
