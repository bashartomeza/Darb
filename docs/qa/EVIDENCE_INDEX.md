# Evidence index — recovered and new features

Closes the register item EDIT-12 as a **starting index**. It lists what was actually run, on which source, and what was not. It is not a release attestation: nothing here establishes production readiness, and the owner-action items (EDIT-01 to EDIT-10) stay open.

## Source under test

| Item | Value |
| --- | --- |
| Branch | `feat/driver-verification-evidence` (PR #69, on top of `production-readiness` at `b371523`) |
| Commit | `b19ff956fc96863ced887b349204703dccc42012` |
| Tree | `6d902f8c170d0d2505da72ba59e1ab82d20f1ff4` |
| Run date | 2026-10-26, local Windows machine; hosted runs on GitHub Actions |

## Runs on that commit

| Check | Where | Result |
| --- | --- | --- |
| API typecheck and build | local | Pass |
| API unit tests | local | 63 files, 834 tests, all passed |
| Admin unit tests | local | 30 files, 380 tests, all passed |
| Tooling tests | local | 78 tests, 76 passed, 0 failed (2 skipped) |
| Flutter analyze and tests | local | No issues; 628 tests passed |
| Hosted workflows: admin, backend-mysql, mobile, security | GitHub Actions on PR #69 | All four passed |
| Driver documents over HTTP against real MySQL (`masari_demo`) | local, separate server on port 3100 | Passed: real onboarding, upload (content-sniffed type), refusals leave nothing on disk, Admin download byte-identical, applicant delete, refusal after approval, retention purge after backdating |
| Driver documents on an Android emulator (API 36, English) | local debug APK | Passed: sign-up through the real flow, system file picker, document listed, visible and downloadable by Admin, removed from the app and from disk |

## Exact-head verification of `production-readiness` (EDIT-10, partial)

Checked 2026-10-26 with the owner's approval to verify a concrete head. No merge was performed by this check.

| Item | Value |
| --- | --- |
| Head | `29f01ded908ad591222b2423b2020ac84480d1d4` (merge of PR #69 into `production-readiness`) |
| Hosted workflows on that exact commit (push) | Backend and MySQL CI, Admin CI, Flutter Android CI, Security and Configuration CI: all completed with success |
| Open pull requests at the time | #70 (domain and deployment guide), #71 (driver acceptance rate), #72 (checkpoint freshness policy); each is separate, unmerged, and verified on its own head only |

This verifies the hosted gates for that head. It does not close EDIT-10: it is not a release attestation, it says nothing about the owner-action items (EDIT-01 to 09), and production deployment remains not authorized. Repeat it for whichever head becomes the release candidate.

## Limited partner directory: one live provider-backed read (EDIT-04, partial)

Run 2026-10-27 at 19:47 UTC by the operator tooling in `scripts/provider-key/`, with the owner's explicit authorization for exactly one read and the owner's confirmation that the historical key was revoked or rotated (not independently verified). Source: `production-readiness` at `863a69c84594c19527c87fdb0e4f2c9bce9592a2`. An isolated API (local environment, no demo features, only the limited gate on) used a disposable database that was dropped afterwards, a synthetic passenger session, and the dedicated replacement key from Windows Credential Manager. The read went through Masari's own endpoint, not directly to the provider.

| Check | Result |
| --- | --- |
| Authenticated read of `GET /api/v1/limited-checkpoint-directory` | Succeeded (HTTP 200), schema version 1, dataset role `LIMITED_PROVIDER_DIRECTORY` |
| Counts | 70 records across 10 cities. The service rejects any city above 7, so this is 7 per city. |
| Row fields | Only the documented names plus the fixed null-coordinate fields; every coordinate was null, `coordinate_verified` and `ready_for_map` are the fixed unverified values, and traffic status is the fixed unavailable value |
| Generated-at timestamp | Present |
| Repeat within the cache interval | Served from cache (identical fetched-at; no second provider request) |
| Error or warning log lines | 0 |
| Cleanup | API stopped, disposable database dropped, logs deleted |

Not done or not shown: an independent reviewer has not examined this evidence, per-city counts were not tabulated (the 7-per-city figure follows from the service's enforced limit and the totals), timestamp-offset ambiguity was not tabulated, provider-side audit of the request was not obtained, and the provider-permission, redistribution and freshness-for-production items remain open. No provider data, IDs, headers or key material were kept. `AWEENRAYEH_LIVE_CONFORMANCE` is therefore `PASSED_ONE_READ_PENDING_INDEPENDENT_REVIEW`, not approved.

## Earlier evidence (not re-run on this commit)

These come from section 20 of `MASARI_FULL_PRD_AND_REMAINING_EDITS.md` (2026-10-25, `753b489`) and were not repeated here: real-MySQL CI suites on disposable databases, `demo:smoke`, `demo:features`, `demo:approvals`, the Android debug build, the artifact and secret scans, the headless-Chrome pass over the Admin console, and the Android emulator pass. Hosted Backend/MySQL, Admin, Flutter and Security workflows passed on `753b489`. Treat all of it as dated to that commit.

## Not run or not covered

- Arabic screens of the document card on a device; a PDF upload from a device; the Admin console's Download button and evidence form in a real browser.
- The earlier 2026-10-25 device gaps: Merchant inbox, English Merchant/Driver screens, CSV files in Excel, Admin console at phone width.
- Human acceptance of the recovered flows (`docs/demo/FEATURE_WALKTHROUGH.md`).
- The document upload has not run on the real hosting environment (Injazat): persistent storage, backups and the scheduled purge are unverified.
- Everything gated by owner actions: live provider conformance, credential rotation confirmation, freshness policy, redistribution permission.

## Keeping this current

Re-run the table above after any change that lands on `production-readiness`, update the commit and tree, and keep failures in the table rather than deleting them.
