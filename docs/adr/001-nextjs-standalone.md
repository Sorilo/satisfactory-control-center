# ADR-001: Full-stack Next.js standalone image

**Status:** Accepted

Use Next.js App Router, strict TypeScript, and `output: "standalone"` in one Node container. This creates one browser origin and keeps backend credentials in server-only modules. Separate frontend/backend deployments are rejected for the initial Unraid topology because they add cross-origin and deployment complexity without a current scaling need.
