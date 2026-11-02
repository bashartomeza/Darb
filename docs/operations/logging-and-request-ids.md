# Operational logging and request IDs

Darb uses one Pino JSON logger with an asynchronous destination. Base fields are `service`, `app_env`, and `release`. Every completed request adds `event`, `request_id`, `method`, normalized `path`, `status_code`, and `duration_ms`; authenticated requests also add `actor_id` and `actor_role`.

The path normalizer removes query strings and replaces non-allowlisted path segments with `:id`. Operational events include startup/shutdown, authentication or authorization rejection, readiness failure, and unhandled error type. Database `AuditEvent` rows remain business audit records and are not duplicated into operational payloads.

The logger never intentionally receives request/response bodies, raw queries, headers, IP addresses, phone numbers, coordinates, tokens, passwords, reset keys, database URLs, or document URLs. Pino redaction paths provide defense in depth, while tests inject representative fake secrets and assert that captured logs contain none of them. Exception messages and stacks are not logged because they may embed secrets; the request ID is the support correlation key.

Clients may submit `X-Request-Id` only in the strict safe format documented in the HTTP baseline. Otherwise the API replaces it. The selected ID is returned as both `X-Request-Id` and `request_id` on errors. Never place customer data or credentials in a request ID.
