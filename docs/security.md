# Security model

## Trust boundaries

Public input is untrusted. Upstream services and credentials are server-only. The Control Center is a read-only policy enforcement point, not a transparent proxy.

## Enforced rules

- Requests select only an opaque public server ID from the validated server registry.
- No request field can become a URL, host, port, FRM path, PromQL expression, SQL fragment, file path, or header name.
- FRM paths are constants inside adapters and restricted to reviewed read endpoints.
- Public schemas are allowlists; raw upstream JSON is never returned.
- Errors use public codes and never include stack traces or upstream details. Correlation IDs are Planned with structured logging.
- Player position and inventory are omitted from the public overview contract and discarded by the adapter allowlist.
- Power detail adapters validate fixed `/getGenerators` and `/getPowerUsage` subsets, then discard raw object IDs, class names, coordinates/orientation, inventory class identifiers, and unresolved production/demand fields. Public details contain only bounded operational fields; `-1` circuit membership remains an explicit disconnected state.
- Application code does not log runtime configuration, request headers, upstream bodies, or secrets. A centralized structured logger/redactor is Planned.

## Threats and mitigations

| Threat | Primary mitigation |
|---|---|
| SSRF/internal enumeration | Opaque registry IDs; no client URL; no generic proxy |
| Credential leakage | server-only modules; sanitized responses/logs; runtime secrets |
| SQL/PromQL injection | fixed methods/templates; parameterized SQL; bounded inputs |
| Upstream amplification | cache coalescing, request limits, fixed range/size bounds |
| SSE exhaustion | Power stream has per-client/global connection limits, bounded frames, heartbeats, backpressure coalescing, abort/cancel cleanup, and an opt-in runtime flag |
| XSS/clickjacking | React escaping, CSP, `frame-ancestors 'none'`, no raw HTML |
| Dependency compromise | lockfile, Dependabot, CI build/test and production dependency audit; image scanning is a release hardening gate |
| Private telemetry exposure | server-side privacy filtering, public-only server registry |

## Headers

Production responses set CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, and frame denial. CSP `connect-src` permits only same-origin application APIs/SSE.

## Rate limiting

The application provides a bounded in-memory token bucket suitable for the documented single-replica deployment and hooks for proxy/CDN rate limits. It is not a distributed guarantee. Expensive history and SSE routes receive distinct policies.

Forwarded client-IP headers are ignored by default. Set `TRUST_PROXY_HEADERS=true` only behind a trusted reverse proxy that strips and overwrites `X-Forwarded-For`/`X-Real-IP`; direct access to the application port must remain blocked in that mode.

With the safe default `TRUST_PROXY_HEADERS=false`, every request deliberately uses one shared client key. For the Power SSE route, the per-client limit is therefore the effective deployment-wide cap (currently three concurrent streams), rather than the larger global cap. This fail-closed availability trade-off prevents spoofed forwarded headers from bypassing quotas. Distinct client quotas require the trusted-proxy topology above.

## Secrets

Use Unraid/Docker environment injection or secret files; never build args. `.env*` is ignored except `.env.example`. Production database users must be read-only. Never paste or commit live credentials.

## Security non-goals

The public portal does not provide administrative actions, game control, chat sending, fuse toggles, Grafana embedding, raw diagnostics, or user-authenticated private views in the foundation release.
