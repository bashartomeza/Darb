# Card 4 Human QA Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Card 4 User Management is complete, add genuinely missing focused tests, and prepare an isolated MySQL/Admin/API environment for human QA.

**Architecture:** Keep the existing Admin-only directory/detail/status endpoints and React screen. Add route-level API tests and component-level Admin tests around the real contracts, then validate them against disposable MySQL while keeping the real `darb` database read-only.

**Tech Stack:** TypeScript, Express, Prisma/MySQL, React/Vite, Vitest/Supertest, Flutter, GitHub Actions.

**Spec:** `C:/Users/basha/.codex/attachments/b58bf48b-0d42-4f9f-86ff-d10d0ead7b70/pasted-text.txt`

## Global Constraints

- Do not merge or begin Card 5.
- Do not mutate real Bashar/Ahmad data or reset the real `darb` database.
- Keep migrations at 21 and do not change Prisma schema.
- Use a normal merge commit only if production-readiness advanced and integration is safe.
- Keep the pull request draft and require all hosted checks green.

---

### Task 1: Git and coverage audit

**Files:**
- Inspect: `apps/api/src/modules/admin.ts`
- Inspect: `apps/api/src/tests/accountStatus.test.ts`
- Inspect: `apps/admin/src/features/users/UsersDirectory.tsx`

- [ ] Fetch origin, verify PR #27 ancestry, compare feature/base, and inspect any drift.
- [ ] Inventory every required backend and Admin UI scenario against current focused tests.
- [ ] Audit response projections, pagination bounds, ordering, and query count.

### Task 2: Focused backend coverage

**Files:**
- Create: `apps/api/src/tests/userDirectoryAdmin.test.ts`
- Modify only if a failing test proves a defect: `apps/api/src/modules/admin.ts`

- [ ] Write route-level tests for authorization, complete listing, searches, filters, pagination/order, safe projection, role details, 404, and pending activation blocks.
- [ ] Run the new file and verify uncovered behavior fails for the expected reason.
- [ ] Make only the minimum production correction required, then run the focused and full API suites.

### Task 3: Focused Admin coverage

**Files:**
- Create: `apps/admin/src/features/users/UsersDirectory.test.tsx`
- Modify only if a failing test proves a defect: `apps/admin/src/features/users/UsersDirectory.tsx`

- [ ] Test loading, loaded/empty/error states, filters/search/pagination, detail contexts, status confirmations, stale reload, self-protection, Arabic/English, and LTR phone rendering.
- [ ] Verify tests fail for missing behavior, apply minimum fixes, then run focused/full Admin suites and build.

### Task 4: Disposable MySQL QA environment

**Files:**
- Create only ignored/local temporary environment or helper material, then remove helpers.

- [ ] Create `darb_users_qa`, deploy migrations 0→21, repeat deploy, and confirm migration status.
- [ ] Populate the ten synthetic fixtures through schema-valid local-only operations without real numbers.
- [ ] Start isolated API on 3100 and Admin on 5174, verify queue/directory/detail/status contracts, and leave fixtures intact.
- [ ] Query real `darb` read-only to confirm Bashar is visible through the directory contract without exposing secrets.

### Task 5: Full merge gate

**Files:**
- Modify: focused tests or implementation only for proven regressions.

- [ ] Run API, Admin, Mobile, MySQL integration, typecheck/build, migration, deterministic-demo, and security commands.
- [ ] Commit and push the exact verified head; create one draft PR if absent.
- [ ] Wait for and verify Admin, Backend/MySQL, Mobile, and Security GitHub checks.
- [ ] Report the exact QA URLs, database, counts, privacy/query findings, final head, and readiness without merging.
