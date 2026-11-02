# Task 2 report — Directory-First Landing and Create Route Flow

## Delivered

- Added `RouteDirectory` as the `#/routes` landing surface, with semantic header, compact filters, localized route metadata, pagination, and responsive mobile cards.
- Added `CreateRouteDialog`, built on Task 1's `RouteDialog`, with only route identity inputs, LTR technical fields, trimmed required-field validation, and dialog-local error feedback.
- Updated `RouteManagement` to consume `routeUiReducer`, keep route creation in its existing API/mutation controller, open the workspace after a successful create, and scope create errors to the dialog.
- Replaced initial landing assertions so the inline create form, map-status header treatment, and workspace lifecycle controls are absent from SSR directory markup.

## Witnessed TDD

1. RED: `npm run test:admin -- --run src/features/routes/RouteDirectory.test.tsx` failed because `./RouteDirectory` did not exist.
2. GREEN: the same test passed after the minimal directory implementation.
3. RED: `npm run test:admin -- --run src/features/routes/CreateRouteDialog.test.tsx` failed because `./CreateRouteDialog` did not exist.
4. GREEN: the same test passed after the dialog implementation.

## Verification

- Focused route tests: 24/24 passed.
- Full admin tests: 149/149 passed.
- `npm run typecheck:admin` passed.
- Configured local `npm run build:admin` passed with explicit non-demo local environment values.

## Note

An unconfigured admin build correctly failed before verification because `VITE_APP_ENV` and `VITE_API_BASE_URL` are mandatory build configuration, not because of this change.

## Fix round 1 — workspace feedback and responsive rows

- Root cause: successful create feedback was stored in reducer state with `page` scope, but the workspace only rendered the legacy mutation message. The workspace now renders page-scoped reducer feedback.
- Root cause: directory rows had fixed minimum desktop columns inside an overflow-hidden result container until the 560px media query. The directory is now an inline-size container with a 60rem container-query card layout and no fixed desktop minimums.

### Witnessed RED/GREEN

1. RED: the new RouteManagement successful-create integration test created and loaded the route but failed because `Saved successfully.` was absent from the workspace. The RouteDirectory responsive assertion also failed because the container query was absent.
2. GREEN: `npm run test:admin -- --run src/features/routes/RouteManagement.test.tsx src/features/routes/RouteDirectory.test.tsx src/features/routes/CreateRouteDialog.test.tsx` passed 26/26 tests after rendering workspace feedback and replacing the clipped grid.

Final verification: the full admin suite passed 151/151 tests, admin typecheck passed, and the configured local admin build passed.
