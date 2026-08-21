# Goal-to-deliverable matrix

This matrix prevents a production-shaped foundation from being mistaken for the requested major release.

| Requirement | Current evidence | Major release status |
|---|---|---|
| One standalone Docker image | Dockerfile + hosted CI build/runtime smoke gate | Authoritative container evidence is required before each publication |
| Mock/live modes | Deterministic mock + reviewed FRM overview and Power adapters | Broader live providers pending |
| Curated read-only boundary | Opaque IDs, fixed endpoints, Zod allowlists, size/timeout bounds | Enforced; extend per route |
| FRM realtime | Shared Power aggregator plus a shared 30-second detail aggregator, bounded same-origin SSE (`power` and additive `power-details` events), strict snapshots, polling fallback | Implemented for Power; later domains pending |
| Prometheus history | Fixed Power query templates, bounded adapter, coverage/coarsening contract | Implemented for Power; production history remains unsupported |
| Current production | Pinned FRM `getProdStats` shape plus Companion production gauge capability | Implemented for Slice 3; current-only, normalized, bounded |
| Production history | No selected-deployment retained production series evidence | Explicitly unsupported; no PostgreSQL/Prometheus/Grafana claim |
| PostgreSQL history | Deferred until read-only schema inspection | Pending |
| Full original map | Original-design/licensing decision | Slice 4 |
| 11 first-class views | Responsive navigation and honest staged states | Data-rich slices pending |
| Multi-server | Validated runtime registry + global selection propagation | Implemented for Slice 1 |
| Mobile/desktop | Chromium desktop + iPhone-profile browser checks | Ongoing; Safari manual gate by change |
| Graceful degradation | Typed independent Power source states; valid no-circuit/empty-history tests | Implemented for Overview and Power |
| Abuse protection | Bounded single-process token bucket + proxy guidance | Distributed/CDN enforcement deployment-owned |
| Tests and CI | Unit/integration/e2e/build evidence + authoritative hosted container gate | The exact smoke-tested image artifact is the only artifact eligible for GHCR publication |
| Architecture/security/deploy docs | Contracts, ADRs, threat/deploy guidance | Implemented; maintain per slice |
| Phase 0 source/capability checkpoint | Immutable FRM/Companion/monitoring evidence, sanitized fixtures, explicit deployment blocker | Completed for pinned source; the original alias check was blocked at checkpoint, while the operator-validated Power profile is documented separately; Production live validation remains required |
| Unraid compose example | Runtime networks/env/health/hardening/rollback | Implemented, network names must be inspected |
| Structured logs/metrics | Sanitized public errors + health routes | Structured logger/redaction, request IDs, app metrics, dashboards pending |

## Residual risks through Slice 3

- The FRM overview reads its four non-Power fixed endpoints concurrently, but one failed endpoint currently degrades the whole overview envelope; section-level partial degradation remains future work. Its Power summary is independently composed through the shared `PowerService` current cache.
- The in-process limiter is intentionally single-replica. With proxy-header trust disabled, clients share one conservative bucket; production relies on the documented trusted reverse-proxy/CDN policy for distributed per-client enforcement.
- Production App Router output currently requires CSP `script-src 'unsafe-inline'`; nonce-based script policy is a future defense-in-depth improvement.
- Power realtime remains disabled by default until the actual reverse proxy/Tunnel path proves SSE buffering and disconnect behavior; curated HTTP polling remains the fallback. The additive detail channel shares the same gate and does not promote the stream out of that opt-in state.
- Generator and major-consumer details now depend on reviewed sanitized `/getGenerators` and `/getPowerUsage` subsets, streamed through a shared 30-second producer. Live upstream shape drift degrades each detail group independently; raw IDs/classes/locations and unresolved production fields remain excluded.

## Forbidden scope checks

- No Docker socket mount.
- No arbitrary FRM proxy or write endpoint.
- No raw SQL or PromQL route.
- No browser upstream access or secret exposure.
- No copied FRM/game assets without license evidence.
- No mutation of monitoring database schema.
