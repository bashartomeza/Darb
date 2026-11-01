# Darb — Change Report

## Added files

- `CHANGES.md` — complete change inventory and task mapping.
- `IMPLEMENTATION_COMPLETE.md` — task-by-task implementation and validation status.
- `TEST_REPORT.md` — executed checks and explicit PASS/BLOCKED results.
- `apps/api/prisma/migrations/20261006110000_complete_passenger_trip_lifecycle/migration.sql` — passenger completed-state and legacy trip uniqueness migration.
- `apps/api/prisma/migrations/20261008190000_complete_capacity_batching_failure_states/migration.sql` — capacity, multi-order batch membership, and explicit failure/expiry state migration.
- `apps/api/src/services/legacyCapacity.ts` — atomic legacy seat/parcel reserve and release helper.
- `apps/api/src/services/legacyDispatch.ts` — legacy match/request/order expiry and cleanup service.
- `apps/api/src/lib/legacyDispatchWorker.ts` — periodic legacy expiry worker started/stopped with the API.
- `apps/api/src/tests/legacyDispatch.test.ts` — expiry behavior tests.

## Modified files

The implementation modifies the existing matching, passenger, trip lifecycle, merchant/batching, driver, admin monitoring, Flutter request/trip, Prisma, and test files in place. The important changes are:

- `apps/api/src/modules/matching.ts` — uses real passenger/merchant demand, persists Match results, checks live route capacity, reserves capacity atomically, and prevents duplicate active matches.
- `apps/api/src/modules/trips.ts` — enforces driver ownership, persists accept/reject/start/complete/cancel/fail transitions, prevents duplicate Trips, and synchronizes capacity/merchant entities.
- `apps/api/src/services/tripLifecycle.ts` — canonical legacy transition rules and synchronized passenger/merchant/parcel updates; cancellation/failure now release held legacy capacity before terminal entity updates.
- `apps/api/src/modules/passenger.ts` — authenticated passenger retrieval/cancellation, rematch-safe rejection handling, and capacity release across combined passenger+merchant matches.
- `apps/api/src/modules/merchant.ts` — merchant order cancellation with capacity release and batch membership cleanup.
- `apps/api/src/modules/batching.ts` — real multi-order same-merchant batching with active-membership concurrency protection.
- `apps/api/prisma/schema.prisma` — explicit completed/failure/expiry statuses, legacy capacity flag, legacy trip assignment uniqueness, and `ParcelBatchOrder` model.
- `apps/api/src/server.ts` — starts/stops the legacy dispatch worker with the API lifecycle.
- Flutter passenger matching/request/trip files — authoritative backend refresh, real match results, persistent request handling, rematch behavior, and terminal-state rendering.
- Flutter driver controller/repository/screen files — persisted trip status actions plus driver cancellation/failure controls.
- Flutter merchant files — persisted batch/match/trip/cancellation views.
- Admin monitoring/trip files — completed/failed/expired status visibility.
- API/mobile tests — matching, capacity, batching, lifecycle, synchronization, cancellation, expiry, authorization, and persistence coverage.
- `.gitignore` and `README.md` — GitHub-safe exclusions and clone/configure/run instructions.

## Deleted files

**None from the original Darb ZIP.**

No existing source module or feature was removed. The final package retains the complete original project and only adds the files listed above.

### UI reference styling

Applied only to the task-related mobile flows: passenger route/request/matching/trip screens, driver request/trip screens, and merchant shipment/batching/tracking screens. Reused the existing theme and shared widgets instead of adding a parallel design system.

Reference palette: #2F4A3A #7A8F5A #E6D2B3 #C66A3D #8A3F2A.

### Supplied UI reference styling

- Updated the shared mobile theme palette to the five reference swatches so the requested passenger, driver, and merchant task surfaces share the same visual language without introducing a duplicate theme.
- Tightened action controls to the reference's compact rounded treatment and adjusted bottom sheets to the reference card/sheet geometry.
- Updated passenger and driver trip screens' legacy hardcoded orange/navy/blue palette to the reference palette.
- Updated the merchant create-shipment primary transaction button to the reference terracotta accent.
- Scope intentionally excludes unrelated admin/backend visuals and unrelated mobile screens; functionality was not replaced by mock UI.

### CI compatibility fix — admin monitoring authorization tests

- Modified: `apps/api/src/tests/adminMatchingMonitoringApi.test.ts`
- Reason: the global `requireCompleteProfile` middleware correctly requires authenticated product users to have a complete profile and verified email. The admin monitoring test double represented an "active" admin but omitted `profile_state` and `email_verified_at`, so every authorized-admin case was stopped with `403 Forbidden` before the injected monitoring service was reached.
- Change: updated the mocked admin session user to include `profile_state: "complete"` and a verified `email_verified_at` timestamp.
- Production behavior: unchanged; this aligns the fixture with the existing authentication contract.

### Security dependency remediation

- Updated the existing `fast-uri` override from `3.1.6` to `3.1.8` and synchronized `package-lock.json` to the patched 3.x release to address newly published 2026 advisories without changing Prisma major versions.
- Updated the dependency-security regression test and security remediation documentation.

## CI Follow-up Fixes

- Fixed the Flutter formatting gate by restoring the required final newline in every Dart file that `dart format --set-exit-if-changed .` reported as changed (15 files).
- Fixed the backend admin HTTP test fixture so the simulated active Admin also satisfies the production `requireCompleteProfile` preconditions (`profile_state=complete` and verified email), removing the false 403 failures in the monitoring boundary tests.
- Updated the `fast-uri` override to `3.1.8` and synchronized `package-lock.json` with the patched version for the security audit.

