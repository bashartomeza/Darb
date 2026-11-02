# ADR-001: Separate demo capabilities by application environment

- Status: accepted for M6B1A
- Date: 2026-07-13

## Context

The validated hackathon release intentionally combined deterministic accounts, destructive reset, simulated tracking, comparison metrics, and judge automation. Those capabilities must remain available for the preserved demo but are unsafe in public environments.

## Decision

Use one explicit Darb environment model: `local`, `test`, `demo`, `staging`, and `production`. Backend `APP_ENV` controls route registration and configuration. Admin `VITE_APP_ENV` and Flutter `APP_ENV` enforce equivalent build/UI boundaries. An explicit demo flag may enable capabilities only in local/test/demo; staging and production reject it.

Route absence is the security boundary for destructive reset, simulation mutations, and deterministic comparison. Demo passwords come only from untracked runtime values or explicit demo build definitions. Production-like URLs must use HTTPS, and backend production startup fails before listening when required configuration is unsafe.

## Consequences

- The frozen demo story remains reproducible with more explicit setup.
- Staging behaves like production rather than as a shared demo environment.
- Demo and production-like artifacts must be built separately.
- Real GPS, production comparison/pricing, server-managed admin sessions, rate limiting, headers, request IDs, logging, readiness, and deployment remain later milestones.
