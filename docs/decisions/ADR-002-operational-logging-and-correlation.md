# ADR-002: Operational logging and correlation

## Status

Accepted for M6B1B.

## Context

Darb needed request correlation and production JSON logs without allowing bodies, query strings, credentials, phone numbers, or precise locations into operational output. Business `AuditEvent` rows serve a different compliance/history purpose.

## Decision

Use `crypto.randomUUID()` plus a strict inbound request-ID allowlist. Use Pino with an asynchronous destination and a small Masari-owned completion middleware that emits only approved fields. Do not use pino-http because its broader default request serialization is unnecessary for this API and would require additional suppression of URLs and headers.

## Consequences

Logs are structured, low-overhead, and deliberately sparse. Exception messages and stacks are excluded, so investigations correlate the safe error event with the request ID and internal reproduction rather than relying on potentially secret-bearing messages. Distributed tracing and OpenTelemetry remain outside this milestone.
