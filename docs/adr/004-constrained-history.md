# ADR-004: Constrained historical queries

**Status:** Accepted; adapters planned

Prometheus and PostgreSQL are accessed through named provider methods with fixed query templates, bounded parameters, timeouts, and result limits. Arbitrary PromQL/SQL is rejected. PostgreSQL uses a SELECT-only role and does not mutate frmcache schema. Application-owned persistence requires a separate ADR.
