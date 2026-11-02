# M7H1 runtime validation

M7H1 validation uses a disposable MySQL 8.0.46 database on an isolated port such as 3307. The unrelated local service on 3306 is not stopped, reset, or reconfigured.

Required evidence includes all 18 migrations from empty, repeat deployment no-op, current migration status, both approved normalized migration checksums, all five migration-18 triggers, the persistent reset matrix, exact passenger request/Trip association, and online desired-state replay/concurrency. Existing M7C3C1, M7C3A, M7C1, onboarding, trusted-session, route-lifecycle, backup/restore, reset/reseed, and restrictive-FK harnesses remain authoritative and must not lose assertions.

Workspace, Admin, Flutter, debug APK, production-like APK, security, audit-policy, artifact, and value-aware log scans remain required. Demo preflight must remain `22/22`; deterministic metrics must remain score `0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.

Current local feature-head evidence:

- workspace: 217 API, 54 Admin, 240 Flutter, and nine tooling tests;
- MySQL: 18 migrations from empty, repeat no-op/current status, five migration-18 triggers, reset matrix 45, passenger association 12, legacy online recovery 21, M7C1 79, M7C3A 98, M7C3C1 145, and public onboarding 76;
- trusted sessions, onboarding foundation, route lifecycle, restrictive cleanup, and checksum-backed backup/isolated restore passed;
- production-configured Admin and production-like release APK builds and scans passed;
- API 36 installed the configured demo APK and rendered Arabic/RTL by default;
- preflight passed `22/22`, and deterministic smoke retained every approved value.

GitHub's Admin, Backend/MySQL, Mobile, and Security checks remain required on the final pushed draft-PR head. Local evidence is not a substitute for those exact-head checks.
