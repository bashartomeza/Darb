# Darb — Test Report

## Environment limitation

Full runtime validation could not be completed in the provided environment. Node was `22.16.0` while the repository requires `22.17.1`; npm dependency installation also failed because external package access/DNS was unavailable. Flutter/Dart and MySQL/Docker runtimes were not installed. The results below never mark an unexecuted workflow as PASS.

| Test | Result | Notes |
|---|---|---|
| Passenger creates request | BLOCKED | API integration requires installed npm dependencies/runtime DB |
| Matching called | BLOCKED | Code path verified; full HTTP test execution blocked by dependencies |
| Compatible trip returned | BLOCKED | Real route query and scoring paths are implemented; DB-backed execution blocked |
| Driver accepts | BLOCKED | Authorization/transactional acceptance tests added; runtime blocked |
| Driver rejects | BLOCKED | Capacity release/rematching logic tested at source level; runtime blocked |
| Trip starts | BLOCKED | Lifecycle transition implemented; API runtime unavailable |
| Passenger sees active | BLOCKED | Persistence and UI reload code implemented; Flutter runtime unavailable |
| Trip completes | BLOCKED | Lifecycle completion implemented; DB runtime unavailable |
| Passenger sees completed | BLOCKED | `PassengerRequest.completed` added and UI uses persisted state; Flutter runtime unavailable |
| Cancellation | BLOCKED | Passenger/driver/merchant cancellation paths implemented; runtime DB unavailable |
| Authorization | BLOCKED | Ownership checks and negative tests added; full Vitest runtime blocked |
| Persistence after reload | BLOCKED | Backend persistence code and Flutter reload logic implemented; MySQL/Flutter runtime unavailable |
| Multi-order merchant batching | BLOCKED | Unit/source coverage added; Prisma/MySQL runtime unavailable |
| Capacity reserve/release | BLOCKED | Atomic update/release logic and targeted assertions added; DB unavailable |
| Expired request/order cleanup | BLOCKED | Dispatch worker and expiry service implemented; worker runtime/DB unavailable |
| Failed delivery synchronization | BLOCKED | Trip failure sync and capacity release implemented; DB runtime unavailable |

## Executed checks

| Check | Result | Notes |
|---|---|---|
| Prisma migration integrity | PASS | Existing migration hashes preserved and new migration checksum approved |
| Secret/tracked-file scan | PASS | No production `.env`, API keys, or passwords detected in tracked project files |
| Modified TypeScript syntax parse | PASS | No TypeScript syntax diagnostics were detected in the modified TS/TSX files |
| Added-line whitespace validation | PASS | No trailing whitespace was introduced by the modified files |
| `npm install` | BLOCKED | Node `22.16.0` is installed while the project requires `22.17.1`; dependency/network environment also blocked installation |
| `node --test scripts/tests/*.test.mjs` | BLOCKED | 49 tests passed, 1 recovery test failed to load because `dotenv` is unavailable, and 1 test was skipped |
| `node scripts/validate-workflows.mjs` | BLOCKED | Required `yaml` package is unavailable because dependencies could not be installed |
| Prisma CLI validation/generate | BLOCKED | Prisma CLI unavailable because dependencies could not be installed |
| Flutter `pub get` / analyze / test | BLOCKED | Flutter/Dart not installed |
| MySQL integration | BLOCKED | MySQL/Docker runtime unavailable |

## Interpretation

The requested application behavior is implemented in source and protected by transactions/ownership checks, but runtime PASS claims are intentionally withheld until the repository is executed in a fully provisioned Node/Prisma/MySQL/Flutter environment.

## Supplied UI Reference Validation

| Check | Result | Notes |
| --- | --- | --- |
| Reference palette applied to task flows | PASS | Five anchor colours from the supplied reference are present in the shared mobile theme. |
| Passenger task trip screens use reference palette | PASS | Legacy orange/navy/blue constants were replaced in the custom passenger trip screen. |
| Driver task trip screens use reference palette | PASS | Legacy orange/navy/blue constants were replaced in the custom driver trip screen. |
| Merchant create-shipment CTA uses reference accent | PASS | Terracotta transactional styling applied to the existing real submission action. |
| No unrelated mock UI introduced | PASS | Existing widgets and backend data flow remain the source of truth. |

## CI failure follow-up

The GitHub Actions backend test failure was traced to `apps/api/src/tests/adminMatchingMonitoringApi.test.ts`: its active Admin mock did not include `profile_state: "complete"` or `email_verified_at`, while the globally mounted `requireCompleteProfile` middleware requires both for authenticated product routes. This caused all 21 admin-monitoring cases to fail at authorization with `403 Forbidden` before reaching the injected service. The fixture has been corrected accordingly. A GitHub-hosted rerun is required to mark the CI check PASS.


## Latest CI follow-up

- `scripts/tests/dependency-security.test.mjs`: PASS
- `npm audit --offline`: PASS (local advisory database unavailable for current registry state; GitHub CI remains the authoritative networked audit)
- Security remediation: `fast-uri` pinned to `3.1.8` in package.json and package-lock.json.
- Flutter format check: BLOCKED in this environment because the Dart/Flutter SDK is not installed. The GitHub failure is a formatting-only gate (`dart format --set-exit-if-changed .`).

## GitHub CI Follow-up

### Backend CI

The GitHub runner reported 587 passing tests and 21 failures, all from `src/tests/adminMatchingMonitoringApi.test.ts`; the failures were `403 Forbidden` responses before the injected monitoring service was reached. The Admin fixture has now been updated to satisfy the existing complete-profile authorization middleware.

### Flutter CI

The GitHub formatter step reported `Formatted 179 files (15 changed)`. Investigation showed 15 Dart files were missing the required final newline. All 15 files were normalized, so the formatter gate should now produce no source changes. `flutter analyze` and `flutter test` have not been executed locally because Flutter/Dart are not installed in the execution environment.

### Security CI

The root lockfile currently reports `0 vulnerabilities` under offline npm audit. The `fast-uri` remediation is pinned to `3.1.8`. The network-backed GitHub audit must still be rerun to verify the runner sees the same advisory resolution.

