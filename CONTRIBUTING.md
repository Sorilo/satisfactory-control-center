# Contributing

## Before changing code

Read `README.md`, `docs/CONTRACTS.md`, `docs/architecture.md`, `docs/security.md`, and the ADRs relevant to the subsystem.

## Workflow

1. Keep one logical change per branch.
2. Add a failing behavior test before production code.
3. Keep browser-visible contracts in `src/contracts` and server-only integrations in `src/lib/server`.
4. Never add an arbitrary upstream proxy, raw PromQL/SQL input, credentials, private addresses, or proprietary FRM/game assets.
5. Run `npm run verify` and relevant Playwright tests.
6. Update docs for behavior, contract, deployment, or architecture changes.

Do not edit `CHANGELOG.md` in ordinary changes; release automation owns release entries.
