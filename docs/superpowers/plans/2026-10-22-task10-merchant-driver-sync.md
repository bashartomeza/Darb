# Task 10 — Manual merchant matching and synchronization

## Authorized scope and baseline
PR50 566fd120f47d66fec6f60588ab11c0be53c8f2bb; PR51 e5b53f1976a67ee809a24a269ce286e758c0a903; PR52 9b5c9942097d51ca53e153e333e3d1023ba61d97. All draft and unchanged.
Current GitHub PR51 synthetic preview 3df548cc1767cb142b46227c19daee326c67ea9c has exact PR52/PR51 parents and verified tree 9cba4a6ce3b596346851a458897773e12b9f0fe5.
Isolated branch codex/merchant-driver-sync-20261022 starts at that snapshot. Proposed narrow PR base is a new immutable anchor at this snapshot; existing PRs need no modifications. No local merge or history rewriting.

## Workflow and plan
1. Reproduce the explicit order, batch, match, inbox, accept/reject workflow against owned disposable MySQL; document persistence and synchronization gaps.
2. Add RED regression cases for confirmed gaps before source fixes. Reuse existing API, legacy eligibility/state machine, capacity rules, and screen layout. No automatic dispatch.
3. Apply minimal corrections. Poll visible foreground screens only; fence stale reads and retain authoritative records on transient failures.
4. Verify concurrency, expiry, cancellation, lost replies, restart, account isolation and no-driver behavior through real API/MySQL and two synthetic browser sessions.
5. Full API/Admin/Flutter/tooling, migration integrity, builds/artifacts, audits, independent review, exact-head hosted CI. Create only a scoped new draft PR if needed.

## Boundaries
No schema/migration, UI design, existing PR mutations, provider calls, historical credential access, CodeRabbit, deployment or merge. Provider compatibility UNVERIFIED_BLOCKED; credential rotation PENDING_OWNER_CONFIRMATION, separate from manual matching.

## Issue ledger
Investigation only: inbox and merchant order controllers fetch on mount/manual actions, without passive synchronization. Runtime reproduction pending.

## Reproduction and corrections
- Normal real MySQL/API path returned create/batch/match/accept 201, inbox 200, merchant assigned. Existing persistence works in the ordinary case.
- Initial browser attempt: separate real Merchant/Driver sessions, 12 seconds waiting, zero passive match reads. Screenshot later confirmed a no-compatible-driver response caused by seed demand exceeding capacity. This attempt does NOT prove a missed persisted offer; use the genuine app-level Flutter RED plus explicit201 final browser checks for synchronization evidence. Add visible foreground five-second read-only refresh using existing APIs. Pause hidden route/retained tab/background/disposal; immediate reconciliation on return. Preserve existing widgets/styles.
- Flutter RED: old concurrent order read published obsolete status; waiting match never updated; rejected history hid manual rematch. Latest requested refresh is serialized/coalesced and actor-revision/disposal fenced. Associate secondary orders with their batch match/trip. Existing match action now requires batched order + created batch and no active match; no automatic matching.
- MySQL RED: suspended and departed drivers received capacity holds; expired offer accepted before worker; rejection undid offline choice; driver saw root-order parcel count instead of total batch. Reuse verified profile + active driver account gate, transactionally lock route/profile/user and check database UTC after relevant waits; reject expired acceptance; preserve offline route status on reject; additive batch parcel count with old-server mobile fallback.
- Independent review produced cancellation/acceptance race. Real read barrier reproduced accepted trip referencing cancelled batch/parcels and restored capacity. Claim all batch orders before cancellation side effects. Additional RED reproduced stale snapshot cancellation after concurrent match/rematch, and batch creation after cancellation. Cancellation uses transaction-local ReadCommitted and exact initial status; batching claims all selected submitted orders before creating memberships. Existing allowed transitions unchanged.
- Schema-valid legacy orders cannot have non-null requested_departure_until; a proposed deadline fixture was rejected by merchant_orders_canonical_shape_chk. Removed invalid fixture and tested supported expired state. No schema change or worker-policy invention.
- Actual row wait: 2212 ms at parcel_batch route foreign-key update blocked by an owned driver-route lock; departure crossed during wait; post-wait UTC guard returned409, no offer/hold and order claim rolled back. Observed local MySQL clock is +03:00, while Prisma DATETIME is UTC; use UTC_TIMESTAMP(3), not CURRENT_TIMESTAMP.
- Current real MySQL suite:60 assertions, zero failures, including8 simultaneous initial matching requests,8duplicate retries, cross-account denial, lost actual socket response, acceptance/rejection/expiry/cancel/no-driver, three controlled cancellation interleavings and cancellation during batching. Full clean-database rerun and repeated timing evidence pending.
- Focused Flutter39 tests pass, including lifecycle/route/tab cleanup, no overlapping ticks, stale filters, actor switch/disposal, RTL existing flows and manual rematching; full suite pending.

## Review scope
Independent manual source/security review by fresh Codex reviewer; CodeRabbit explicitly not used. Reviewer withdrew an overdue-order worker race after checking unchanged legacy schema constraints: predicate unreachable for valid legacy rows. Remaining final-diff review and hosted CI pending.

## Database and provider boundary
No schema or migration SQL/checksum changes. All writes use invocation-created MySQL8.0.46 databases on random loopback ports. Baseline QA runtime stopped and cleaned before final QA. No provider calls or historical credential read/reuse. Provider compatibility UNVERIFIED_BLOCKED; rotation PENDING_OWNER_CONFIRMATION.

## Full local verification
API633/633, Admin368/368, Flutter327/327, tooling58/58 with no skips. Prisma validation/generation, migration integrity, typechecks, localization, formatter/analyzer, API/Admin/Android release builds and artifact scans pass. Full and production audits0 after Vitest4.1.12. The inherited4.1.11 pin reproduced two moderate advisories GHSA-qxg6-89mg-rqv8 and GHSA-xp26-3454-mjgp, both patched4.1.12. npm10.9.2/10.9.7 peer-set resolver crashed (edgesOut); only eight Vitest lock entries updated using exact npm registry metadata, all unrelated entries retained. Clean npm ci then passed with peer/integrity checks intact; full suites pass on4.1.12. Prior failures are retained in private evidence, no assertions or budgets suppressed.

## Fresh MySQL and review gate
Fresh owned MySQL8.0.46 run passed19/19 checks: fresh/repeat/status, prior-version upgrade/repeat/status, merchant persistence57assertions, Task10 matching60assertions, combined smoke/session/onboarding/consent/public onboarding/routes/monitoring/multi-route, reset matrix, legacy-online recovery, passenger-trip association and canonical single/shared integrations. No failed checks waived. Runtime cleanup is invocation-owned.
Independent final manual source/security review inspected all32 changed files and supporting ownership/auth/session/transaction/expiry/actor/lifecycle paths; no actionable finding. Exact patch hash811218acbc6b33994b8ba5bf6ed45180fd9d6a5e08823ccdd2da30328b951e6f (subsequent ledger-only evidence qualification update). Review did not independently rerun runtime tests or use a formal Security service; CodeRabbit not used.
PR50 future overlap: matching.ts, trips.ts, legacyCapacity.ts, driver_controller.dart, driver_models.dart. Future integration must preserve PR50 passenger timing/response recovery and Task10 merchant eligibility, post-lock time checks, actor-fenced polling and batch counts. Existing PRs remain untouched. Final browser QA and exact-head hosted results will be recorded in the delivery evidence/PR description without changing the verified head to embed its own CI results.
DESIGN CHANGES = NONE. MERGE_GATE = BLOCKED_PENDING_USER_APPROVAL.
