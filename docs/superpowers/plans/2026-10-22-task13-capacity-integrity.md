# Task13 capacity integrity ledger

Starting point: PR54 c0ab06025706ad33fa3d9057f6cd95f1e4be067b, stacked on PR53. PR50–54 and production-readiness are protected and remain unchanged. Task branch codex/capacity-protection-20261022. No schema, migration, dependency, UI/Figma design, provider, policy or matching-algorithm change.

## Invariants and scope

Legacy proposed offers debit independent seats_available / parcel_capacity_available once. Acceptance transfers the existing hold into one Trip per route and invalidates competing proposals, restoring their dimensions. Rejection, expiry, cancellation and failure release held capacity once; successful completion retains existing occupied-capacity semantics. Canonical remaining counters are bounded by existing MySQL CHECK constraints. Single/shared offers own reservations; shared manifests aggregate global seats/parcels, with no segment reuse. Mode markers and composite foreign keys isolate both workflows.

## Confirmed regressions and corrections

1. Passenger cancellation read a repeatable-read snapshot before claiming the request. A matching transaction committed between reads, leaving a cancelled request with a live offer and seat0 instead of1. Lock the owned legacy request before the first snapshot read; matching claims the same row. Finalized RED63 assertions/10 failures; GREEN63/0; expanded contention suite85/0.
2. Passenger holds/acceptance lacked the merchant locked eligibility boundary. An expired offer and unapproved driver were accepted; a real1.6s route lock wait crossed departure and still committed201 with seat0. Reuse one legacy eligibility helper across both flows, checking approved active driver, legacy mode, route timing/departed state and locked request/offer deadlines using a new UTC_TIMESTAMP statement after locks. Acceptance rechecks after competitor cleanup. GREEN rejects409 with seat1, parcels1 and no new offer/trip.
3. Standalone canonical hold validated expiry before exact replay and never after lock waits. RED15 assertions/9 failures: replay returned400; availability and route waits created expired holds, counters3/4→2/2, one claim/audit each. Replay first, validate new holds, lock availability and canonical route, then revalidate with fresh MySQL UTC before decrement. GREEN15/0: original expired record recovered; expired wait counters3/4, no reservation/claim/audit.

4. Independent review identified a second repeatable-read defect: acceptance missed a competing offer committed after its first read but before route claim. Real RED85 assertions/4 failures left an assigned route at0 instead of1, and cancellation at1 instead of2. Acceptance now uses the existing ReadCommitted transaction pattern; its route claim blocks new holds while cleanup reads all committed competitors. GREEN85/0, one route Trip, late offer invalidated with held flag cleared and request returned pending.
5. Independent review identified canonical route active_until passing during a route lock wait while the requested hold was still valid. Real RED21/4 failures created a held row/claim/audit and counters2/2. Re-run existing route eligibility using the post-lock database clock before decrement. GREEN21/0: route_version_not_available, counters3/4, zero reservation/claim and unchanged audit. The regression creates its own scheduled published version immutably.

6. Independent real-browser QA found DriverRouteScreen displayed1 while MySQL/API and Passenger detail displayed0 after a committed hold. The open screen had no refresh schedule, and its controller allowed overlapping/stale account reads. Seven Flutter regressions RED7/7, then GREEN7/7, focused42/42: reuse ForegroundRefresh and AuthoritativeRefresh, require bound actor and fence mounted/revision before/after each repository read. Pause while hidden/backgrounded, resume immediately, retain last known counters through read failure, serialize latest publication. This prevents subsequent repository reads after account switch/disposal; an already-started network request is not cancelled. Visual children, actions and other controller classes remain unchanged.

## Regression matrix

- One final seat/two actors; two seats/four actors; duplicates and concurrent distinct acceptances; rejection and fresh-route rematch; passenger/parcel dimensional isolation; cancellation before/after acceptance and repeated cancellation; expiry worker repeated; expired and revoked-driver acceptance; real data_lock_waits observation; committed response destruction and durable GET recovery/retry; HTTP server and pool restart; malformed and unauthorized mutations.
- Existing merchant60, Passenger/Driver76, canonical single/shared and multi-route integrations retain batching, state-machine, ownership, aggregate and release checks. Canonical new suite covers both lock boundaries, scheduled route-window expiry, exact expired replay and combined release.
- Existing API mock fixtures gained the new raw locking query and actual assigned-route state; their assertions are unchanged.
- New integration commands run in hosted Backend/MySQL CI. Only the disposable CI database user receives SELECT on performance_schema.data_lock_waits for contention evidence; no production permission change.

## Verification plan and execution

- [x] Verify protected heads and isolated starting tree; install locked dependencies; focused API82, tooling and Flutter suites pass.
- [x] Reproduce RED on actual disposable MySQL before corrections; preserve failed logs.
- [x] Apply bounded corrections and obtain real MySQL GREEN.
- [x] Full API633/Admin368/Flutter357/tooling58; migration integrity; formatter/analyzer; API/Admin/Android builds; full+production audits0 vulnerabilities; source/secret/artifact/workflow scans.
- [x] Independent source/security review of all15 intended files and supporting lifecycle/idempotency/authorization/constraints; both additional timing findings reproduced, corrected and re-reviewed. No CodeRabbit or formal external Security service scan.
- The initial be74dc2 head passed all four hosted workflows, then browser QA found issue6. A focused third commit and complete rerun are required; final browser/OS-process restart and four hosted exact-head results are recorded in the draft PR description and external evidence report after push; this source ledger does not declare final completion.

## Qualifications / future integration

C: exhaustion initially prevented MySQL initialization and Flutter compilation. Task13-owned dependencies, generated build output and temporary databases moved to D:; no unrelated resources deleted. One fixture MySQL result type and CRLF-sensitive patch helper required correction; no assertions were waived. An initial lost-response check expected409 specifically, but404 is also a valid no-supply conflict in existing matching; the finalized test additionally verifies exactly one persisted offer.

PR50 overlaps legacyCapacity.ts, matching.ts, passenger.ts, trips.ts and driver_controller.dart. Future integration must preserve its selected-route/idempotency/recovery and post-lock timing fixes together with PR53 merchant approval/account/batching protections and PR54 lifecycle affected-row claims/location ordering. Do not copy either branch wholesale. Re-run combined request/accept/cancel/departure tests after resolving overlaps.

Provider compatibility UNVERIFIED_BLOCKED. Credential rotation PENDING_OWNER_CONFIRMATION. No provider requests or historical credential access. Generic reservation methods remain internal-only; this task introduces no owner authorization policy. Unconfirmed baseline source concerns about fifth shared offer eligibility, generic/matcher lock order and shared pre-lock demand reads remain distinct from the reproduced capacity defects; no claim that these were reproduced or resolved. Legacy creation/recovery from PR50 remains a separate integration: these tests reconcile matching retries by the persisted request/offer identity and introduce no new booking-creation policy.

Final task/capacity verification statuses require the external exact-head CI and browser evidence record.
MERGE_GATE = BLOCKED_PENDING_USER_APPROVAL
DESIGN CHANGES = NONE
