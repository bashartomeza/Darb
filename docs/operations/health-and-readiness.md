# Liveness and readiness

The API exposes three unthrottled operational endpoints:

- `GET /api/v1/health` preserves the existing Darb service-identity contract and reports live status.
- `GET /api/v1/health/live` confirms only that the process and HTTP stack are running; it never queries MySQL.
- `GET /api/v1/health/ready` runs a read-only `SELECT 1` through Prisma and returns `200` only when the database check completes within the configured bound.

The default readiness bound is 2,000 ms. Failure or timeout returns `503` with `status: not_ready` and `request_id`; it never returns SQL, database host, credentials, driver messages, or dependency versions. A readiness failure emits only a safe operational event.

`demo:preflight` checks readiness in addition to service identity. Production orchestration should use liveness only for process restart decisions and readiness for traffic admission. Neither endpoint is a substitute for deployment-specific external monitoring, and neither mutates application data.
