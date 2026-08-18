# Testing

## Local gates

- `npm test` — Vitest unit/integration suite. The script forces `NODE_ENV=test` because some hosts export production mode.
- `npm run lint` — ESLint with zero warnings allowed.
- `npm run typecheck` — strict TypeScript.
- `npm run build` — optimized standalone Next.js build.
- `npm run verify` — lint, typecheck, unit tests, and production build.

## Browser acceptance

Install the pinned Chromium browser in the project-local ignored cache, then run both desktop and phone/touch projects:

```bash
PLAYWRIGHT_BROWSERS_PATH=.playwright npx playwright install chromium
npm run test:e2e
```

The mobile project uses Chromium with the Playwright iPhone viewport/touch profile so it can run on minimal Linux hosts without WebKit system packages. CI installs Chromium system dependencies. Manual Safari/iPhone verification remains required for changes involving complex gestures, viewport-safe areas, or browser-specific streaming behavior.

## Container acceptance

The GitHub Actions `Authoritative container release gate` is mandatory because the development host has no usable Docker daemon, Compose implementation, or daemonless OCI builder. It renders the Compose contract, builds the production image, runs that image non-root with a read-only filesystem, dropped capabilities, and `no-new-privileges`, verifies those runtime settings explicitly, then checks liveness, readiness, the server catalog, and the public overview contract. The exact tested image is exported for the dependent GHCR publication job; the publisher does not rebuild it.

## Live integration policy

Live integration is opt-in. Use a dedicated FRM read token and, in future history slices, a read-only PostgreSQL role. Never require private infrastructure in CI. Representative fixtures must be redacted, version-bound, and reviewed before commit.
