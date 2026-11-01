# Card 7 — Matching & Batching Monitoring: approved production-only design

Status: approved scope incorporated; implementation not started. This document supersedes the earlier design that proposed canonical monitoring in non-production environments. No canonical directory, fallback, aggregate, or detail endpoint is part of Card 7.

Base audited and fetched: `798b1087865e38b7ed5d1b25f686c853708fdd0d` (production-readiness). Card 6 / PR #30 is MERGED at that commit, 2026-09-10T17:43:55Z. Planning branch: `codex/card7-matching-batching-monitoring`.

## 1. Decision and boundaries

Build a dedicated read-only Admin monitoring query layer and Overview, Matching, and Legacy Batches screens. Monitor production-supported legacy runtime records only. Canonical entry, matching and shared-trip functionality is explicitly disabled in staging/production; show a static capability notice explaining that exclusion. The exclusion applies in every environment, even when demo flags are enabled. Never substitute demo/test canonical data for empty production-supported results.

No matching or batching writes, algorithm controls, algorithm changes, Trip lifecycle changes, Maps/GPS dependency, realtime engine work, mobile changes, AI, raw algorithm/debug payloads, snapshots or fingerprints. Card 7 introduces no Prisma/schema changes or migrations; the current production-readiness baseline contains 22 migrations.

Monitoring is not certification that a row originated in production. Existing schema lacks comprehensive test provenance, particularly for merchant orders. Exclude known seeded passenger requests and demo-account participants, and label the scope “Production-supported legacy records; demo accounts and seeded passenger requests excluded.” QA fixtures must remain in disposable databases. Do not assert that `operational_mode=legacy` alone proves provenance. No database inspection or writes are needed for planning.

## 2. Source-of-truth audit

- `apps/api/src/config.ts` restricts canonical enable flags in staging/production. `app.ts` mounts legacy matching/batching independently of canonical routers.
- `modules/matching.ts` selects a compatible fixed-corridor legacy DriverRoute and stores a winning Match with score, method, status and created_at. Input can link a passenger request, a merchant order, or BOTH. No compatible candidate produces an error, not a failed-attempt record. Candidate count is transient. Existing GET /matches[/:id] permits Admin but has broad projections and an unpaginated list.
- `modules/batching.ts` creates ParcelBatch for one merchant order (creator accepts 1–10 parcels), choosing an optional driver-route relationship. It separately updates order status. It does not write Parcel.batch_id. Current eligible order contents are `Parcel.order_id = ParcelBatch.merchant_order_id`; they are not immutable historical membership. No dedicated bounded Admin batch reads exist.
- `modules/trips.ts` accepts/rejects legacy Match. Acceptance creates a Trip, changes related statuses and can assign a batch. Legacy acceptance does not fill Match.accepted_at; rejection does not persist a reason/timestamp. Trip.started_at is written at acceptance and is not reliable departure time. Legacy Trip has no exact Match foreign key. Do not invent a match-to-trip assignment link.
- `services/tripLifecycle.ts` propagates selected statuses to batches/orders. Batch does not have completed or cancelled states. Trip cancellation does not rewrite batch status. Monitoring displays the stored state without repairing it.
- `services/canonicalMatching.ts`, `services/canonicalSharedMatching.ts`, and `lib/canonicalDispatchWorker.ts` implement non-production dispatch/offer/reservation/manifest behavior. The gated in-process worker runs approximately every five seconds; architecture documentation claiming no scheduler is stale. Card 7 neither queries these entities nor invokes their services.
- `modules/admin.ts` offers broad operational lists and basic dashboard totals, not this monitoring contract. `modules/adminTrips.ts` demonstrates bounded Admin projections and repeatable-read reads; its lifecycle controls are not reused.
- Admin `navigation.ts` currently makes matchingBatching demo-backed. `App.tsx` renders MatchingWorkspace, BatchingWorkspace and ComparisonPanel with action controls. Replace this module entry with the read-only screen, regardless of demo flag; do not reuse these controls or move them to a new normal-production entry.

Persisted models reused: Match, ParcelBatch, PassengerRequest, MerchantOrder, Parcel, DriverRoute, DriverProfile and User. Trip lifecycle is contextual evidence only; no Trip queries needed. CanonicalDemandDispatch, CanonicalDemandAttempt, CanonicalTripManifest, manifest members, CapacityReservation, ComparisonRun, DemoScenario and LocationEvent are excluded from monitoring reads.

REAL runtime-backed data: eligible legacy winning matches, stored score/status/creation time, current passenger request and merchant order status, legacy batch state, selected driver route, current order parcel counts/statuses.

DEMO data: demo-account records, seeded passenger requests, comparison/simulated-distance results, canonical demos. Excluded.

TEST data: canonical/legacy fixtures in tests and disposable QA databases. Never deployed as fallback data. Production data cannot be fully provenance-certified with the current schema.

UNAVAILABLE data: complete failed matching attempts, exhaustive rejection/no-candidate reasons, historical membership snapshot, exact legacy acceptance/rejection time, matching latency, global matching success rate, completed-batch event/count, trustworthy distance savings, canonical production activity.

## 3. Eligibility policy, applied before pagination and aggregation

Use typed Prisma WhereInput predicates shared by list, detail, count and member reads. Never fetch broad records and filter them in JavaScript.

- Eligible passenger request: operational_mode=legacy, canonical_entry_version=null, route_version_id=null, source=manual, passenger.demo_account=false. A missing/unknown source is excluded.
- Eligible merchant order: operational_mode=legacy, canonical_entry_version=null, route_version_id=null, merchant.demo_account=false; all current parcels must have operational_mode=legacy, canonical_entry_version=null and route_version_id=null. Zero-parcel orders remain eligible.
- Eligible driver route: operational_mode=legacy, canonical_availability_version=null, route_version_id=null, driver.user.demo_account=false. Do not require current active/verified status: historical results must remain monitorable after driver availability changes.
- Eligible parcel batch: eligible merchant order and either null driver_route_id or an eligible driver route. Null route is honest “No selected route.”
- Eligible Match: operational_mode=legacy, canonical_match_version=null, route_version_id=null, manifest_id=null, dispatch_id=null, reservation_id=null; eligible driver route; at least one demand link; each non-null passenger/order link must be eligible, and any non-null batch link must be eligible. BOTH demand links survive projection. Do not treat one valid link as permission to leak another excluded link.
- Batch parcel reads reauthorize eligibility of the parent batch, then read only that order's eligible parcels. Do not query by Parcel.batch_id. Excluded or missing detail/member parents return the same 404.

Known non-production markers fail closed. Auth uses requireAuth and requireRole(admin) at router level, including all details/members. Auth session last_used_at may update through existing middleware; Card 7 performs no domain writes. Never invoke matching, expiry, batching or trip-transition services on GET.

## 4. Exact HTTP contract

All six endpoints are GET, rooted at `/api/v1/admin/matching-batching`:

| Endpoint | Query | Response |
| --- | --- | --- |
| `/overview` | from, until | Observed<Overview> |
| `/matches` | page, limit, from, until, status, demand_kind, search | Page<MatchRow> |
| `/matches/:id` | none | Observed<MatchRow> |
| `/batches` | page, limit, from, until, status, search | Page<BatchRow> |
| `/batches/:id` | none | Observed<BatchRow> |
| `/batches/:id/parcels` | page, limit | CurrentOrderParcelsPage |

Unknown query keys, arrays, fractional or out-of-range numbers, unknown statuses/kinds, malformed dates and overlong search/IDs return 400. page defaults 1, allowed 1–1000; limit defaults 25, allowed 1–50; reject 51 rather than clamp. ID/search trimmed nonempty strings, max 191, exact equality only; no free-text, PII or wildcard search. Search on matches is an OR across id, driver_route_id, passenger_request_id, merchant_order_id, parcel_batch_id; batches search id, merchant_order_id, driver_route_id. Empty search is normalized to absent. demand_kind enum passenger_only, merchant_only, combined. Status is one stored entity-specific enum value.

from/until must be supplied together as UTC ISO datetimes ending Z. Default is [request-parse server time minus 7 days, request-parse server time); require from < until and range <=31 days, until <= request-parse server time. Date filters apply to the parent row's created_at, never acceptance or completion time. Normalized range is echoed. Explicit ID detail has no date restriction but always eligibility/auth restrictions.

The browser omits both date parameters for default initial loads and default-range manual refresh, using server time rather than its own clock. Paging echoes the returned range. Manual refresh resets page 1; an explicit user-selected range remains explicit and validation errors do not silently change it. Request range normalization occurs at request parsing, before the read-start observation timestamp.

Offset pagination follows existing Admin patterns. Matches/batches order created_at DESC, id DESC. Parcels have no created_at and order id ASC. Skip=(page-1)*limit, take=limit. Page returns exact total and has_more=(page*limit<total); if page cap prevents further browsing, UI asks to narrow filters instead of offering page 1001. No arrays in details grow with data: member rows require their own paginated endpoint.

`Observed<T> = { observed_at: UTCISOString, scope: 'production_supported_legacy', data: T }`.
`Page<T> = Observed<{ items:T[], page:number, limit:number, total:number, has_more:boolean, range:{from:UTCISOString,until:UTCISOString}|null }>`; range is null only for parcels. Observation time is server read-start, not row updated_at.

Each response's queries use one short read-only RepeatableRead transaction, including eligibility checks, page/count and aggregate queries. Database failures return the existing sanitized error envelope (503 for recognized timeout/unavailability), never zero metrics. Set transaction maxWait=2000ms and timeout=5000ms; measure actual query cost on MySQL because transaction timeout alone does not prove server query cancellation. No domain writes, no per-row N+1 reads. SQL aggregates bound response size but not scan cost: failure to meet measured query budget blocks implementation readiness for release, not permission to add a migration.

## 5. Exact metrics and definitions

Overview has `range:{from,until}`, `pending_passenger_requests`, `submitted_merchant_orders`, `match_results_by_status`, `batches_by_status`, `active_batches`, `capabilities`.

| Field / displayed label | Definition |
| --- | --- |
| Pending passenger requests | Count eligible PassengerRequest rows with stored status pending, across all creation times. Requests, not passengers, and not a proven unmatched queue. |
| Submitted merchant orders | Count eligible MerchantOrder rows with stored status submitted, across all creation times. Orders, not parcels; not added to passenger count. |
| Match results by current status | Count eligible Match rows created in [from,until), grouped by current stored MatchStatus. Complete zero-filled enum map. Combined matches count once. |
| Accepted match results | The accepted entry in that same creation-cohort status map; not acceptance events during the range, not completed trips, and not a global success rate. |
| Rejected match results | The rejected entry in that map; not all failed or unmatched requests. |
| Batches by current status | Count all eligible ParcelBatch rows, all creation times, grouped by stored ParcelBatchStatus. Complete zero-filled enum map. |
| Active legacy batches | Sum created + assigned + picked_up + in_transit from batches_by_status. The proposed enum value is excluded without production-writer evidence; it can include stalled batches and batches associated with cancelled trips. |
| Delivered legacy batches | The delivered entry in batches_by_status. Never label completed. |
| Stored score (row/detail) | Decimal Match.score serialized losslessly as a decimal string, label Score. No percentage confidence, averages, or fabricated calibration. |
| Current order parcel count (row/detail) | Count eligible Parcel rows of the batch/order's merchant_order_id; current contents, not a snapshot. |
| Requested passenger count (match detail) | PassengerRequest.passenger_count at observation, not historical occupied seats. |

`capabilities={ canonical_monitoring:'unavailable', failed_attempt_history:'not_recorded', completed_batches:'not_supported' }` is static Card 7 capability metadata. The UI explains canonical functionality is disabled in staging/production and excluded here in all environments. No counts or queries against canonical data, no score confidence, no expiry inferred by clock, no request/order totals mixed together, no global success rate, no exhaustive reasons or elapsed-processing-duration claims. Pending-age can be derived in future but is not in v1.

## 6. Exact safe projections

These are complete response allowlists; no model spreading. Prisma select only required scalar fields and bounded singular relations; use filtered count aggregates for parcels. Internal predicate fields may be used in SQL without selecting/returning them.

- MatchRow: id, status, created_at, score:string, method:'darb_route_score'|'unrecognized', demand_kind:'passenger_only'|'merchant_only'|'combined', driver_route:{id,status}, passenger_request:null|{id,status,passenger_count}, merchant_order:null|{id,status,parcel_count}, parcel_batch:null|{id,status}.
- BatchRow: id, status, created_at, merchant_order:{id,status,parcel_count}, selected_driver_route:null|{id,status}.
- ParcelRow: id, status. Do not return size/priority free text or destination data. Parent order is already identified by the selected BatchRow.
- Overview: only fields in section 5 and its explicit range. Status maps contain numeric counts for every current enum member, including zeros.

Use existing generated entity status unions on API and matching string unions on Admin. MatchStatus: proposed, sent_to_driver, accepted, rejected, expired, invalidated. ParcelBatchStatus: created, proposed, assigned, picked_up, in_transit, delivered. Demand and driver-route status remain their own enums. Render any future unrecognized status neutrally as Unknown; never reinterpret as completion. method maps unknown values to unrecognized rather than exposing arbitrary stored text. No score_version field is needed because legacy writer does not version it.

Exclude user/profile IDs, names, emails, phones, addresses/labels, coordinates, geometry, trust scores, auth/session data, secrets, arbitrary explanations, scoring_breakdown, estimated_distance_saved, route snapshots, hashes/fingerprints/checksums, reservation/dispatch/manifest identifiers and internal failure payloads. Operational row/route/request/order IDs remain pseudonymous and Admin-only. No direct match-to-trip link: legacy storage cannot prove that mapping. No batch passenger/driver totals inferred through trips; a selected route is not an accepted driver assignment.

## 7. States and UX

Legacy matching writer: no candidate -> error with no stored attempt; candidate -> proposed; legacy accept -> accepted; legacy reject -> rejected. Other persisted enum values are displayed as recorded, not synthesized or presented as a complete attempt history.

Legacy batch writer starts created, acceptance can set assigned, and Trip transitions can set picked_up -> in_transit -> delivered. proposed exists as an enum, not proof the current creator emits it. Batch status is independent of MerchantOrder and Trip status. Show stored parent order status separately without resolving mismatches.

Canonical dispatch/manifest state machines are audit context only: dispatch pending/offered/assigned/unavailable; offers can reject/expire; shared manifest building/offered/accepted/rejected/expired/dissolved. Accepted is not completed. They have no UI directories or DTOs in Card 7.

Overview: two separate demand cards, match creation-cohort status counts, current legacy batch status counts, active/delivered labels, scope/capability notice, unavailable explanations. Clearly separate all-time current-state cards from date-filtered result cards.

Matching: title “Matching results,” not “All attempts.” Server filters date, current status, demand kind and exact operational ID search; paginated table id, created, demand kind, stored status, score, selected route ID. Combined demand shows both links. Drawer reads explicit detail on open/refresh and shows both bounded demand summaries. No run, accept, reject, retry or tune buttons.

Legacy Batches: date/status/exact-ID filters, paginated table id, created, stored batch status, order ID, current parcel count, selected route ID. Drawer displays order status separately and a separately paginated “Current eligible order contents” parcel list. No timeline, savings or completed label, no batch/create/assign controls.

Use existing UI components, English/Arabic translations, RTL, responsive tables, accessible field labels, keyboard navigation, drawer focus entry/trap/return, and empty/loading/error states. Maintain hash #/matching-batching and existing aliases. Replace demo action entry rather than adding fallback paths.

## 8. Concurrency, privacy and verification

Manual refresh only. Display last successful observed_at; label retained data stale during refresh failure without advancing its timestamp. Filter/page changes and drawer selection create a new request generation; ignore responses from prior generations, including session/token changes and unmounts. A 401/403 clears data via existing session handling; 404 closes/clears the affected detail without rendering previously selected data.

Each response is consistent within its transaction; separate calls are independent observations, not one dashboard-wide snapshot. Offset pages can shift when records change; disclose that refresh observes current state and reset page 1 on filter changes. No polling, WebSocket, SSE, background expiry, write locks or synthetic revision. Detail observed_at is independent from overview/table timestamps.

Privacy/security tests assert exact key allowlists and no sensitive marker leakage in every response; all roles, revoked/expired sessions, guessed excluded IDs and nested member access are tested. Known demo/canonical/seed records must not affect lists, counts or totals. Read-only tests reject any domain create/update/delete/executeRaw mutation. Auth session touch is the documented exception.

Disposable MySQL integration verifies real predicate joins, counts, pagination, enum handling, parent/member eligibility and concurrent observations. Database guard rejects real darb and anything outside an explicitly allowed *_ci database before connection. No real database data is required. Measure queries with representative disposable volume; avoid N+1 and record timing/query plans. No schema/index changes allowed as a shortcut.

## 9. Implementation boundaries and approval

Plan: `docs/superpowers/plans/2026-09-10-card-7-matching-batching-monitoring.md`. Backend adds policy/contracts/query service/router; Admin adds monitoring module and typed API methods; tests cover pure contracts, HTTP, UI and disposable MySQL. Integration harness includes the new smoke in existing Backend CI. Existing algorithms and mobile stay unchanged.

Self-review: every metric has a stored-data definition; all six endpoints use the same exclusion and Admin boundaries; all details have bounded scalar/singular projections; current parcels use order_id; no Trip or canonical fallback; combined Match demands remain distinct; no accepted/completed conflation; timestamp semantics are explicit; no schema/migration dependency. Implementation may start only after the user asks to execute the internally reviewed plan. This planning phase creates documentation only.

## Execution amendment — 2026-09-11
Implementation is now authorized. Active batches excludes proposed. Parcel responses use CurrentOrderParcelsPage: Page<ParcelRow> whose data additionally has contents_semantics='current_eligible_order_contents' and merchant_order_id:string. This identifies current eligible order contents, not guaranteed historical batch membership; assert metadata in API/integration tests and matching Admin copy. Offset pagination remains the approved contract; cursor is unsupported and strictly rejected as an unknown query key, including malformed cursors. Stable sorting remains created_at DESC/id DESC or parcel id ASC.
