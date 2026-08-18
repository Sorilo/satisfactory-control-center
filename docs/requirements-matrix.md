# Goal-to-deliverable matrix

This matrix prevents a production-shaped foundation from being mistaken for the requested major release.

| Requirement | Slice 1 evidence | Major release status |
|---|---|---|
| One standalone Docker image | Dockerfile + hosted CI build/runtime smoke gate | Authoritative container evidence is required before each publication |
| Mock/live modes | Deterministic mock + reviewed FRM overview adapter | Broader live providers pending |
| Curated read-only boundary | Opaque IDs, fixed endpoints, Zod allowlists, size/timeout bounds | Enforced; extend per route |
| FRM realtime | HTTP overview adapter and architecture | SSE/WS aggregator pending |
| Prometheus history | Architecture and named-provider rule | Slice 2+ |
| PostgreSQL history | Deferred until read-only schema inspection | Pending |
| Full original map | Original-design/licensing decision | Slice 4 |
| 11 first-class views | Responsive navigation and honest staged states | Data-rich slices pending |
| Multi-server | Validated runtime registry + global selection propagation | Implemented for Slice 1 |
| Mobile/desktop | Chromium desktop + iPhone-profile browser checks | Ongoing; Safari manual gate by change |
| Graceful degradation | Typed unavailable envelope; valid empty-world tests | Implemented for overview |
| Abuse protection | Bounded single-process token bucket + proxy guidance | Distributed/CDN enforcement deployment-owned |
| Tests and CI | Unit/integration/e2e/build evidence + authoritative hosted container gate | The exact smoke-tested image artifact is the only artifact eligible for GHCR publication |
| Architecture/security/deploy docs | Contracts, ADRs, threat/deploy guidance | Implemented; maintain per slice |
| Unraid compose example | Runtime networks/env/health/hardening/rollback | Implemented, network names must be inspected |
| Structured logs/metrics | Sanitized public errors + health routes | Structured logger/redaction, request IDs, app metrics, dashboards pending |

## Residual Slice 1 risks

- The FRM overview reads its five fixed endpoints concurrently, but one failed endpoint currently degrades the whole overview envelope; section-level partial degradation remains future work.
- The in-process limiter is intentionally single-replica. With proxy-header trust disabled, clients share one conservative bucket; production relies on the documented trusted reverse-proxy/CDN policy for distributed per-client enforcement.
- Production App Router output currently requires CSP `script-src 'unsafe-inline'`; nonce-based script policy is a future defense-in-depth improvement.

## Forbidden scope checks

- No Docker socket mount.
- No arbitrary FRM proxy or write endpoint.
- No raw SQL or PromQL route.
- No browser upstream access or secret exposure.
- No copied FRM/game assets without license evidence.
- No mutation of monitoring database schema.
