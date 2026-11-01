# Card 6 Route Management UX Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the existing Card 6 Admin route-management page into a directory-first, focused workspace with accessible dialogs, contextual actions and errors, and usable desktop/mobile layouts while preserving every existing backend contract.

**Architecture:** Keep `RouteManagement` as the data/mutation controller and move presentational responsibilities into focused route feature components. A small reducer owns navigation, tabs, dialogs, edit modes, and action-scoped feedback; existing API calls, lifecycle helpers, idempotency behavior, optimistic revision fencing, and authoritative conflict reloads remain the only domain behavior. All new UX behavior is driven by component props and tested through real rendered markup plus reducer/helper tests without adding a routing system or backend facade.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest 4, server-rendered component tests, existing Darb Admin UI primitives and CSS tokens.

**Spec:** `docs/superpowers/specs/2026-08-25-card-6-route-management-design.md`

## Global Constraints

- Work only on existing branch `admin/route-management` and existing draft PR `#30`; do not create another branch or PR and do not merge.
- Preserve `#/routes` as the canonical Admin route and keep selected route/version as feature-local UI state.
- Backend route lifecycle, current-version fencing, draft `expected_revision`, idempotency, authorization, audit, and validation semantics remain authoritative and unchanged.
- `ServiceRoute`, `ServiceRouteVersion`, `Stop`, and `RouteVersionStop` remain the existing data model; Prisma schema is unchanged, Migration 22 does not exist, and total migrations remain 21.
- `ROUTE_MANAGEMENT_ENABLED` and `VITE_ROUTE_MANAGEMENT_ENABLED` remain unchanged and are enabled process-locally only for QA.
- Maps, providers, GPS, geocoding, geometry persistence, realtime, legacy `DriverRoute`, mobile lifecycle, matching, batching, payments, Card 7, and the real `masari` database are out of scope.
- Maps remain a small honest unavailable capability; no map library, provider credential, picker, or verified-location claim may be added.
- Full Arabic/English coverage is required; Arabic defaults to RTL, English to LTR, and route keys, IDs, coordinates, and technical values remain LTR-isolated.
- Every stale mutation shows localized contextual feedback, suppresses success, reloads authoritative data, and preserves the selected route and logical tab when reload succeeds.
- Dialogs must be labeled, keyboard accessible, Escape-closeable when idle, focus-managed, scrollable on narrow screens, and free of horizontal overflow.
- Stop ordering must use labeled keyboard-accessible Move up/Move down controls and never require drag-and-drop.
- No raw enum, API-internal message, secret, provider detail, credential, geometry payload, or unsafe content projection may be rendered.
- Every implementation change follows a witnessed RED → GREEN → REFACTOR cycle and each task ends with focused tests and a reviewable commit.

## File Structure

### Existing files modified

- `apps/admin/src/features/routes/RouteManagement.tsx` — controller for API loading/mutations and top-level directory/workspace selection; no longer owns detailed markup for every workflow.
- `apps/admin/src/features/routes/RouteManagement.test.tsx` — controller/helper regression tests, authoritative reload tests, localization, security boundaries, and integration-level markup assertions.
- `apps/admin/src/features/routes/StopEditor.tsx` — converted into the focused stop-edit dialog body while retaining the existing update contract.
- `apps/admin/src/features/routes/StopEditor.test.tsx` — editable/immutable stop and manual-coordinate dialog coverage.
- `apps/admin/src/i18n/translations.ts` — complete Arabic/English labels, descriptions, validation, actions, confirmation, conflict, and empty-state copy.
- `apps/admin/src/styles.css` — route-page responsive structure and removal of the current dense landing-page overrides.
- `apps/admin/src/ui/components.css` — reusable route feature visual structure: directory, workspace, tabs, dialogs, action menu, lists, status groups, and compact readiness.
- `docs/qa/card-6-route-management.md` — new human-QA flow matching the refactored directory/workspace UX and corrected post-mutation fixture verification guidance.

### New focused route feature files

- `apps/admin/src/features/routes/routeManagementModel.ts` — feature-local reducer, tab/dialog/error types, selected-version reconciliation, and status/readiness helpers; no API calls.
- `apps/admin/src/features/routes/routeManagementModel.test.ts` — navigation, dialog, edit mode, conflict preservation, action-menu, and readiness model tests.
- `apps/admin/src/features/routes/RouteDialog.tsx` — accessible feature-local dialog shell with focus restoration, Escape handling, backdrop handling, and scrollable content.
- `apps/admin/src/features/routes/RouteDialog.test.tsx` — dialog labeling, modal semantics, close controls, busy behavior, and directionality.
- `apps/admin/src/features/routes/RouteDirectory.tsx` — header, compact filters, bounded route directory, responsive cards/rows, Open action, and compact pagination.
- `apps/admin/src/features/routes/RouteDirectory.test.tsx` — directory content hierarchy, filters, statuses, pagination, mobile hooks, and absence of permanently visible forms.
- `apps/admin/src/features/routes/CreateRouteDialog.tsx` — required route-identity fields, inline validation/error, submit/cancel behavior.
- `apps/admin/src/features/routes/CreateRouteDialog.test.tsx` — closed/open rendering, four-field form, validation/error placement, and technical-value directionality.
- `apps/admin/src/features/routes/RouteWorkspace.tsx` — workspace header/back action, distinct status summary, tabs, and delegated active-tab content.
- `apps/admin/src/features/routes/RouteWorkspace.test.tsx` — selected identity, status hierarchy, tabs, back behavior, and active panel semantics.
- `apps/admin/src/features/routes/RouteOverview.tsx` — identity summary, current-version summary, concise readiness, lifecycle action menu, and small maps status.
- `apps/admin/src/features/routes/PublishReadiness.tsx` — advisory checklist derived from existing `publicationReadiness`; it never duplicates server validation.
- `apps/admin/src/features/routes/RouteActionMenu.tsx` — one keyboard-usable contextual lifecycle menu and confirmation flow.
- `apps/admin/src/features/routes/RouteOverview.test.tsx` — overview sections, readiness valid/invalid states, secondary maps treatment, state-specific actions, reason/confirmation UI.
- `apps/admin/src/features/routes/RouteVersions.tsx` — bounded history list and selected-version workspace.
- `apps/admin/src/features/routes/RouteVersionEditor.tsx` — explicit view/edit modes for draft fields and read-only rendering for immutable versions.
- `apps/admin/src/features/routes/RouteVersions.test.tsx` — history selection/current marker, draft edit/save/cancel, immutable versions, dates, local errors, and LTR IDs.
- `apps/admin/src/features/routes/RouteStops.tsx` — ordered membership list, capability labels, add-existing/create/edit dialogs, remove and move controls.
- `apps/admin/src/features/routes/RouteStops.test.tsx` — ordered rows, capability labels, dialogs, create/edit/add/remove/reorder, keyboard names, immutable behavior, and narrow structure.

## Task 1: Feature UI State and Accessible Dialog Foundation

**Files:**
- Create: `apps/admin/src/features/routes/routeManagementModel.ts`
- Create: `apps/admin/src/features/routes/routeManagementModel.test.ts`
- Create: `apps/admin/src/features/routes/RouteDialog.tsx`
- Create: `apps/admin/src/features/routes/RouteDialog.test.tsx`
- Modify: `apps/admin/src/i18n/translations.ts`
- Modify: `apps/admin/src/ui/components.css`

**Interfaces:**
- Produces `RouteWorkspaceTab = "overview" | "versions" | "stops"`.
- Produces `RouteDialogName = "create-route" | "create-version" | "add-stop" | "create-stop" | "edit-stop" | "lifecycle" | null`.
- Produces `RouteFeedbackScope = "page" | "create-route" | "version-editor" | "stops" | "stop-editor" | "lifecycle"`.
- Produces `RouteUiState`, `initialRouteUiState`, and `routeUiReducer(state, action)` for directory/workspace, selected version, edit mode, dialog, and scoped feedback.
- Produces `RouteDialog` props `{ open, title, description?, busy?, onClose, children, footer? }`.
- Consumes no API and performs no lifecycle decisions.

- [ ] **Step 1: Write failing reducer tests**

Add literal tests proving that opening a route enters the overview tab; tab/version selection stays local; opening and closing each dialog does not change the selected route; draft edit cancel exits edit mode; and a conflict feedback action preserves workspace/tab/version while assigning the correct scope.

```ts
it("preserves the logical workspace when a stale mutation is reloaded", () => {
  const state = {
    ...initialRouteUiState,
    surface: "workspace" as const,
    selectedRouteId: "route-1",
    selectedVersionId: "version-2",
    tab: "stops" as const
  };
  const next = routeUiReducer(state, {
    type: "feedback",
    scope: "stops",
    kind: "error",
    text: "Another session changed this draft"
  });
  expect(next).toMatchObject({
    surface: "workspace",
    selectedRouteId: "route-1",
    selectedVersionId: "version-2",
    tab: "stops",
    feedback: { scope: "stops", kind: "error" }
  });
});
```

- [ ] **Step 2: Run the model test and witness RED**

Run: `npm run test:admin -- --run src/features/routes/routeManagementModel.test.ts`

Expected: FAIL because the model module and reducer do not exist.

- [ ] **Step 3: Implement the minimal reducer**

Use a discriminated union with explicit actions: `open-route`, `back-to-directory`, `select-tab`, `select-version`, `open-dialog`, `close-dialog`, `begin-version-edit`, `cancel-version-edit`, `feedback`, and `clear-feedback`. The reducer must never perform API work or derive lifecycle permissions.

- [ ] **Step 4: Run the model tests and witness GREEN**

Run: `npm run test:admin -- --run src/features/routes/routeManagementModel.test.ts`

Expected: the new model test file passes.

- [ ] **Step 5: Write failing dialog tests**

Render `RouteDialog` open and closed. Assert the open variant has `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, a visible close button with localized label, and the supplied `dir`; assert closed markup is empty and busy markup disables close affordances.

- [ ] **Step 6: Run the dialog test and witness RED**

Run: `npm run test:admin -- --run src/features/routes/RouteDialog.test.tsx`

Expected: FAIL because `RouteDialog` does not exist.

- [ ] **Step 7: Implement the dialog shell and route UI copy**

Implement a portal-free feature dialog so server-rendered tests remain real. On open, save `document.activeElement`, focus the first autofocus/interactive element, listen for Escape, and restore focus on close/unmount. Backdrop clicks close only when `event.target === event.currentTarget`; busy state suppresses Escape, backdrop, and close-button dismissal. Add Arabic/English labels for close, cancel, tabs, action menu, create/edit flows, conflict scopes, readiness labels, and empty states.

- [ ] **Step 8: Add dialog/mobile CSS and witness GREEN**

Add `.route-dialog-backdrop`, `.route-dialog`, `.route-dialog__header`, `.route-dialog__body`, and `.route-dialog__footer`; cap block size with `max-block-size: min(90dvh, 760px)`, make the body scroll, preserve visible focus, and use one-column form layout at 560px.

Run: `npm run test:admin -- --run src/features/routes/routeManagementModel.test.ts src/features/routes/RouteDialog.test.tsx`

Expected: both files pass.

- [ ] **Step 9: Commit Task 1**

```powershell
git add apps/admin/src/features/routes/routeManagementModel.ts apps/admin/src/features/routes/routeManagementModel.test.ts apps/admin/src/features/routes/RouteDialog.tsx apps/admin/src/features/routes/RouteDialog.test.tsx apps/admin/src/i18n/translations.ts apps/admin/src/ui/components.css
git commit -m "refactor(admin): add route workspace UI foundation"
```

## Task 2: Directory-First Landing and Create Route Flow

**Files:**
- Create: `apps/admin/src/features/routes/RouteDirectory.tsx`
- Create: `apps/admin/src/features/routes/RouteDirectory.test.tsx`
- Create: `apps/admin/src/features/routes/CreateRouteDialog.tsx`
- Create: `apps/admin/src/features/routes/CreateRouteDialog.test.tsx`
- Modify: `apps/admin/src/features/routes/RouteManagement.tsx`
- Modify: `apps/admin/src/features/routes/RouteManagement.test.tsx`
- Modify: `apps/admin/src/styles.css`
- Modify: `apps/admin/src/ui/components.css`

**Interfaces:**
- Consumes `RouteUiState`, `routeUiReducer`, and `RouteDialog` from Task 1.
- Produces `RouteDirectory` callbacks `onSearch`, `onPage`, `onOpenRoute`, and `onCreateRoute`.
- Produces `CreateRouteDialog` callbacks `onSubmit(draft)` and `onClose` with `error` and `busy` props.
- `RouteManagement` retains `loadCatalog`, `loadRoute`, stable mutation keys, and `api.createServiceRoute`.

- [ ] **Step 1: Write failing directory tests**

Render a populated directory with hand-built complete `ServiceRoute` fixtures. Assert the header contains title, short description, and one primary Create route button; filters are compact and labeled; each row/card exposes localized name, LTR route key, region, direction, route status, current-version status, stop count, and one Open action; pagination has previous/next labels. Assert no route/version/stop form fields or lifecycle action controls occur in directory markup.

- [ ] **Step 2: Run the directory test and witness RED**

Run: `npm run test:admin -- --run src/features/routes/RouteDirectory.test.tsx`

Expected: FAIL because the directory component does not exist.

- [ ] **Step 3: Implement `RouteDirectory` and responsive styles**

Use semantic header/form/list markup. Desktop rows use a compact grid; `@media (max-width: 560px)` changes each result to a card with labeled metadata and a full-width Open action. Keep filters wrapping without horizontal scrolling and retain the fixed backend page size of 25 through the controller query helper.

- [ ] **Step 4: Write failing create-dialog tests**

Assert the closed dialog renders no form; the open dialog renders only `route_key`, `route_group_key`, `service_region_key`, and `direction`; required inputs are labeled; route/group/region inputs are LTR; inline validation and server error appear within the dialog; no version, stop, lifecycle, map, or reason controls are present.

- [ ] **Step 5: Run the create-dialog test and witness RED**

Run: `npm run test:admin -- --run src/features/routes/CreateRouteDialog.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 6: Implement the create dialog and controller success flow**

Validate non-empty trimmed route key, group key, and region before calling `onSubmit`. In `RouteManagement.submitRoute`, keep the existing API payload/idempotency semantics. On success: clear create feedback, close the dialog, refresh page 1, load the created route, dispatch `open-route`, and show workspace-local success. On failure: leave the dialog open and assign `create-route` feedback; no page-wide banner.

- [ ] **Step 7: Replace the landing markup and update integration tests**

Update `RouteManagement.test.tsx` so initial SSR asserts the create form is absent, Create route is present, map status does not dominate the landing header, Arabic/English directory copy exists, and all filters still produce the existing bounded query. Preserve all helper and security-boundary tests.

- [ ] **Step 8: Run focused tests and witness GREEN**

Run: `npm run test:admin -- --run src/features/routes/RouteDirectory.test.tsx src/features/routes/CreateRouteDialog.test.tsx src/features/routes/RouteManagement.test.tsx`

Expected: all focused tests pass.

- [ ] **Step 9: Commit Task 2**

```powershell
git add apps/admin/src/features/routes/RouteDirectory.tsx apps/admin/src/features/routes/RouteDirectory.test.tsx apps/admin/src/features/routes/CreateRouteDialog.tsx apps/admin/src/features/routes/CreateRouteDialog.test.tsx apps/admin/src/features/routes/RouteManagement.tsx apps/admin/src/features/routes/RouteManagement.test.tsx apps/admin/src/styles.css apps/admin/src/ui/components.css
git commit -m "refactor(admin): make routes a directory-first workflow"
```

## Task 3: Route Workspace, Overview, Readiness, and Contextual Lifecycle Menu

**Files:**
- Create: `apps/admin/src/features/routes/RouteWorkspace.tsx`
- Create: `apps/admin/src/features/routes/RouteWorkspace.test.tsx`
- Create: `apps/admin/src/features/routes/RouteOverview.tsx`
- Create: `apps/admin/src/features/routes/RouteOverview.test.tsx`
- Create: `apps/admin/src/features/routes/PublishReadiness.tsx`
- Create: `apps/admin/src/features/routes/RouteActionMenu.tsx`
- Modify: `apps/admin/src/features/routes/RouteManagement.tsx`
- Modify: `apps/admin/src/features/routes/routeManagementModel.ts`
- Modify: `apps/admin/src/features/routes/routeManagementModel.test.ts`
- Modify: `apps/admin/src/ui/components.css`

**Interfaces:**
- Consumes selected route/version, reducer state, `publicationReadiness`, `lifecycleActions`, and existing mutation callbacks.
- Produces one `RouteWorkspace` tablist with `overview`, `versions`, and `stops`; there is no activity tab.
- Produces `RouteActionMenu` callbacks `onClone`, `onPublish`, `onPause`, `onResume`, `onRetireVersion`, and `onRetireRoute` without changing lifecycle eligibility.
- Produces `PublishReadiness` props `{ issues, locale }`; an empty issue list renders all advisory checks as ready while server publication remains authoritative.

- [ ] **Step 1: Write failing workspace tests**

Assert the selected route name and back-to-routes action, separate labeled route/current-version/map statuses, a three-tab `tablist`, and one active `tabpanel`. Verify route keys and IDs are LTR and that changing tab through reducer state changes only the panel, not route selection.

- [ ] **Step 2: Run workspace tests and witness RED**

Run: `npm run test:admin -- --run src/features/routes/RouteWorkspace.test.tsx`

Expected: FAIL because the workspace component does not exist.

- [ ] **Step 3: Implement workspace header and tab shell**

Use a compact back link/button, localized route name fallback to route key, a status summary with four separately labeled concepts, and accessible tab semantics. Keep the map status as one small muted metadata item.

- [ ] **Step 4: Write failing overview/action/readiness tests**

Assert Overview contains Route identity, Current version summary, Publish readiness, Lifecycle, and Map status. Assert readiness shows checked and failed rows with text/symbols rather than color alone. Table-test exact action menus: draft → Publish and Retire; published → Pause, Create new draft/version, Retire; paused → Resume, Create new draft/version, Retire; retired → no mutable action. Assert destructive/lifecycle selection opens a confirmation flow and reason is required only where existing semantics require it.

- [ ] **Step 5: Run overview tests and witness RED**

Run: `npm run test:admin -- --run src/features/routes/RouteOverview.test.tsx src/features/routes/routeManagementModel.test.ts`

Expected: FAIL because overview, readiness, and action-menu components do not exist.

- [ ] **Step 6: Implement overview, readiness checklist, and action menu**

Move the existing advisory `publicationReadiness` output into a compact list. Render publish disabled when issues exist, but keep the existing server publish call unchanged. The action menu is a button plus keyboard-usable menu; Escape closes it, focus returns to trigger, and action selection opens the existing confirmation/reason dialog rather than calling APIs immediately.

- [ ] **Step 7: Wire existing lifecycle mutations without semantic changes**

Keep `versionAction`, `cloneVersion`, and `retireRoute` payloads, idempotency keys, expected current pointer, expected revision, confirmations, and reason rules byte-for-byte equivalent in meaning. Place failures in `lifecycle` feedback and success in the workspace. A 409 reloads `selectedRoute.id` and leaves the reducer tab unchanged.

- [ ] **Step 8: Run focused tests and witness GREEN**

Run: `npm run test:admin -- --run src/features/routes/RouteWorkspace.test.tsx src/features/routes/RouteOverview.test.tsx src/features/routes/routeManagementModel.test.ts src/features/routes/RouteManagement.test.tsx`

Expected: all focused tests pass.

- [ ] **Step 9: Commit Task 3**

```powershell
git add apps/admin/src/features/routes/RouteWorkspace.tsx apps/admin/src/features/routes/RouteWorkspace.test.tsx apps/admin/src/features/routes/RouteOverview.tsx apps/admin/src/features/routes/RouteOverview.test.tsx apps/admin/src/features/routes/PublishReadiness.tsx apps/admin/src/features/routes/RouteActionMenu.tsx apps/admin/src/features/routes/RouteManagement.tsx apps/admin/src/features/routes/routeManagementModel.ts apps/admin/src/features/routes/routeManagementModel.test.ts apps/admin/src/ui/components.css
git commit -m "refactor(admin): add focused route overview workspace"
```

## Task 4: Bounded Version History and Focused Draft Editing

**Files:**
- Create: `apps/admin/src/features/routes/RouteVersions.tsx`
- Create: `apps/admin/src/features/routes/RouteVersions.test.tsx`
- Create: `apps/admin/src/features/routes/RouteVersionEditor.tsx`
- Modify: `apps/admin/src/features/routes/RouteManagement.tsx`
- Modify: `apps/admin/src/features/routes/routeManagementModel.ts`
- Modify: `apps/admin/src/features/routes/routeManagementModel.test.ts`
- Modify: `apps/admin/src/ui/components.css`

**Interfaces:**
- Consumes the existing bounded `route.versions`, `route.version_count`, and existing create/clone/update callbacks.
- Produces `RouteVersions` callbacks `onSelectVersion`, `onCreateDraft`, `onBeginEdit`, `onSaveDraft`, and `onCancelEdit`.
- `RouteVersionEditor` accepts a concrete selected version and `editing` boolean; immutable statuses never receive editable controls.

- [ ] **Step 1: Write failing version tests**

Render a three-version route fixture. Assert clean rows contain version label/ID, localized status, effective dates, stop count, current indicator, and Open. Assert the bounded-history note appears only when `version_count > versions.length`. Assert selecting a version produces one selected workspace rather than all forms.

- [ ] **Step 2: Add draft/immutable editor tests and witness RED**

Assert a draft initially renders read-only summary plus Edit draft; entering edit mode renders exactly the six existing backend-supported fields; Save changes and Cancel are explicit. Assert published, paused, and retired versions render read-only values with no Edit/Save fields. Assert dates use the existing formatting and IDs remain LTR.

Run: `npm run test:admin -- --run src/features/routes/RouteVersions.test.tsx`

Expected: FAIL because version components do not exist.

- [ ] **Step 3: Implement bounded history and selected-version workspace**

Use `route.versions` exactly as supplied; do not fetch unbounded history and do not invent audit/activity data. Preserve deterministic ordering from the API. The selected row opens a focused summary/editor inside the Versions tab.

- [ ] **Step 4: Implement explicit draft editing**

Reuse the existing draft conversion and payload normalization. Cancel restores the selected authoritative version. Save calls the existing `api.updateRouteVersion` with `expected_revision`; create draft calls the existing create/clone contract. Draft errors render beside the editor. A 409 reloads the route, preserves `tab="versions"`, reconciles the authoritative selected version when still present, exits dirty edit mode, and shows conflict feedback; it never navigates to the directory.

- [ ] **Step 5: Run focused tests and witness GREEN**

Run: `npm run test:admin -- --run src/features/routes/RouteVersions.test.tsx src/features/routes/routeManagementModel.test.ts src/features/routes/RouteManagement.test.tsx`

Expected: all focused tests pass.

- [ ] **Step 6: Commit Task 4**

```powershell
git add apps/admin/src/features/routes/RouteVersions.tsx apps/admin/src/features/routes/RouteVersions.test.tsx apps/admin/src/features/routes/RouteVersionEditor.tsx apps/admin/src/features/routes/RouteManagement.tsx apps/admin/src/features/routes/routeManagementModel.ts apps/admin/src/features/routes/routeManagementModel.test.ts apps/admin/src/ui/components.css
git commit -m "refactor(admin): focus route version editing"
```

## Task 5: Operational Stops List and Focused Stop Dialogs

**Files:**
- Create: `apps/admin/src/features/routes/RouteStops.tsx`
- Create: `apps/admin/src/features/routes/RouteStops.test.tsx`
- Modify: `apps/admin/src/features/routes/StopEditor.tsx`
- Modify: `apps/admin/src/features/routes/StopEditor.test.tsx`
- Modify: `apps/admin/src/features/routes/RouteManagement.tsx`
- Modify: `apps/admin/src/features/routes/routeManagementModel.ts`
- Modify: `apps/admin/src/features/routes/routeManagementModel.test.ts`
- Modify: `apps/admin/src/ui/components.css`
- Modify: `apps/admin/src/styles.css`

**Interfaces:**
- Consumes the selected version memberships, bounded canonical stop catalog, `moveRouteStop`, `toggleRouteStopPermission`, `RouteDialog`, and existing stop APIs.
- Produces distinct dialog modes for add-existing, create-new, and edit-existing stop.
- Produces `onSaveOrder(memberships)` using the existing full replacement API and expected draft revision.
- `StopEditor` retains `onSave(id, draft)` and exposes only names, region, latitude, and longitude; stop key remains read-only.

- [ ] **Step 1: Write failing ordered-stop tests**

Render two memberships with complete embedded stops. Assert sequence, Arabic/English names, stop status, four capability labels, concise Edit/Remove/Move up/Move down controls, accessible reorder names including the sequence, disabled boundary controls, and no draggable attribute or drag instruction. Assert immutable versions have no remove/reorder/capability edit controls.

- [ ] **Step 2: Write failing stop-dialog tests**

Assert Add existing stop opens a compact selector dialog; Create new stop opens a separate focused form; Edit opens a focused stop editor. Create renders only stop key, region, bilingual names, latitude, and longitude. Edit keeps stop key immutable. Coordinates use numeric inputs, `dir="ltr"`, and explicit manually supplied copy; no geocoded/provider/GPS/road-snapped/map claims appear.

- [ ] **Step 3: Run stop tests and witness RED**

Run: `npm run test:admin -- --run src/features/routes/RouteStops.test.tsx src/features/routes/StopEditor.test.tsx`

Expected: FAIL because `RouteStops` and dialog-based stop editing do not exist.

- [ ] **Step 4: Implement ordered list and add/remove/reorder editing**

Keep changes local until Save order. `moveRouteStop` and permission toggles continue producing the full contiguous membership array. Remove re-sequences the remainder. Add-existing excludes already selected stops. Create-new refreshes the catalog and closes only on success. All local failures remain within the active Stops flow or dialog.

- [ ] **Step 5: Convert stop editing to focused dialog UX**

Retain backend edit eligibility (`active && !used`) and existing API field allowlist. Successful edit closes and refreshes stops; failure stays open. Retired/used stops render summary-only rows. If stop retirement remains exposed, place it in the selected stop’s concise actions with the existing confirmation/reason contract, not as a page-wide control.

- [ ] **Step 6: Preserve stale stop-order behavior**

On `draft_revision_conflict`, keep `tab="stops"`, reload the authoritative route, replace local memberships from the authoritative selected version, suppress success, and render localized conflict feedback beside the ordered list.

- [ ] **Step 7: Add narrow-screen stop styles and witness GREEN**

At 560px use one-column stop cards; keep move/remove buttons visible, labeled, and finger-sized; make dialog bodies scroll; prevent two-column RTL compression and horizontal overflow.

Run: `npm run test:admin -- --run src/features/routes/RouteStops.test.tsx src/features/routes/StopEditor.test.tsx src/features/routes/routeManagementModel.test.ts src/features/routes/RouteManagement.test.tsx`

Expected: all focused tests pass.

- [ ] **Step 8: Commit Task 5**

```powershell
git add apps/admin/src/features/routes/RouteStops.tsx apps/admin/src/features/routes/RouteStops.test.tsx apps/admin/src/features/routes/StopEditor.tsx apps/admin/src/features/routes/StopEditor.test.tsx apps/admin/src/features/routes/RouteManagement.tsx apps/admin/src/features/routes/routeManagementModel.ts apps/admin/src/features/routes/routeManagementModel.test.ts apps/admin/src/ui/components.css apps/admin/src/styles.css
git commit -m "refactor(admin): simplify route stop operations"
```

## Task 6: Contextual Feedback, Responsive/Localization Integration, and Admin Regression

**Files:**
- Modify: `apps/admin/src/features/routes/RouteManagement.tsx`
- Modify: `apps/admin/src/features/routes/RouteManagement.test.tsx`
- Modify: `apps/admin/src/features/routes/routeManagementModel.ts`
- Modify: `apps/admin/src/features/routes/routeManagementModel.test.ts`
- Modify: `apps/admin/src/i18n/translations.ts`
- Modify: `apps/admin/src/styles.css`
- Modify: `apps/admin/src/ui/components.css`
- Modify: `docs/qa/card-6-route-management.md`

**Interfaces:**
- Consumes every component and state interface from Tasks 1–5.
- Produces the final controller behavior and refreshed QA runbook; no new API or domain interface.

- [ ] **Step 1: Write failing contextual-error and conflict integration tests**

Add table-driven tests for create, draft save, stop create/edit/order, readiness/publish, and lifecycle failures. Each expected feedback scope is a hand-written literal. Add three explicit 409 tests: draft update, stop order, and current-version lifecycle; each verifies no success state, one authoritative reload request, preserved route ID/tab, reconciled authoritative version, and contextual localized message. Keep existing unknown-error sanitization tests.

- [ ] **Step 2: Run controller/model tests and witness RED**

Run: `npm run test:admin -- --run src/features/routes/RouteManagement.test.tsx src/features/routes/routeManagementModel.test.ts`

Expected: FAIL because the final scoped-feedback and reconciliation cases are not complete.

- [ ] **Step 3: Finish scoped feedback and authoritative reconciliation**

Reserve page-level error for directory/detail load failures only. Route create, version editor, stop dialogs/list, readiness, and lifecycle render their own feedback. Preserve `handleRouteMutationFailure`, safe error mapping, and exactly one authoritative reload per conflict; after reload, keep the route/tab and select the same version if it remains present, otherwise select the authoritative current/newest version.

- [ ] **Step 4: Add Arabic/English and responsive assertions**

Assert every new label exists in both locales, Arabic route workspace renders RTL-ready copy, English renders LTR-ready copy, technical values carry `dir="ltr"`, statuses are textual, tabs are scrollable hooks, directory/stops expose card hooks at 560px, dialog max-height/overflow classes exist through rendered structure, and no horizontal-dependent table is required.

- [ ] **Step 5: Update the human QA runbook**

Replace the old dense-page checklist with: directory/search/filter/open; create dialog; overview/readiness/action menu; version selection/edit/cancel/immutable; add-existing/create/edit stop dialogs; keyboard move controls; localized 409 reload in the same tab; Arabic/English; 560px and desktop; small maps-unavailable state; Console/Network. State that exact 12-scenario fixture verification is performed before mutations and is expected to differ after human mutations until guarded cleanup and re-prepare.

- [ ] **Step 6: Run Admin focused and full suites**

Run:

```powershell
npm run test:admin -- --run src/features/routes
npm run test:admin
npm run typecheck:admin
npm run build:admin
npm run validate:admin
```

Expected: route tests and the full Admin baseline exceed 126 tests; typecheck, build, and Admin validation pass with no warnings/errors attributable to Card 6.

- [ ] **Step 7: Commit Task 6**

```powershell
git add apps/admin/src/features/routes apps/admin/src/i18n/translations.ts apps/admin/src/styles.css apps/admin/src/ui/components.css docs/qa/card-6-route-management.md
git commit -m "test(admin): cover route management workflow"
```

## Task 7: Full Regression, Reviews, Existing PR Update, and Fresh Disposable QA

**Files:**
- Modify only when a validated review finding requires a tested correction in the files named by Tasks 1–6.
- Do not modify API business logic, Prisma, migrations, feature-flag defaults, mobile code, or real-data scripts.

**Interfaces:**
- Consumes the complete refactor and existing repository validation/QA scripts.
- Produces review evidence, exact-head hosted CI evidence, and a fresh `masari_routes_qa` environment on API 3100/Admin 5174.

- [ ] **Step 1: Verify scope and migration invariants**

Run:

```powershell
git diff --name-status 7883333f135bbc6ebab2d09e91259cd71ccbc113..HEAD
git diff --exit-code 7883333f135bbc6ebab2d09e91259cd71ccbc113..HEAD -- apps/api/prisma/schema.prisma apps/api/prisma/migrations
(Get-ChildItem apps/api/prisma/migrations -Directory).Count
```

Expected: only Admin route UX/tests/styles/translations, plan, and QA documentation changed; Prisma/migrations diff is empty; migration count is 21.

- [ ] **Step 2: Run all regression suites**

Run the repository’s exact Node/npm environment commands for:

```powershell
npm test -w @darb/api
npm run test:admin
npm run build:api
npm run build:admin
npm run typecheck
npm run validate:all
npm run test:integration:mysql
Push-Location apps/mobile
flutter test --no-pub
flutter analyze --no-pub
flutter build apk --release --no-pub
Pop-Location
```

Expected: API preserves or exceeds 360 tests; Admin exceeds 126 tests; Mobile preserves or exceeds 241 tests; MySQL and all validation gates pass. Existing Card 3, Card 4, Card 5, Global E.164, Consent Management, Demo Reset Isolation, deterministic demo, and Card 6 backend/service contracts remain green through their existing suites.

- [ ] **Step 3: Run security policy commands**

```powershell
npm audit
npm run security:audit
npm run security:scan
```

Expected: 0 Critical, 0 High, 0 Moderate, and 0 Low vulnerabilities/findings; policy is unchanged.

- [ ] **Step 4: Run CodeRabbit review**

Use the `coderabbit:code-review` skill against the final Card 6 PR diff, focusing on React state complexity, stale-state bugs, accessibility, duplicated lifecycle logic, backend semantic drift, data exposure, and component-split regressions. Resolve each valid finding through a failing focused test, minimal fix, focused test run, and reviewable commit. Re-run CodeRabbit if a meaningful fix changes the reviewed diff.

- [ ] **Step 5: Run Codex Security diff scan**

Use `codex-security:security-diff-scan` against `origin/production-readiness...HEAD`, focusing on authorization regression, XSS/content rendering, route/stop input safety, stale mutation bypass, secret/provider leakage, and CORS/auth regression. Validate candidate findings before changing code; resolve validated issues through TDD. Final result must contain no Critical/High security findings.

- [ ] **Step 6: Push the existing branch and verify hosted CI**

Push `admin/route-management` normally so PR #30 updates; do not create a PR and do not merge. Verify exact-head Admin, Backend/MySQL, Mobile, and Security checks all pass. If a hosted check fails, reproduce it locally and fix only a Card 6 regression with a failing test first.

- [ ] **Step 7: Recreate only the disposable QA database**

Stop the old Card 6 QA processes. Use the guarded Card 6 QA scripts to clean and prepare exactly `masari_routes_qa`, never `masari`; deploy the existing 21 migrations only to the disposable database; source the Admin password process-locally without printing it; run the exact fixture verifier before manual mutation and confirm all 12 categories.

- [ ] **Step 8: Start fresh QA services and perform smoke checks**

Start API with `ROUTE_MANAGEMENT_ENABLED=true`, maps/providers/demo reset disabled, and exact QA database on `http://localhost:3100`. Start Admin with `VITE_ROUTE_MANAGEMENT_ENABLED=true`, demo features disabled, and API base `http://localhost:3100` on `http://localhost:5174`. Verify health, synthetic Admin login, 401, 403, directory, route detail, new directory/workspace UI, Arabic/English, 560px, and Console/Network without exposing credentials.

- [ ] **Step 9: Commit any review-only tested corrections and finish evidence**

Use focused commit messages describing actual corrections. Confirm `git status --short` is empty, PR #30 remains open/draft/unmerged, real `masari` was untouched, and report `MANUAL QA READY = YES` and `CARD 6 READINESS = READY_FOR_HUMAN_QA` only after every local, review, security, hosted-CI, and fresh-QA gate is green.

## Plan Self-Review

### Spec coverage

| Approved requirement | Implemented by |
|---|---|
| Directory-first landing, compact filters/results/pagination | Task 2 |
| Creation isolated in a modal with inline errors and success navigation | Task 2 |
| Dedicated route workspace and Overview/Versions/Stops tabs | Tasks 3–5 |
| Concise Overview identity/current/readiness/lifecycle/maps | Task 3 |
| Bounded version history and focused draft-only editing | Task 4 |
| Ordered stops, separate add/create/edit flows, keyboard movement | Task 5 |
| One state-aware lifecycle menu with confirmations | Task 3 |
| Distinct route/version/stop/map statuses | Tasks 2–5 |
| Contextual errors and authoritative same-workspace 409 reload | Tasks 2–6 |
| Desktop whitespace and approximately 560px single-column behavior | Tasks 2–6 |
| Arabic/English, RTL/LTR, technical-value isolation | Tasks 1–6 |
| Accessible dialogs, menu, tabs, focus, Escape, and non-drag ordering | Tasks 1, 3, 5, 6 |
| Maps/providers remain unavailable and secondary | Tasks 2, 3, 6, 7 |
| Backend/Prisma/lifecycle semantics unchanged | Global Constraints and Task 7 |
| Full Admin/API/Mobile/MySQL/security/CI regression | Task 7 |
| CodeRabbit and Codex Security reviews | Task 7 |
| Fresh disposable QA and invalidation of prior human QA | Tasks 6–7 |

### Placeholder scan

Every task identifies exact files, concrete interfaces, named tests, RED/GREEN commands, expected results, implementation behavior, and commit boundaries. The plan contains no unspecified implementation step or deferred design choice.

### Type and interface consistency

- `RouteUiState` is created in Task 1 and consumed without renaming in Tasks 2–6.
- Dialog names and feedback scopes are fixed in Task 1 and reused consistently by every flow.
- `RouteManagement` remains the sole API/mutation controller throughout the component split.
- `publicationReadiness`, `lifecycleActions`, mutation-key helpers, expected revision/current pointer, and authoritative reload helpers retain their existing contracts.
- The new components receive concrete data/callback props and do not call API clients or implement lifecycle rules independently.

### UX design self-review

The landing page cannot render route/version/stop forms because those components are reachable only from dialog/workspace state. The workspace presents one active tab and one selected version at a time. Local actions own local feedback, while only load failure remains page-wide. Narrow layouts change directories and stops into cards, keep explicit ordering controls, and make dialogs scrollable. Map status is reduced to secondary metadata. No design step requires a backend, schema, migration, provider, map, or router change.
