# HTTP security baseline

M6B1B establishes the API transport baseline without changing Darb domain contracts or database structures.

## Request pipeline

Requests receive a safe `X-Request-Id` before parsing. The API then applies structured completion logging, Helmet headers, explicit CORS, 64 KB JSON and 16 KB form limits, liveness/readiness routing, global rate limiting, the stricter login limiter, domain routers, a JSON 404, and the centralized safe error handler.

Inbound request IDs are accepted only when they contain 1–64 ASCII letters, digits, `.`, `_`, `:`, or `-`; other values are replaced with `crypto.randomUUID()`. Error payloads include the same value as `request_id`.

## Rate limits

| Environment | Global `/api/v1` | Login | Health |
| --- | --- | --- | --- |
| staging/production default | 300 per 15 minutes per resolved client IP | 10 per 15 minutes per client IP plus SHA-256 phone digest | excluded |
| local/test/demo default | 5,000 per 15 minutes | 500 per 15 minutes | excluded |

Login success does not bypass counting. Responses use `429`, `rate_limited`, `request_id`, and `Retry-After`. Keys never contain raw phone numbers. The built-in in-memory store is acceptable only for the current single-instance baseline; horizontal scaling requires a shared external store.

## Proxy topology

`TRUST_PROXY=none` or `0` means a direct runtime and ignores client-supplied forwarding headers. `1` means exactly one trusted reverse-proxy hop; values through `5` represent an explicitly known hop count. Staging and production refuse to start without an explicit value and reject `true` or other trust-all forms. The value must be revalidated when hosting is selected.

## Headers, bodies, and errors

Helmet disables browser-sniffing, framing, and referrer leakage and applies a same-site resource policy. HSTS is emitted only in staging/production; local/test/demo HTTP is not given an incorrect HSTS assumption. API CSP is disabled because this service returns JSON rather than browser pages. These headers do not protect the separately hosted React application.

JSON bodies are limited to 64 KB and URL-encoded bodies to 16 KB. Oversized and malformed requests receive controlled JSON errors with request IDs and no submitted content. Unknown and Prisma-style failures are mapped to generic safe responses; stack traces, SQL, connection details, and exception messages are retained only as omitted internal context, never serialized.

Passenger and merchant coordinate inputs share latitude `[-90, 90]` and longitude `[-180, 180]` validation. Existing numeric-string compatibility is retained, while empty, null, non-finite, and out-of-range coordinates are rejected. Service-area validation remains future maps work.
