# ADR-002: Private upstream adapter boundary

**Status:** Accepted

FRM, Prometheus, and PostgreSQL remain private. Explicit providers parse upstream payloads and return domain models. Public handlers are curated and versioned. Generic proxying is rejected because it bypasses field allowlists, enables SSRF/amplification, and risks write/credential exposure.
