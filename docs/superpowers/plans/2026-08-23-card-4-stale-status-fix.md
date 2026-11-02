# Card 4 Stale Status Conflict Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every Admin account-status mutation carries the status from the visible user snapshot so stale tabs receive HTTP 409 and reload authoritative state.

**Architecture:** Require `expected_status` at the backend trust boundary after auditing and updating every repository caller, so omitted snapshots fail closed instead of silently overwriting newer state. Make the Admin API client require `expectedStatus`, capture that value in an immutable status intent at click time, use the same intent from directory and detail actions, and centralize the 409 reload behavior in a testable controller helper.

**Tech Stack:** TypeScript, React 19, Vite, Vitest, Express, Prisma/MySQL.

**Spec:** `C:/Users/basha/.codex/attachments/2e3f973d-afa6-4bf7-b456-a91de8aacdb3/pasted-text.txt`

## Global Constraints

- Stay on `admin/user-management` and update draft PR #28 only.
- Do not merge, begin Card 5, create a migration, or change the Prisma schema.
- Do not mutate real `darb`; use only `darb_users_qa` for status mutation testing.
- Preserve pending driver/merchant, self-Admin, last-active-Admin, session-revocation, and authorization protections.
- Keep API >= 327, Admin >= 95, Mobile >= 241, and security findings at zero.

---

### Task 1: Prove the request-contract gap

**Files:**
- Test: `apps/admin/src/api.test.ts`
- Test: `apps/admin/src/features/verification/DriverDirectory.test.tsx`
- Test: `apps/admin/src/features/users/UsersDirectory.test.tsx`

**Interfaces:**
- Consumes: `ApiClient.updateUserStatus(token, id, targetStatus, reason, expectedStatus)`.
- Produces: failing tests proving active and suspended snapshots must be sent by every Admin action.

- [x] Add a client test for `active -> suspended` with literal `expected_status: "active"`.
- [x] Add a client test for `suspended -> active` with literal `expected_status: "suspended"`.
- [x] Add directory and detail intent tests that assert the expected status is captured from the visible snapshot.
- [x] Add a Driver Directory test whose callback receives the visible driver's status.
- [x] Run focused Admin tests and confirm failure is specifically the missing snapshot field/signature.

### Task 2: Enforce Admin snapshot status and authoritative conflict reload

**Files:**
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/features/verification/DriverDirectory.tsx`
- Modify: `apps/admin/src/features/users/UsersDirectory.tsx`
- Modify: `apps/admin/src/i18n/translations.ts`

**Interfaces:**
- Consumes: visible `UserAccountStatus` from a directory row, detail response, or driver row.
- Produces: required Admin client payload `{ status, reason?, expected_status }` and localized 409 reload feedback.

- [x] Make `expectedStatus: UserAccountStatus` required in the Admin client and always serialize `expected_status`.
- [x] Capture `{ user, nextStatus, expectedStatus }` when a directory or detail action starts.
- [x] Pass the driver row's `account_status` through `DriverDirectory` and `App.updateUserStatus`.
- [x] Keep the pending confirmation open on 409, reload list/detail, render the new authoritative status, and show localized conflict text without a success notice.
- [x] Run focused Admin tests and verify they pass.

### Task 3: Strengthen the backend two-snapshot regression

**Files:**
- Modify: `apps/api/src/tests/accountStatus.test.ts`

**Interfaces:**
- Consumes: `PATCH /api/v1/admin/users/:id/status` with `expected_status`.
- Produces: a test where mutation B succeeds, stale mutation A returns 409, and no second write occurs.

- [x] Write the two-request failing regression using the exact Admin request shape.
- [x] Require `expected_status` in the backend schema and update every audited repository caller.
- [x] Run the focused API test and verify omitted snapshots fail closed while existing protections remain intact.

### Task 4: Disposable QA and regression gate

**Files:**
- No tracked production files beyond Tasks 1-3.

**Interfaces:**
- Consumes: `darb_users_qa`, QA API 3100, QA Admin 5174.
- Produces: one active synthetic stale-test user and complete verification evidence.

- [x] Run the live sequence: both snapshots active, Tab B suspend 200, stale Tab A disable 409, authoritative state suspended.
- [x] Restore only the synthetic QA user to active for human retest.
- [x] Run API, Admin, Mobile, MySQL, build/typecheck, migration-count, and security gates.
- [ ] Commit `fix(admin): enforce stale user status conflicts`, push to PR #28, keep it draft, and wait for hosted CI.
