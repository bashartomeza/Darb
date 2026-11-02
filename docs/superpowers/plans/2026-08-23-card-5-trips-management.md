# Card 5 Admin Trips Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a safe, query-bounded Admin trip directory/detail experience across legacy, canonical, and shared trips, while exposing only concurrency-safe forward legacy transitions.

**Architecture:** Add dedicated Admin read/mutation routes and extract the existing legacy transition behavior into one shared service. Keep canonical/shared trips read-only, require Admin expected-status snapshots, show only persisted location evidence, and replace the demo tracking controls with a bilingual responsive management UI.

**Tech Stack:** TypeScript, Express, Prisma/MySQL, React 19, Vite, Vitest, Flutter regression suite.

**Spec:** `docs/superpowers/specs/2026-08-23-card-5-trips-management-design.md`

## Global constraints

- Branch `admin/trips-management` from current `origin/production-readiness`; draft PR only.
- No Prisma schema change, migration 22, real `darb` mutation, demo reset, Card 6, maps/GPS/realtime/payments, mobile lifecycle redesign, or matching/batching redesign.
- Canonical/shared trips are read-only; Admin cancellation is disabled.
- Preserve baseline API 329, Admin 101, Mobile 241 and zero moderate/high/critical audit findings.

### Task 1: Lock the Admin API contract with failing tests

**Files:**
- Create: `apps/api/src/tests/adminTrips.test.ts`
- Inspect: `apps/api/src/modules/trips.ts`
- Inspect: `apps/api/prisma/schema.prisma`

- [x] Add authentication tests proving unauthenticated is 401 and non-Admin is 403.
- [x] Add list tests for bounded pagination, deterministic ordering, search/status/type filters, all three trip kinds, and safe projections.
- [x] Add detail tests for route/participant summaries, bounded shared members, and latest persisted location with source/timestamp.
- [x] Add mutation tests for every safe legacy forward transition, mandatory `expected_status`, stale 409 with no related writes, created no-op policy, canonical/shared read-only policy, and cancellation rejection.
- [x] Run the focused API test and observe the expected missing-route failures.

### Task 2: Extract one legacy lifecycle service

**Files:**
- Create: `apps/api/src/services/tripLifecycle.ts`
- Modify: `apps/api/src/modules/trips.ts`
- Modify: `apps/api/src/tests/tripsTracking.test.ts`

- [x] Move the existing transition graph and related route/request/order/batch/parcel writes into the shared service.
- [x] Keep the role-owned route authorization and request contract unchanged while delegating its mutation transaction to the service.
- [x] Preserve its existing cancellation behavior only for existing callers; do not expose cancellation to Admin.
- [x] Run focused legacy trip tests and prove no lifecycle regression.

### Task 3: Implement dedicated Admin trip APIs

**Files:**
- Create: `apps/api/src/modules/adminTrips.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/tests/adminTrips.test.ts`

- [x] Implement safe explicit projections and the legacy/canonical/shared classifier.
- [x] Implement capped pagination, bounded filters/search, count metadata, and deterministic ordering.
- [x] Implement safe detail with bounded shared members and latest stored `LocationEvent` only.
- [x] Implement Admin-only safe-forward mutation with required expected status and transaction-level stale protection through the shared service.
- [x] Translate stale state to HTTP 409 with authoritative status and guarantee zero write.
- [x] Run focused API tests until green, then API typecheck/build.

### Task 4: Lock the Admin client and UI behavior with failing tests

**Files:**
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/api.test.ts`
- Create: `apps/admin/src/features/trips/TripsManagement.test.tsx`
- Modify: `apps/admin/src/App.test.tsx`

- [x] Add client tests for list/detail query contracts and mutation payload `{ status, expected_status }`.
- [x] Add UI tests for loading/error/empty, search/filters/pagination, directory-to-detail navigation, and refresh.
- [x] Add tests for legacy action availability, created/canonical/shared read-only states, disabled cancellation explanation, confirmation, stale 409 reload, and persisted-location labeling.
- [x] Add Arabic RTL, English LTR, keyboard-semantic, and narrow-layout assertions.
- [x] Run focused Admin tests and observe failures before implementation.

### Task 5: Build the bilingual responsive Admin workflow

**Files:**
- Create: `apps/admin/src/features/trips/TripsManagement.tsx`
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/i18n/translations.ts`
- Modify: `apps/admin/src/styles.css`
- Remove or retire from Trips route: `apps/admin/src/features/trips/TripsTracking.tsx`

- [x] Add typed Admin trip list/detail/mutation client methods.
- [x] Build controlled server-side search/status/type filters and capped pagination.
- [x] Build responsive directory and detail states with safe route/participant projections.
- [x] Render latest stored location with source/time and never use live-GPS wording.
- [x] Render exactly the allowed legacy action with confirmation; show honest read-only/created/cancellation limitations.
- [x] On 409, show localized conflict feedback and reload directory/detail without success feedback.
- [x] Preserve Arabic RTL, English LTR, keyboard access, and the existing Admin shell.
- [x] Run focused Admin tests until green, then Admin typecheck/build.

### Task 6: Automated repository gate

**Files:**
- No schema or migration additions.

- [x] Run API suite and build/typecheck; require at least 329 tests plus new coverage.
- [x] Run Admin suite and build/typecheck; require at least 101 tests plus new coverage.
- [x] Run Mobile analyze/tests; require 241 tests.
- [x] Run MySQL integration/validation required by repository CI.
- [x] Prove migration count remains 21 and approved migration history is unchanged.
- [x] Run workflow validation, secret scan, dependency audit, and deterministic-demo checks.
- [x] Review the diff for scope, N+1 hazards, unsafe projections, fake data, and unsupported controls.

### Task 7: Commit, draft PR, hosted CI, and disposable human QA

**Files:**
- Tracked implementation/tests/docs only; local QA configuration remains ignored.

- [ ] Commit focused API and Admin changes, push `admin/trips-management`, and open one draft PR against `production-readiness`.
- [ ] Wait for Backend/MySQL, Admin, Mobile, and Security CI on the exact head; fix only Card 5 regressions.
- [x] Create an isolated disposable QA database from migrations 0 through 21; never touch real `darb`.
- [x] Prepare clearly synthetic legacy states, one stale-conflict pair, canonical/shared read-only examples, and stored-location/no-location examples using real schema/contracts.
- [x] Start QA API on 3100 and Admin on 5174 with QA-only ignored configuration.
- [x] Verify list/detail/actions/409/auth/RTL/LTR/responsive behavior and leave fixtures ready for the human.
- [ ] Return `CARD 5 READINESS = READY_FOR_HUMAN_QA` only when local and hosted gates are green.
