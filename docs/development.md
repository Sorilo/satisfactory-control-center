# Development

## Requirements

Node.js 22+, npm 10+, and Docker only for optional image validation. No Docker socket access is required by the application.

## Mock mode

Copy `.env.example` to `.env.local`. `DATA_MODE=mock` is deterministic and populates supported slices without a live server. Security validation remains enabled in mock mode.

## Live mode

Set `DATA_MODE=live` and server-only URLs/tokens. Do not use production credentials in tests. Capture representative FRM payloads only after redacting player/private data and secrets; fixtures must document their upstream version.

## Quality gates

Use test-first RED/GREEN cycles for behavior. Run `npm run verify`; run Playwright for changed user workflows. For UI work, verify desktop, narrow, and phone viewports plus keyboard focus, empty, loading, and unavailable states.

## Dependency strategy

`package-lock.json` pins builds. Dependabot proposes monthly npm and Actions updates. Security patches may be expedited after focused compatibility tests.
