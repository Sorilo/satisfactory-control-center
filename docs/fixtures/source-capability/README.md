# Phase 0 source-capability fixtures

These are synthetic, sanitized checkpoint fixtures for parser, contract, privacy, and documentation tests. They are not copied live payloads and are not deployment credentials.

Files:

- `upstream-capabilities.json` — immutable source revisions and capability/negative-findings matrix.
- `deployment-validation.json` — result of the authorized live-validation attempt; the unresolved alias is recorded as a blocker, with no direct-root fallback.
- `history-contract-matrix.json` — source cadence, retention, resolution, series, point, and cardinality gates currently accepted by the product contract.

Sanitization rules:

- IDs use `fixture-*` values only.
- Coordinates are zeroed or omitted.
- Player, station, vehicle, session, save, hostname, URL, label, token, password, SQL, PromQL, and connection-string values are omitted.
- Example/default secrets found in upstream deployment source are represented as `[REDACTED]` and are not retained here.
- Raw upstream JSON is never treated as a public contract. Future adapter tests must parse it into application-owned normalized models before serialization.

Evidence date: 2026-08-21. Pinned source tree hashes are recorded in `upstream-capabilities.json`; live deployment validation is explicitly separate from source inspection.
