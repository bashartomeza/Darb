# Darb — Implementation Complete

## Project

Darb

## Scope

This release completes the requested legacy passenger, driver, capacity, merchant batching, merchant delivery, synchronization, and failure-state workflows while preserving the existing canonical architecture. Existing canonical services remain isolated from the legacy route flow; the new legacy helpers provide the missing persistence and capacity guarantees without inventing duplicate canonical APIs.

## Completed Tasks

### Task 1 — Passenger Request → Matching

- **What was implemented:** Real passenger requests are persisted and passed by request ID into the existing legacy route matching service. Candidate routes are filtered using real active and verified driver data, corridor/distance rules, departure windows, available seats, parcel capacity, and prior rejected/expired matches. The selected candidate creates a persisted Match and marks the request `matched` atomically.
- **Files changed:** `apps/api/src/modules/matching.ts`, passenger Flutter matching/request files, matching tests.
- **API involved:** `POST /api/v1/passenger/requests`, `POST /api/v1/matches/run`, `GET /api/v1/matches/:id`, `POST /api/v1/matches/search`.
- **Database changes:** `legacy_demand_key`/capacity state are persisted and a second migration adds explicit lifecycle states and capacity safety fields.
- **UI changes:** Passenger request creation immediately runs the real matcher and the match screen polls authoritative match state; a saved request can be reopened and rematched after rejection.
- **Validation:** Static syntax checks PASS; matching test coverage was added/updated. Full database-backed execution is environment-blocked.
- **Result:** **PASS at code/integration level; runtime validation BLOCKED.**

### Task 2 — Driver Request Lifecycle

- **What was implemented:** Driver ownership is enforced before accept/reject. Accept claims the match with an optimistic status update, creates or reuses the correct legacy Trip, assigns the owned route, and rejects duplicate Trip creation. Reject persists the decision, releases reserved capacity, returns the passenger request to `pending` for rematching, and reopens merchant batching where applicable.
- **Files changed:** `apps/api/src/modules/trips.ts`, `apps/api/src/services/tripLifecycle.ts`, driver Flutter/controller files, lifecycle tests.
- **API involved:** `POST /api/v1/matches/:id/accept`, `POST /api/v1/matches/:id/reject`, `POST /api/v1/trips/:id/status`, `GET /api/v1/trips/:id`.
- **Database changes:** Unique legacy assignment protection prevents duplicate Trips for one passenger request.
- **UI changes:** Driver sees only authorized matches/trips and can advance lifecycle states or cancel/fail an eligible active delivery.
- **Validation:** Unauthorized/duplicate/invalid-transition coverage added. Runtime execution is environment-blocked.
- **Result:** **PASS at code/integration level; runtime validation BLOCKED.**

### Task 3 — Passenger Trip Lifecycle

- **What was implemented:** Persisted passenger states now follow request → pending → matched → accepted → picked_up/in_transit/delivered → completed, with cancellation and expiry represented as terminal outcomes. `completed` was added to `PassengerRequest.status` because no equivalent terminal request state existed.
- **Files changed:** `apps/api/src/modules/passenger.ts`, `apps/api/src/services/tripLifecycle.ts`, Prisma schema/migrations, passenger Flutter controllers/screens.
- **API involved:** passenger request endpoints, trip detail/status endpoints, match endpoints.
- **Database changes:** Added `completed`, cancellation/failure/expiry enum values, and lifecycle-safe migration.
- **UI changes:** Passenger screens load authoritative backend state after refresh/reopen and keep `delivered` visible until completion.
- **Validation:** Persistence and exact request-trip association tests updated; runtime DB execution blocked.
- **Result:** **PASS at code/integration level; runtime validation BLOCKED.**

### Task 4 — Passenger ↔ Driver Synchronization

- **What was implemented:** Driver accept/reject/start/complete/cancel/fail transitions now update the passenger request and related merchant entities in the same transaction. Driver rejection deliberately returns passenger demand to `pending` rather than inventing an unsupported `rejected` request state.
- **Files changed:** `apps/api/src/modules/trips.ts`, `apps/api/src/modules/passenger.ts`, `apps/api/src/services/tripLifecycle.ts`, Flutter status/recovery screens, synchronization tests.
- **API involved:** match accept/reject and trip status APIs.
- **Database changes:** Related request, match, trip, route, batch, order, and parcel updates are transactionally synchronized.
- **UI changes:** Passenger match polling reacts to accepted/rejected states and navigates to the real Trip after acceptance.
- **Validation:** Synchronization tests cover accept, reject, start, completion, cancellation, and failure. Full integration execution blocked.
- **Result:** **PASS at code/integration level; runtime validation BLOCKED.**

### Task 5 — Capacity Reservation

- **What was implemented:** Added a legacy capacity reservation helper that atomically decrements real route seat and parcel counters during legacy matching/acceptance and restores those counters on reject, cancel, fail, and expiry. Matching uses the actual requested seats/parcel units; it no longer treats the counters as display-only values.
- **Files changed:** `apps/api/src/services/legacyCapacity.ts`, `apps/api/src/modules/matching.ts`, `apps/api/src/modules/trips.ts`, `apps/api/src/modules/passenger.ts`, `apps/api/src/modules/merchant.ts`, lifecycle/dispatch services and tests.
- **API involved:** match run/accept/reject, passenger cancellation, merchant cancellation, trip status.
- **Database changes:** `matches.legacy_capacity_held` tracks whether legacy capacity was reserved; the migration keeps capacity releases auditable and transactional. Existing canonical `CapacityReservation` remains unchanged and isolated for canonical routes.
- **UI changes:** Driver route capacity shown to matching and assignment flows comes from real persisted counters.
- **Validation:** Capacity race and release assertions added; real MySQL execution blocked by environment.
- **Result:** **PASS at code/integration level; runtime validation BLOCKED.**

### Task 6 — Delivery Batching

- **What was implemented:** Merchant batching now groups real compatible submitted orders owned by the same merchant, creates one persisted batch with explicit batch-membership rows, enforces parcel limits, assigns all member parcels to the same batch, and lets matching reserve the combined parcel capacity. Historical memberships are retained while active membership is protected by a nullable unique key.
- **Files changed:** `apps/api/src/modules/batching.ts`, Prisma schema/migration, merchant models/UI, batching tests.
- **API involved:** `POST /api/v1/merchant/orders/:id/batch`, legacy matching/acceptance APIs.
- **Database changes:** Added `ParcelBatchOrder` with historical membership plus active-membership uniqueness; batch/order status transitions were expanded for terminal outcomes.
- **UI changes:** Merchant order detail displays member batches; assigned batches expose their persisted trip/status.
- **Validation:** Multi-order batch creation and duplicate prevention tests added. Full DB execution blocked.
- **Result:** **PASS at code/integration level; runtime validation BLOCKED.**

### Task 7 — Merchant Delivery Lifecycle

- **What was implemented:** Merchant order, parcel, and batch records are synchronized with Trip lifecycle transitions. `assigned`, `in_transit`, `delivered`, `completed`, `cancelled`, `failed`, and `expired` are persisted with the existing model vocabulary; parcel records use `delivered` while completed merchant orders become `completed`.
- **Files changed:** `apps/api/src/services/tripLifecycle.ts`, merchant module/controller/repository/UI files, admin monitoring contracts/UI, tests.
- **API involved:** merchant order/batch APIs and Trip status APIs.
- **Database changes:** Explicit merchant order, parcel, and batch failure/expiry/cancellation states.
- **UI changes:** Merchant status rendering distinguishes completed, failed, cancelled, and expired outcomes; assigned driver/batch/trip information is preserved.
- **Validation:** Failure and assignment synchronization tests added. Runtime execution blocked.
- **Result:** **PASS at code/integration level; runtime validation BLOCKED.**

### Task 8 — Cancellation / Failure States

- **What was implemented:** Passenger cancellation, driver rejection, driver cancellation, failed delivery, match expiry, passenger request expiry, merchant order expiry, and capacity expiry now have explicit persistence and transactional cleanup. A legacy dispatch worker runs periodically with a non-overlapping 30-second interval to expire stale legacy matches and overdue requests/orders.
- **Files changed:** `apps/api/src/services/legacyDispatch.ts`, `apps/api/src/lib/legacyDispatchWorker.ts`, trip/passenger/merchant modules, driver Flutter lifecycle UI, tests.
- **API involved:** passenger cancel, merchant cancel, match accept/reject, trip status.
- **Database changes:** Explicit `failed`/`expired` states for merchant/order/parcel/batch and `completed` for passenger requests, plus active batch membership cleanup.
- **UI changes:** Driver can cancel eligible trips and mark in-transit deliveries failed; passenger/merchant UI keeps terminal states visible.
- **Validation:** Expiry, cancellation, failure, and capacity-release tests added. Runtime worker/DB execution blocked by environment.
- **Result:** **PASS at code/integration level; runtime validation BLOCKED.**

## Validation Summary

The implementation was statically inspected and tested where the execution environment allowed it. Migration integrity, tracked-secret checks, whitespace/syntax checks, and targeted source-level tests were executed. Full npm/Prisma, Flutter, Admin build, and MySQL integration execution was **BLOCKED** because the environment lacked the required installed dependencies/toolchains and external package access.

No hardcoded drivers, fake trips, fake matching results, real secrets, or production `.env` files were added.

## UI Reference Applied

For the requested passenger, driver, and merchant task flows, the supplied UI reference was used selectively rather than redesigning unrelated screens. The applied visual direction uses the reference palette (#2F4A3A, #7A8F5A, #E6D2B3, #C66A3D, #8A3F2A), warm surfaces, compact rounded cards, labelled status pills, pinned transactional actions, and map/bottom-sheet patterns shown in the task screens.

## Supplied UI Reference

The visual reference was applied selectively to the requested mobile task flows: passenger request/route selection/matching/active/completion screens, driver home/incoming request/trip screens, and merchant create-shipment/delivery-batching/tracking screens. The palette follows the exact five swatches shown in the reference (#2F4A3A, #7A8F5A, #E6D2B3, #C66A3D, #8A3F2A), with warm surfaces, compact rounded cards, labelled status pills, and pinned transactional actions. The reference identifies passenger screens 6-13, driver screens 16-17, and merchant screens 18-21 as the relevant role flows.

### CI Test Fixture Correction

The admin monitoring HTTP boundary tests were updated so their mocked active Admin session satisfies the existing global profile-completion and email-verification middleware. This is a test-fixture correction only and does not weaken production authorization.

## CI Follow-up

The GitHub CI issues found after the implementation were addressed. The Flutter formatting failure was caused by 15 Dart files missing their final newline; those files were normalized. The backend CI failure was caused by an incomplete Admin test session fixture, which has been corrected without weakening production authorization. The dependency security remediation pins `fast-uri` to `3.1.8`; the local offline lockfile audit reports zero vulnerabilities.

Runtime CI should be re-run in GitHub because this environment does not contain Flutter or the GitHub runner's network-backed npm audit service.

