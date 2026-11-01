# Card 6: Admin Route Management design

## Purpose

Card 6 completes and hardens Darb's existing feature-gated Admin route-management implementation. The existing `ServiceRoute`, `ServiceRouteVersion`, `Stop`, and `RouteVersionStop` models and `createRouteManagementService` lifecycle remain authoritative. The Card does not add a parallel Admin facade, a second state machine, a Prisma migration, maps, geocoding, provider integration, or mobile lifecycle changes.

The supported operator flow is:

`Route identity -> draft version -> draft configuration -> ordered stops -> publish -> pause/resume -> retire`

Published versions remain immutable. Changes to published route content require a new draft, optionally cloned through the existing clone contract.

## Feature gates and capability boundaries

`ROUTE_MANAGEMENT_ENABLED` remains the API gate and `VITE_ROUTE_MANAGEMENT_ENABLED` remains the Admin build gate. Disabled Admin builds keep `#/routes` visible but render an honest unavailable/configuration state. Human QA enables route management process-locally only.

`ROUTE_MAPS_ENABLED` remains disabled. Card 6 does not select a provider, add credentials or SDKs, persist provider geometry, geocode coordinates, or claim that manually supplied coordinates are GPS-, provider-, road-, or geocoder-verified. Route preview is a non-blocking unavailable state when maps are disabled.

Canonical `ServiceRoute` records are the management target. Legacy `DriverRoute` records are not rewritten or mixed into canonical edit controls. The public catalog continues using the existing feature-gated published/current route rules.

## Backend contracts

### Directory and detail

`GET /api/v1/admin/service-routes` remains a bounded, deterministic summary query. It supports bounded search and existing status, direction, and service-region filters. Rows contain route identity, current-version summary, stop count, version count, and safe operational timestamps. They do not contain historical version collections or raw geometry/provider data.

`GET /api/v1/admin/service-routes/:id` returns explicit safe projections. Version history is capped at a documented server limit and ordered deterministically by version number and ID. Each returned version has at most the route contract's maximum 100 ordered stop memberships. The response reports the total version count so the UI can state when only the newest history is shown. Encoded geometry, provider internals, actor credentials, integrity/checksum internals, and unrelated nested data are excluded.

### Lifecycle and stale-current fencing

Existing draft edits and stop replacement retain `expected_revision`. Conditional writes and locked reads continue returning `409 draft_revision_conflict` without a stale write.

Lifecycle mutations that rely on the Admin's observed route state carry `expected_current_version_id`:

- Publish already fences the expected current pointer and draft revision.
- Pause and resume require the target version to equal both the supplied expected pointer and the locked route's current pointer.
- Version retirement requires the supplied expected pointer to equal the locked route pointer, whether the target is current or historical. This permits intentional historical retirement after a fresh load while rejecting an operation based on an outdated route snapshot.
- Stable route retirement requires an expected null current pointer and rechecks all version/usage rules while holding the route lock.

The expectation becomes part of each idempotency payload. A pointer mismatch returns `409 current_version_conflict`, performs no lifecycle write, and prompts an authoritative route reload in the Admin client. No schema revision is added.

Publication, pause, resume, retirement, and route retirement continue delegating to `createRouteManagementService`. Existing locks, idempotency claims, audit events, usage checks, and domain validation remain authoritative.

### Stops

The existing Stop list, create, update, and retirement contracts remain authoritative. Admin stop editing exposes only bilingual names, service region, latitude, and longitude; `stop_key` remains immutable. Coordinates are explicitly labeled as manually supplied. Existing coordinate bounds and used-stop immutability rules remain enforced by the backend.

Stop replacement accepts 2–100 unique, contiguous memberships and preserves the draft's optimistic revision. Reordering is a replacement of the full ordered membership set, never a separate ordering engine.

## Admin experience

The existing `#/routes` workspace is completed rather than redesigned.

- Directory: loading, empty, error, search, status/direction/region filters, bounded pagination, stable selected-route behavior, and current-version summaries.
- Detail: separate route, version, and stop statuses; identity metadata; current version; bounded version history; ordered stops; operational timestamps; and honest history truncation.
- Versions: create draft, clone only through the existing contract, edit draft, configure ordered stops, publish, pause, resume, and retire with confirmations and allowed-state controls.
- Stops: bounded catalog, create, edit eligible active unused stops, and confirm retirement. Manual-coordinate language is always visible.
- Readiness: the UI provides a concise advisory checklist for bilingual names, dates, minimum stop count, active/same-region stops, endpoint order, and passenger/parcel compatibility. It does not replace backend validation.
- Conflicts: every `409` suppresses success, shows localized actionable feedback, and reloads authoritative route/version/stop state before further mutation.
- Maps: a localized unavailable state; no map placeholder suggesting live functionality.

Published versions have no edit or stop-reorder affordances. Route, version, and stop badges remain visually and textually distinct.

Arabic remains the default RTL locale and English remains LTR. Route keys, IDs, and coordinates use LTR isolation. At desktop, tablet, and approximately 560 px, forms and tables reflow without horizontal dependency. Ordered-stop movement uses labeled keyboard-accessible up/down buttons and never requires drag-and-drop.

## Error handling and safety

Request bodies remain strict allowlists. Known safe domain failures are mapped to bounded localized guidance; unknown/internal messages are not rendered directly. Irreversible retirement and lifecycle actions require confirmation and a synchronous in-flight guard. Idempotency keys remain stable across uncertain outcomes and rotate only after authoritative settlement.

Admin routes continue using trusted-session authentication and the Admin role guard: unauthenticated requests receive 401, passenger/driver/merchant users receive 403, and Admin users may proceed. Public catalog authorization and feature gating do not change.

## Testing strategy

Implementation follows red-green-refactor cycles.

- Service/API tests cover bounded projections, search/filters, create, draft/clone/edit, stale revision, stop create/edit/retire, used-stop protection, stop replacement/reorder, invalid and stale writes, publication validation, current-pointer fencing, pause/resume/retirement, published immutability, authorization, and public-catalog regression.
- Admin tests exercise directory states, filters, detail/history, draft lifecycle, stop editing, stop ordering, conflict reload, localized validation, publish/pause/resume/retire, distinct statuses, maps-disabled state, RTL/LTR, responsive structure, keyboard controls, and confirmations.
- MySQL integration uses only disposable `darb_routes_qa` and proves real locking/concurrency behavior, including competing publish and stale current-pointer operations.
- Full API, Admin, Mobile, MySQL, build/typecheck, security, migration-count, and deterministic-demo regressions run before delivery.

## Disposable QA environment

Human QA uses only:

- Database: `darb_routes_qa`
- API: `http://localhost:3100`
- Admin: `http://localhost:5174`
- Route management: enabled process-locally
- Maps/providers: disabled

Synthetic fixtures cover active and retired stops; empty, draft, current published, paused, and retired versions; passenger- and parcel-compatible memberships; invalid publication; and multi-version history. Fixture creation and cleanup target only the disposable database. The real `darb` database is never migrated, reset, seeded, or mutated.

## Explicit non-goals

- No Prisma schema change or Migration 22
- No production feature-flag enablement
- No map, GPS, geocoder, canonical-place, provider, geometry, or realtime work
- No legacy `DriverRoute` lifecycle rewrite
- No passenger, merchant, or driver mobile route UX redesign
- No matching, batching, payment, consent, user-management, driver-verification, or demo-reset changes
- No Card 7 work
