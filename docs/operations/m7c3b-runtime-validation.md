# M7C3B runtime validation

M7C3B has no schema or dependency change. All 16 MySQL migrations must remain
current and unchanged.

## Required gates

- Workspace: install, Prisma validate/generate/status, typecheck, test, build,
  standard validation, security validation, and production audit.
- Admin: typecheck, test, production-configured build, and artifact scan.
- Flutter: dependency resolution, localization generation, format check,
  analyze, all tests, demo APK, production-like release APK, and artifact scan.
- MySQL: empty migration deployment, repeated no-op, M7C3A and M7C1 harnesses,
  trusted sessions, onboarding, public onboarding, route lifecycle,
  backup/restore, deterministic reset, and disposable cleanup.

## Runtime matrix

Use local/test/demo capability flags with canonical entry, matching, and Trip
creation explicitly enabled. Validate driver list/detail and exact accept/reject
replay; passenger and merchant pending/offered/assigned states; manual and
foreground refresh; token refresh; logout ambiguity; actor isolation; Arabic,
English, 200% text, rotation, and back navigation.

Production-like builds must keep canonical entry hidden and matching unavailable.
They must contain no local fixtures, demo credentials, operation keys/payloads,
maps, GPS/location permission, Socket.IO/WebSocket client, realtime transport,
pricing, or M7C3C aggregate controls.

Legacy demo preflight must remain `22/22`, and smoke metrics must remain score
`0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`,
cost `43.06` versus `258.38`, and winner `darb`.

## Branch validation record

- API: 193 tests across 18 files.
- Admin: 27 tests.
- Flutter: 173 tests.
- MySQL: 8.0.46 with `utf8mb4_0900_ai_ci`; all 16 migrations deployed from
  empty, repeated deployment no-op, and migration status current.
- Persistent-state harnesses: M7C3A 98 assertions, M7C1 79 assertions, trusted
  sessions, onboarding, public onboarding (76 checks), and route lifecycle.
- Selected emulator: Arabic default and English LTR; driver offered, expired,
  detail, accept, and assigned states; passenger assigned status; merchant
  pending/assigned history; minimal Trip summary; manual refresh and back.
- Recovery: accept/reject response loss, process death, stable idempotency,
  actor and payload fencing, logout preservation, auth refresh, and terminal
  races pass Flutter automation and persistent-state integration coverage.
- Artifacts: production-configured admin and production-like APK isolation
  scans pass; no map/location permission or realtime client was introduced.
- Legacy: preflight 22/22 and deterministic smoke values exactly match the
  required metrics above.

The disposable runtime uses an isolated MySQL database and is removed after
validation. No production data, migration history, or frozen release artifact
is changed.
