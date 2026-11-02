# Card 6: Admin Route Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete and harden Darb's existing feature-gated Admin route-management workflow without changing Prisma, migrations, maps/providers, legacy DriverRoute, or mobile route behavior.

**Architecture:** Extend `createRouteManagementService`, its existing Admin router, and the existing `#/routes` workspace. Use bounded Prisma projections and existing draft revisions, add explicit observed-current-version fences to lifecycle mutations, and keep the backend publication validator authoritative. Add a guarded disposable-MySQL harness for concurrency and human-QA fixtures.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7.9.1/MySQL 8, React 19, Vite 8, Vitest 4, Flutter, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-25-card-6-route-management-design.md`

## Global Constraints

- Existing `ServiceRoute`, `ServiceRouteVersion`, `Stop`, `RouteVersionStop`, service, routers, public catalog, and Admin UI are authoritative.
- `ROUTE_MANAGEMENT_ENABLED` and `VITE_ROUTE_MANAGEMENT_ENABLED` remain unchanged production safety gates.
- `ROUTE_MAPS_ENABLED` remains disabled; no maps, providers, geocoding, GPS, geometry persistence, credentials, or canonical place catalog.
- Legacy `DriverRoute` remains separate and unchanged.
- Prisma schema stays byte-identical; Migration 22 is forbidden; total migrations remain 21.
- All mutation/integration/QA database work targets only validated disposable databases, with human QA fixed to `darb_routes_qa`.
- Real `darb` must not be migrated, reset, seeded, or mutated.
- Unknown backend errors are never rendered raw; all 409 conflicts suppress success and cause authoritative reload.
- Arabic remains default RTL, English LTR; IDs, keys, and coordinates remain LTR.
- Required regression floors: API >=341, Admin >=111, Mobile >=241; audit severities all zero.

---

### Task 1: Bound Admin route projections and lifecycle request contracts

**Files:**
- Modify: `apps/api/src/tests/routeManagementApi.test.ts`
- Modify: `apps/api/src/modules/routeManagement.ts`
- Modify: `apps/api/src/services/routeManagement.ts`
- Modify: `docs/api/admin-routes.md`

**Interfaces:**
- Consumes: existing `RouteManagementService`, `serializeRoute`, `serializeVersion`, `serializeStop`.
- Produces: `ADMIN_ROUTE_VERSION_HISTORY_LIMIT = 50`; lifecycle inputs containing `expectedCurrentVersionId`; request bodies containing `expected_current_version_id`.

- [ ] **Step 1: Add failing API tests for current-version expectations**

Add separate tests proving pause, resume, version retirement, and route retirement reject a missing expectation with HTTP 400 and forward an explicit expectation to the service:

```ts
await request(target.server)
  .post("/api/v1/admin/route-versions/version_1/pause")
  .set(admin)
  .set("Idempotency-Key", "version-pause-001")
  .send({ reason: "service review", expected_current_version_id: "version_1" })
  .expect(200);

expect(target.service.pauseVersion).toHaveBeenCalledWith(
  "version_1",
  { reason: "service review", expectedCurrentVersionId: "version_1" },
  expect.objectContaining({ id: "admin_1" })
);
```

Use literal bodies for resume, version retirement, and route retirement. Route retirement must accept only `expected_current_version_id: null`.

- [ ] **Step 2: Run the focused API test and verify RED**

Run: `npm test -w @darb/api -- --run src/tests/routeManagementApi.test.ts`

Expected: FAIL because lifecycle schemas omit `expected_current_version_id` and service mocks receive the old argument shape.

- [ ] **Step 3: Add failing safe-projection assertions**

Extend the Admin detail fixture with 51 historical versions plus forbidden fields (`encoded_geometry`, `geometry_provider`, actor IDs, checksums). Assert the serialized detail contains at most 50 versions, retains `version_count: 51`, caps nested stops at 100, and contains none of the forbidden values.

- [ ] **Step 4: Run the focused API test and verify the projection test is RED**

Run: `npm test -w @darb/api -- --run src/tests/routeManagementApi.test.ts`

Expected: FAIL because the current serializer returns every supplied historical version.

- [ ] **Step 5: Implement strict lifecycle schemas and bounded serializers**

Add schemas and use structured service inputs:

```ts
const currentVersionExpectation = z.strictObject({ expected_current_version_id: id.nullable() });
const pauseSchema = currentVersionExpectation.extend({ reason: cleanText(500) });
const resumeSchema = currentVersionExpectation;
const retireVersionSchema = pauseSchema;
const retireRouteSchema = z.strictObject({
  reason: cleanText(500),
  expected_current_version_id: z.null()
});
```

Export `ADMIN_ROUTE_VERSION_HISTORY_LIMIT = 50` from the service. Limit the service detail query with deterministic `take: 50`, and defensively cap serialized version and stop arrays. Keep directory rows summary-only and omit encoded/provider/integrity fields.

- [ ] **Step 6: Run the focused API suite and typecheck GREEN**

Run:

```powershell
npm test -w @darb/api -- --run src/tests/routeManagementApi.test.ts
npm run typecheck:api
```

Expected: all route API tests pass; typecheck exits 0.

- [ ] **Step 7: Document the exact contract and commit**

Update `docs/api/admin-routes.md` with the 50-version bound, 100-stop bound, and lifecycle expectation bodies.

```powershell
git add apps/api/src/tests/routeManagementApi.test.ts apps/api/src/modules/routeManagement.ts apps/api/src/services/routeManagement.ts docs/api/admin-routes.md
git commit -m "feat(api): bound and fence admin route contracts"
```

---

### Task 2: Enforce stale current-version fencing in the authoritative service

**Files:**
- Create: `apps/api/src/tests/routeManagementService.test.ts`
- Modify: `apps/api/src/services/routeManagement.ts`
- Modify: `apps/api/src/scripts/routeCatalogIntegration.ts`

**Interfaces:**
- Consumes: `lockRoute`, `lockVersion`, idempotency, audit and existing lifecycle methods.
- Produces: `assertExpectedCurrentVersion(actual, expected)` and zero-write `409 current_version_conflict` behavior while preserving `draft_revision` semantics.

- [ ] **Step 1: Write failing service tests for the current pointer guard**

Test a small exported pure guard with literal inputs, then exercise service transactions with a focused Prisma transaction double. The production break each test catches is removal or inversion of the pointer comparison:

```ts
expect(() => assertExpectedCurrentVersion("version_2", "version_1"))
  .toThrowError(expect.objectContaining({ status: 409, message: "current_version_conflict" }));
expect(() => assertExpectedCurrentVersion(null, null)).not.toThrow();
```

For pause/resume/retire, assert a mismatch occurs before `serviceRouteVersion.update` or audit creation.

- [ ] **Step 2: Run the service test and verify RED**

Run: `npm test -w @darb/api -- --run src/tests/routeManagementService.test.ts`

Expected: FAIL because the guard and structured lifecycle inputs do not yet exist.

- [ ] **Step 3: Implement minimal service fences under existing row locks**

Add:

```ts
export function assertExpectedCurrentVersion(
  actual: string | null,
  expected: string | null
) {
  if (actual !== expected) throw new HttpError(409, "current_version_conflict");
}
```

Call it after locking the route and before any version/route update. Pause/resume additionally require `expectedCurrentVersionId === id`. Version retirement compares the observed pointer even when retiring a historical version. Route retirement requires both the expected and locked pointer to be null. Include expectation fields in idempotency digests.

- [ ] **Step 4: Run service and API tests GREEN**

Run:

```powershell
npm test -w @darb/api -- --run src/tests/routeManagementService.test.ts src/tests/routeManagementApi.test.ts
```

Expected: both files pass.

- [ ] **Step 5: Add real-MySQL stale-current scenarios to the existing integration harness**

Using fresh synthetic routes in `routeCatalogIntegration.ts`, prove:

1. Admin A observes V1.
2. Admin B publishes V2.
3. Admin A pause/resume/retire request with expected V1 returns `current_version_conflict`.
4. V1/V2 statuses, route current pointer, and audit-event count remain unchanged by the rejected call.
5. A fresh expectation permits the domain-supported action.

Update all existing lifecycle calls in this harness to pass observed current pointers.

- [ ] **Step 6: Build and run the integration harness only against a disposable database**

Run through the repository's MySQL CI wrapper, which creates and destroys its own isolated database:

```powershell
npm run build:api
npm run test:integration:mysql
```

Expected: migration deploy 0->21, repeated deploy no-op, route concurrency assertions pass, cleanup passes. Never point this command at a manually supplied real `darb` URL.

- [ ] **Step 7: Commit the authoritative lifecycle hardening**

```powershell
git add apps/api/src/tests/routeManagementService.test.ts apps/api/src/services/routeManagement.ts apps/api/src/scripts/routeCatalogIntegration.ts
git commit -m "fix(api): reject stale route lifecycle mutations"
```

---

### Task 3: Add typed Admin clients and authoritative conflict reload behavior

**Files:**
- Modify: `apps/admin/src/api.test.ts`
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/features/routes/RouteManagement.test.tsx`
- Modify: `apps/admin/src/features/routes/RouteManagement.tsx`

**Interfaces:**
- Consumes: lifecycle request contract from Task 1.
- Produces: `RouteLifecycleExpectation`; `routeConflictRequiresReload`; `handleRouteMutationFailure`.

- [ ] **Step 1: Write failing API-client payload tests**

Assert the real `createApiClient` sends exact JSON bodies:

```ts
await client.routeVersionAction(
  "token",
  "version_1",
  "pause",
  { reason: "review", expected_current_version_id: "version_1" },
  "pause-key"
);
expect(fetchBody()).toEqual({
  reason: "review",
  expected_current_version_id: "version_1"
});
```

Cover resume, version retirement, and route retirement.

- [ ] **Step 2: Run Admin API tests and verify RED**

Run: `npm test -w @darb/admin -- --run src/api.test.ts`

Expected: FAIL because the client currently sends only `reason` or `{}`.

- [ ] **Step 3: Implement typed request payloads**

Add exact types and update methods:

```ts
export type RouteLifecycleExpectation = {
  expected_current_version_id: string | null;
};

routeVersionAction(token, id, action, body, key)
retireServiceRoute(token, id, body, key)
```

Do not widen request bodies with arbitrary records.

- [ ] **Step 4: Write failing conflict-reload helper tests**

Test observable orchestration rather than component source text:

```ts
const reload = vi.fn().mockResolvedValue(undefined);
const message = await handleRouteMutationFailure(
  Object.assign(new Error("current_version_conflict"), { status: 409 }),
  reload,
  "en"
);
expect(reload).toHaveBeenCalledOnce();
expect(message).toContain("reload");
```

Also prove non-409 errors do not reload and never expose unknown internal text.

- [ ] **Step 5: Run the focused UI test and verify RED**

Run: `npm test -w @darb/admin -- --run src/features/routes/RouteManagement.test.tsx`

Expected: FAIL because the helper does not exist.

- [ ] **Step 6: Implement and use authoritative conflict handling**

Add a helper that reloads on every status-409 error and returns localized feedback. Use it in draft save, stop replacement, publish, pause, resume, version retirement, route retirement, stop edit and stop retirement catches. Set success only after the mutation and any reload complete.

- [ ] **Step 7: Run Admin focused tests and typecheck GREEN**

Run:

```powershell
npm test -w @darb/admin -- --run src/api.test.ts src/features/routes/RouteManagement.test.tsx
npm run typecheck:admin
```

Expected: focused tests and typecheck pass.

- [ ] **Step 8: Commit the client concurrency behavior**

```powershell
git add apps/admin/src/api.test.ts apps/admin/src/api.ts apps/admin/src/features/routes/RouteManagement.test.tsx apps/admin/src/features/routes/RouteManagement.tsx
git commit -m "fix(admin): reload authoritative route conflicts"
```

---

### Task 4: Complete route directory, detail, readiness, and Stop editing UI

**Files:**
- Create: `apps/admin/src/features/routes/StopEditor.tsx`
- Create: `apps/admin/src/features/routes/StopEditor.test.tsx`
- Modify: `apps/admin/src/features/routes/RouteManagement.test.tsx`
- Modify: `apps/admin/src/features/routes/RouteManagement.tsx`
- Modify: `apps/admin/src/i18n/translations.ts`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes: `CanonicalStop`, `CanonicalStopDraft`, `RouteStopDraft`, bounded route detail and Admin API methods.
- Produces: `StopEditor`; `publicationReadiness(version, stops)` returning localized readiness issue keys.

- [ ] **Step 1: Write failing StopEditor behavior tests**

Render the real component with `renderToStaticMarkup`. Assert active unused stops expose an Edit button and fields for bilingual names, region, latitude, and longitude; `stop_key` is rendered read-only; retired/used stops expose no edit affordance; manual-coordinate help is present.

- [ ] **Step 2: Run the StopEditor test and verify RED**

Run: `npm test -w @darb/admin -- --run src/features/routes/StopEditor.test.tsx`

Expected: FAIL because `StopEditor.tsx` does not exist.

- [ ] **Step 3: Implement the minimal accessible StopEditor**

Use a semantic form with controlled draft state, explicit Arabic/English directions, numeric coordinate bounds, Cancel/Save buttons, and labels. It calls an injected `onSave(stop.id, draft)`; the parent calls `api.updateCanonicalStop`, reloads the bounded stop catalog, and handles conflicts through Task 3.

- [ ] **Step 4: Write failing readiness and directory-filter tests**

Use literal version/stop fixtures to prove readiness reports:

- missing bilingual name;
- fewer than two stops;
- inactive or foreign-region stop;
- invalid date order;
- absent downstream passenger path;
- inconsistent parcel path.

Also assert the real rendered directory includes status, direction and region filters, current-version status, route status, bounded-history notice, distinct stop status, and a maps-unavailable message.

- [ ] **Step 5: Run RouteManagement tests and verify RED**

Run: `npm test -w @darb/admin -- --run src/features/routes/RouteManagement.test.tsx src/features/routes/StopEditor.test.tsx`

Expected: FAIL on missing filters/readiness/status/preview behavior.

- [ ] **Step 6: Implement directory/detail completion**

Add direction and service-region filter state to the existing query. Preserve page size 25 and deterministic server ordering. Display `versions.length` against `version_count` to disclose bounded history. Keep route, selected-version, and stop badges separately labeled. Display readiness advisories before Publish but submit to the backend as authority; do not reproduce the entire domain validator.

Wire Stop edit, successful reload, used-stop safe errors, and confirmation-based retirement. Preserve up/down ordering buttons with index-specific accessible names. Add approximately 560 px CSS rules that stack controls and keep IDs/keys/coordinates LTR without horizontal-only interactions.

- [ ] **Step 7: Add complete Arabic/English copy**

Add bounded localized labels for direction/region filters, route/version/stop status headings, manually supplied coordinates, edit/cancel/save, readiness issues, truncated history, map preview unavailable, and stale reload guidance. Do not render raw backend codes.

- [ ] **Step 8: Run focused and complete Admin verification GREEN**

Run:

```powershell
npm test -w @darb/admin -- --run src/features/routes/RouteManagement.test.tsx src/features/routes/StopEditor.test.tsx src/api.test.ts
npm run test:admin
npm run build:admin
```

Expected: all Admin tests pass at a count above 111; build exits 0.

- [ ] **Step 9: Commit the completed Admin experience**

```powershell
git add apps/admin/src/features/routes/StopEditor.tsx apps/admin/src/features/routes/StopEditor.test.tsx apps/admin/src/features/routes/RouteManagement.test.tsx apps/admin/src/features/routes/RouteManagement.tsx apps/admin/src/i18n/translations.ts apps/admin/src/styles.css
git commit -m "feat(admin): complete route management workspace"
```

---

### Task 5: Add guarded disposable QA fixture preparation

**Files:**
- Create: `apps/api/src/scripts/routeManagementQa.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Create: `docs/qa/card-6-route-management.md`

**Interfaces:**
- Consumes: existing route-management service and Prisma client.
- Produces: `npm run qa:routes -- prepare|verify|cleanup`, hard-limited to `darb_routes_qa`.

- [ ] **Step 1: Write the fixture guard as a failing script-level test**

Add a small exported `assertRouteQaDatabase(databaseUrl)` and test it in `routeManagementService.test.ts` with literal URLs. It must accept only a local host plus exact database `darb_routes_qa`, and reject `darb`, remote hosts, missing database, or query-string tricks before Prisma connects.

- [ ] **Step 2: Run the guard test and verify RED**

Run: `npm test -w @darb/api -- --run src/tests/routeManagementService.test.ts`

Expected: FAIL because the QA guard does not exist.

- [ ] **Step 3: Implement prepare, verify, and cleanup modes**

The script must:

- require an explicit `--confirm-disposable` flag;
- validate local MySQL and exact database name before Prisma construction;
- never print credentials, phones, tokens, hashes, or secrets;
- create synthetic route/stop/version scenarios A-L through current services where possible;
- leave fixtures intact after `prepare`;
- verify expected states without mutation in `verify`;
- delete only rows carrying the fixed `qa-card6-` key prefix in dependency order during `cleanup`;
- never call demo reset.

- [ ] **Step 4: Document process-local QA startup and cleanup**

Document exact environment boundaries: DB `darb_routes_qa`, API 3100, Admin 5174, route management enabled, maps/provider disabled. Include fixture identities, manual checklist, and exact cleanup command. Do not embed credentials or legal/user data.

- [ ] **Step 5: Run the disposable QA lifecycle**

Create/deploy only the validated disposable database, then run:

```powershell
npm run qa:routes -- prepare --confirm-disposable
npm run qa:routes -- verify --confirm-disposable
```

Expected: all scenarios ready and remain in `darb_routes_qa` for human QA. Do not run cleanup before handoff; provide the cleanup command only.

- [ ] **Step 6: Commit QA tooling and documentation**

```powershell
git add apps/api/src/scripts/routeManagementQa.ts apps/api/package.json package.json docs/qa/card-6-route-management.md apps/api/src/tests/routeManagementService.test.ts
git commit -m "test(routes): prepare disposable card 6 QA fixtures"
```

---

### Task 6: Full regression, security, review, integration and delivery

**Files:**
- Modify only if verification reveals a Card 6 regression: files already listed in Tasks 1-5.

**Interfaces:**
- Consumes: completed Card 6 branch and disposable QA environment.
- Produces: exact-head draft PR and `READY_FOR_HUMAN_QA` evidence.

- [ ] **Step 1: Verify scope and migration invariants**

Run:

```powershell
git diff --check origin/production-readiness...HEAD
git diff --name-only origin/production-readiness...HEAD
git diff --exit-code origin/production-readiness...HEAD -- apps/api/prisma/schema.prisma apps/api/prisma/migrations
```

Count exactly 21 migration directories containing `migration.sql`. Confirm no mobile, maps/provider, matching, batching, consent, demo-reset, user-management, driver-verification, package-version, security-policy, or workflow diff unless a package script was explicitly added in Task 5.

- [ ] **Step 2: Run complete local automated verification**

Run fresh commands:

```powershell
npm ci
$env:DATABASE_URL=('mysql://' + ('{0}:{1}' -f 'placeholder', 'placeholder') + '@127.0.0.1:3306/darb_card6_generate'); npm run prisma:generate
npm test
npm run test:admin
npm run typecheck
npm run build
npm run test:integration:mysql
flutter test --no-pub
flutter analyze --no-pub
flutter build apk --release --no-pub
```

Run Flutter commands from `apps/mobile`. Require API >=341, Admin >=111, Mobile >=241 and zero failures.

- [ ] **Step 3: Run security gates**

```powershell
npm audit --audit-level=low
npm run security:audit
npm run security:scan
npm run validate:security
```

Expected: 0 Critical, 0 High, 0 Moderate, 0 Low; policy and secret scans pass.

- [ ] **Step 4: Request independent code review and resolve findings test-first**

Review `origin/production-readiness...HEAD` against the approved specification. Fix every Critical/Important finding with a failing regression test before production changes, then rerun the relevant focused and full suites.

- [ ] **Step 5: Fetch and inspect team drift**

```powershell
git fetch origin --prune
git log --oneline HEAD..origin/production-readiness
git diff --name-status HEAD...origin/production-readiness
```

If production-readiness advanced, integrate only conflict-free changes without rebasing shared history or discarding teammate work. Rerun complete verification after integration.

- [ ] **Step 6: Push normally and update existing draft PR #30**

```powershell
gh pr view 30 --json number,state,isDraft,headRefName,baseRefName,url
git push -u origin admin/route-management
```

The normal push updates existing PR #30. Never run `gh pr create`, force-push, or merge.

- [ ] **Step 7: Verify exact-head hosted CI**

Wait for Admin, Backend/MySQL, Mobile, and Security checks on the final head. Inspect logs and require all four to pass. If a check fails, reproduce and fix test-first, push normally, and repeat exact-head verification.

- [ ] **Step 8: Confirm QA endpoints and hand off**

Start process-local API on 3100 and Admin on 5174 with route management enabled and maps/provider disabled. Verify health, Admin login, `#/routes`, 401/403, fixture directory/detail, and no Console/Network errors. Leave QA fixtures pending and provide the exact cleanup command.

- [ ] **Step 9: Report Card 6 readiness**

Report every field requested by the Card 6 brief. Set `CARD 6 READINESS = READY_FOR_HUMAN_QA` only with fresh evidence for local suites, real disposable-MySQL concurrency, zero audit findings, exact-head hosted CI, clean Git status, 21 unchanged migrations, QA URLs, and no real-data mutation.
