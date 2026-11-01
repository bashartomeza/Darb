# PROJECT_MAP.md

[M7D1C_CANONICAL_PLACE_CATALOG_DESIGN_ACTIVE]
- `M7D1C_CANONICAL_PLACE_CATALOG_DESIGN=ACTIVE_DESIGN_ONLY`. No application, Prisma, migration, API, Flutter, Admin functionality, or production provider change has started. `M7D2=NOT_STARTED_BLOCKED`; `M7E=NOT_STARTED_BLOCKED`.

[M7D1B_PROVIDER_LIVE_EVIDENCE_CLOSED]
- `M7D1B_PROVIDER_LIVE_EVIDENCE=FORMALLY_CLOSED`. M7D1B is merged and formally closed on `production-readiness`. Approved feature head `2bac4b1f2eaca8a054f83becb38c57a8299f88b8` is preserved under PR #18 merge commit `8d3e6f1a32f7b409690a91efe8d1b213570550b2`. Independent final review approved the evidence quality with no Critical or High findings. M7D1 remains closed.
- Mapbox, HERE, and Stadia remain `NOT_EXECUTED`. A separately supplied Google Maps Demo Key enabled evidence-only official address Geocoding API v4 execution: 60/60 API responses, but functional public-place acceptance was Arabic 11/30, English 10/30, and overall 21/60, so `GOOGLE_ADDRESS_GEOCODING_QUALITY=FAIL`. The independent Places Text Search run used the same 60 queries and scored Arabic 25/30, English 23/30, overall top-1 48/60 and top-5 52/60; `GOOGLE_PLACES_SEARCH_QUALITY=FAIL`. The key was not persisted or exposed.
- The corrected Google Routes audit used documented coordinate nesting, the minimal polyline/distance/duration field mask, normal stopovers, and a correct Place-ID control. The minimal control, Place-ID control, and all four corrected matrix calls returned HTTP 200 with empty objects and zero routes. No prior request defect is proven; `GOOGLE_ROUTING_EVIDENCE=INSUFFICIENT_EVIDENCE` despite official Palestine driving coverage.
- Independent review found the committed PPU and Bab Al-Zawiya coordinates materially misplaced and invalidated the three affected old route measurements. Corrected public fixtures now use the official PPU Dahiat Al-Baladiyah campus and named Bab Al-Zawiya Square. The digest-pinned Valhalla 3.8.3 rerun passed corrected 4/4 required routes, 12/12 expanded structural routes and selected one-way/turn/pedestrian/barrier controls; warm/process-cold/mixed-20 p95 values were 14.627/66.984/25.110 ms. Real-world access remains conditional and no all-Palestine claim is made.
- A disposable localhost Nominatim 5.3.2 import of the same extract succeeded and passed database checks. Corrected initial strict quality is 5/8; the committed 30-location/60-query representative set is 51/60 overall, Arabic 26/30 and English 25/30. All remain below 95%, so `NOMINATIM_GEOCODING_CANDIDATE=FAIL`.
- The existing provider-neutral harness remains ready and its deterministic fake completed 8/8 geocodes and 2/2 routes. Fake output is architecture evidence only and cannot approve provider quality or performance.
- Official-source storage, attribution, privacy, commercial, and quota research is recorded in focused M7D1B documents. Google and HERE do not fit the proposed shared multi-year canonical record under reviewed public standard terms; Mapbox and Stadia retain unresolved route-result persistence fields. The OSM path is ODbL; systematic canonical route geometry is `UNRESOLVED / LEGAL_REVIEW_REQUIRED`, and application/engine attribution is mandatory.
- `VALHALLA_ROUTING_CANDIDATE=CONDITIONAL`; `ROUTING_RECOMMENDATION_CANDIDATE=OSM_VALHALLA`; every tested geocoder/search product is `FAIL`; `GENERIC_GEOCODER_AS_SOURCE_OF_TRUTH=NOT_APPROVED`; `GEOCODING_QUALITY_LEADER=NOMINATIM`; `SEARCH_QUALITY_LEADER=NOMINATIM`; `GEOCODING_RECOMMENDATION_CANDIDATE=NONE`; `PROVIDER_SELECTION=NO_PROVIDER_APPROVED_YET`. `GOOGLE_DISCOVERY_FALLBACK_CANDIDATE=CONDITIONAL` for later optional discovery only; `GOOGLE_CANONICAL_PLACE_SOURCE=REJECTED / NOT_APPROVED`. `CANONICAL_PLACE_CATALOG_DIRECTION=APPROVED`, and M7D1C is active as a design-only milestone. Google Places content storage is `RESTRICTED`; Place ID storage is `PERMITTED_WITH_REFRESH_POLICY`, without production approval. Canonical route storage remains `LEGAL_REVIEW_REQUIRED`; attribution is required; production SRE and TCO remain unresolved.
- The Prisma schema and all 18 migrations remain unchanged. M7D1B persists no geocode, geometry, distance, duration, provider ID, or cache result. Production remains `ROUTE_MAPS_ENABLED=false` and `ROUTE_PROVIDER=disabled`; no renderer, SDK, GPS, permission, background location, or realtime work is approved. `M7D1C=ACTIVE_DESIGN_ONLY`; `M7D2=NOT_STARTED / BLOCKED`; `M7E=NOT_STARTED / BLOCKED`.
- Carry-forward obligations remain open: OSM/ODbL canonical route-storage legal review; attribution architecture; Valhalla production hosting, map-data updates/rebuilds, health/readiness/recovery, observability, ownership, and TCO; renderer selection; canonical place-catalog design; and discovery fallback policy. None is claimed complete.

[M7D1_PROVIDER_ABSTRACTION_ROUTE_GEOMETRY_CLOSED]
- M7D1 is formally merged and closed on `production-readiness`. Approved feature head `2d286057f8505fb3b20f08ba76fe1c260c75e8b1` is preserved under PR #17 merge commit `e7b9fbf10e1653420adcd7f149d9d0f721416916`; the reviewed correction commit and prior feature history remain visible.
- The provider-neutral geocode/route foundation is approved. Fixed HTTPS Mapbox, Google, HERE, and Stadia adapters expose no arbitrary-host proxy or user-selectable scheme, hostname, port, provider path, callback, custom URL, credential, or coordinate list. Credentials remain server-only; redirects are manual/rejected and cross-origin 301/302/303/307/308 destinations receive no credential, query-key, or body forwarding.
- Normalized route results receive bounded semantic validation for polyline5, polyline6, segmented geometry, and HERE flexible polyline version/precision/dimension rules. Geometry checksums deterministically bind route-version identity, canonical stop input/order, provider, profile, API/calculation version, encoding, geometry, distance, and duration.
- Admin route-management preview remains tied to an existing editable draft route version and server-owned stops. Preview/geocode results are ephemeral, cache TTL remains zero in production-like configuration, no provider result is persisted, and published route geometry remains immutable; the schema and all 18 migrations are unchanged.
- Production remains fail-closed with `ROUTE_MAPS_ENABLED=false` and `ROUTE_PROVIDER=disabled`; no provider or credential is required and provider calls are zero. Fake is prohibited in staging/production, fallback is never implicit, requests/responses are size- and deadline-bounded, retry is at most one, identical requests are single-flight coalesced, and circuit-breaker recovery is covered.
- No Flutter/Admin map renderer, provider SDK, client token, location permission, GPS/current-location ingestion, background service, realtime location, tracking, moving marker, live ETA, route deviation, or navigation was added. M7E functionality remains absent.
- Closure validation passes API 271, Admin 54, Flutter 241, M7C3C1 145, M7C3A 98, M7C1 79, M7H1 reset 45, legacy online 21, M7H1 passenger association 12, public onboarding 76, trusted sessions, onboarding foundation, route lifecycle, backup/restore, all five triggers, production builds, Android permission/artifact scans, and exact merge-head CI. Preflight is 22/22; deterministic smoke remains score 0.9317, sequence 2, trips 1/6, distance 21.53/129.19, cost 43.06/258.38, winner Darb, with zero provider calls.
- Live provider status is exactly: Mapbox `NOT_EXECUTED`; Google `NOT_EXECUTED`; HERE `NOT_EXECUTED`; Stadia `NOT_EXECUTED`. No live Palestine routing, Arabic acceptance, success rate, latency, attribution, privacy, commercial, quota, or storage conclusion is claimed.
- Provider selection remains `NO_PROVIDER_APPROVED_YET`; Mapbox is only the conditional next-evaluation lead. Storage rights remain `UNRESOLVED`, including permanent canonical geometry, geocoding-result retention, route polyline retention, and provider reference-ID retention.
- Open provider evidence remains: credentialed bakeoffs for all four candidates; human Palestine corridor review; live Arabic geocoding; route/geocode success rates and route p50/p95; provider-specific storage and retention rights; final-display and renderer attribution; privacy/DPA/regional processing and request/telemetry retention; commercial/quota/support and production budget approval; renderer/client-token decision; and provider-persistence schema design.
- M7D2 is `NOT STARTED / BLOCKED ON PROVIDER EVIDENCE`; no migration 19 or provider-derived persistence is approved. M7E is `NOT STARTED` and remains separately gated.

[M7H1_POST_INTEGRATION_HARDENING_CLOSED]
- M7H1 is formally merged and closed on `production-readiness`. Approved feature head `b3640a746aeee27a184e8dac23160ef9e5fe6c1c` is preserved under PR #16 merge commit `9b728dc81e38880ae51d7e1f5cda5126010cc4d0`; the reviewed correction commit and prior merged history remain visible.
- Actor-private trust publication is keyed by and rechecks the current actor before publishing values or errors. Permanent deterministic logout, logout-all, and terminal-session tests hold Driver A's value `86` or error behind a Completer, authenticate Driver B with `22`, and prove delayed success or error cannot repopulate B's provider. Auth teardown preserves the one global unresolved secure-operation slot.
- The persistent real-MySQL reset matrix covers gate combinations, malformed configuration, production/staging fail-closed behavior, repeatability, restrictive foreign keys, and canonical/shared cleanup. It passes 45 assertions, including a clean post-harness rerun; M7C3C1 remains green with 145 assertions.
- Passenger legacy Trips carry exact safe `passenger_request_id` provenance into Flutter and are indexed per request. The repeatable 12-assertion MySQL scenario proves same-owner multi-request ordering independence, unassigned/cancelled isolation, exact shared Trip association, cross-owner concealment, and co-member privacy.
- `PUT /api/v1/driver/online-state` uses a strict explicit desired `online` state and required `Idempotency-Key`. Actor/operation/payload/scope-bound idempotency, response-loss replay, concurrent convergence, one audit transition per logical change, and authoritative reconciliation pass without canonical/shared capacity, offer, reservation, Trip, manifest, member, or location side effects.
- Flutter operation `legacy_driver_online_state_v1` writes its actor-bound version-2 bundle before sending, retains one stable key through refresh and ambiguous results, preserves recovery after `session_changed` or account switching, shares the global unresolved-operation slot, and deletes only after authoritative terminal reconciliation. Secure-save failure sends no request and another actor cannot inspect or replay the bundle.
- Closure validation passes 217 API tests, 54 Admin tests, 241 Flutter tests, and nine tooling tests. Real-MySQL regression passes reset 45, passenger association 12, legacy online recovery 21, M7C3C1 145, M7C3A 98, M7C1 79, public onboarding 76, trusted sessions, onboarding, route lifecycle, five triggers, and checksum-backed backup/restore.
- Demo preflight passes `22/22`; deterministic smoke remains score `0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, winner `darb`. The earlier outage-era Android emulator startup limitation was cleared: the API 36 emulator installed the configured APK and opened Arabic/RTL with correct `مساري` branding.
- Production-like Admin and Android artifacts pass isolation scanning. Canonical/shared gates remain fail closed; no map/GPS/location permission, foreground location service, realtime, ETA, tracking, pricing, payment, dispatch, M7D, or M7E control was introduced.
- All 18 migrations, the Prisma schema, dependencies, workflows, both frozen tags, and M7C3 single/shared invariants remain unchanged. Exact merge-head CI is green: Admin run `31121529418` attempt 5, Backend and MySQL run `31121529276` attempt 2, Flutter Android run `31121529464` attempt 2, and Security run `31121529755` attempt 3.
- Accepted obligations remain open: authoritative success for an already-offline `online:false` request; reset mid-transaction failure injection; more duplicated reset zero-state assertions; exhaustive physical back/rotation/process-interruption matrices; a dedicated rendered-widget delayed trust-response test; and continued harness-isolation/resource-conflict monitoring. None is claimed complete.
- M7D maps/GPS/location work and M7E realtime/ETA/pricing/payment/dispatch work have not started.

[M7C3C2_FLUTTER_SHARED_TRIP_PRESENTATION_CLOSED]
- M7C3C2 is merged and formally closed on `production-readiness`. Approved feature head `229eea460e4663175781d3d8f822902ddfae1848` is preserved under PR #13 merge commit `5bc75752ff2f2b88805279e27002c99e73b6f73c`; all implementation, test, documentation, security-refresh, and independent-review correction commits remain visible.
- All 18 forward-only MySQL migrations and the Prisma schema remain unchanged. Empty deployment, repeat no-op deployment, current migration status, normalized migration-17 checksum `5ea77b6a40bfcbd2be1ba1076eb30951b85f5e6dd34f6037b3265a835f847c90`, migration-18 checksum `b27a28b17c6c090fad8520b97bde8c02463fb02f0195f2cb6736117f64af167c`, and all five migration-18 integrity triggers were reverified on isolated MySQL 8.0.46.
- A separate local/test/demo-only shared mobile gate depends on canonical entry, matching, Trip creation, and the shared backend gate; it defaults false and is forbidden in staging/production. Individual `canonical_route_match_v1` and shared `canonical_shared_trip_match_v1` offers use exact discriminators, separate endpoints, models, list state, and pagination. Shared Trips require `canonical_shared_trip_v1`; missing, cross-mode, and unknown versions fail closed.
- Driver presentation supports passenger-only, merchant-only, and mixed manifests using whole-manifest accept/reject. Public aggregate stop events contain ordered public stop names and reconciled passenger/parcel counts only; internal stop IDs, member/demand/order/reservation identifiers, fingerprints, private parcel data, coordinates, scores, and snapshots are absent from the mobile contract.
- Shared accept/reject extends the one global version-2 actor-bound secure-operation slot. Bundles are written before send, retain the original key through token refresh and ambiguous replay, cannot be overwritten across M7C2/M7C3B/M7C3C2 operation or actor boundaries, survive logout/session termination, and are deleted only after authoritative terminal reconciliation. The review correction acknowledges durable terminal state before deletion.
- Server-authoritative offer refresh and capability checks precede mutation. Display-only server-time countdowns never authorize mutation, terminal detail stops its timer, stale responses cannot restore offered actions, and responses after logout/account change are fenced.
- Passenger and merchant assignment views remain owner-only and co-member blind. Capability-disabled owner assignments show a dedicated unavailable state; unknown lifecycle, composition, Trip, and vehicle values fail closed with localized safe wording.
- Accessibility corrections provide one actionable offer-card node and one accept/reject semantic action without duplicate child announcements. Arabic remains default RTL with correct `مساري`; English remains optional LTR. Selected merged-head evidence covers mixed aggregate presentation, rotation during confirmation, accepted terminal display, 720x1280, 200% text, and no overflow/fatal error. Approved exact-feature-head evidence also covers passenger-only acceptance, merchant-only rejection, portrait/landscape, system/AppBar back, and owner privacy.
- Merged-head validation passed 205 API tests, 27 Admin tests, 203 Flutter tests, nine tooling tests, Prisma validation/generation, typecheck/build, standard/security validation, production-configured Admin, debug/release APK builds, and production Admin/APK artifact scans. The raw audit retains only the four approved moderate Prisma CLI transitives; no force fix was run.
- Real-MySQL regression passed the M7C3C1 141-assertion, M7C3A 98-assertion, M7C1 79-assertion, and public-onboarding 76-check harnesses plus trusted sessions, onboarding foundation, route lifecycle, deterministic reset/reseed, five-trigger verification, and checksum-backed backup/isolated restore.
- Preflight passed `22/22`. Deterministic smoke remains score `0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, winner `darb`. Legacy matching, batching, comparison, Trip lifecycle, and simulated tracking remain isolated from shared canonical records.
- Production remains fail closed: shared backend/mobile presentation and canonical entry are disabled; no map SDK/surface, GPS/location permission or ingestion, foreground service, realtime dependency, tracking/ETA, capacity-reservation client, segment reuse, pricing/payment, dispatch, demo credential, or secure-bundle value is present in the production-like APK.
- All four workflows passed on exact merge commit `5bc75752ff2f2b88805279e27002c99e73b6f73c`: Admin CI run `31017821373`, Backend and MySQL CI run `31017821340`, Flutter Android CI run `31017821397`, and Security and Configuration CI run `31017821584`.
- Accepted non-blocking evidence obligations remain: complete physical TalkBack traversal, exhaustive hands-on process-death timing cut points, every in-flight rotation case, the full gesture-back matrix, maximum-timeline/maximum-count device automation, and continued smaller-physical-device testing. These are not claimed as completed.
- M7C3 is complete at the approved canonical matching, shared-trip aggregation, offer, assignment, and Flutter presentation scope. M7C3C3 was not begun. M7D maps/GPS/location ingestion and M7E realtime/ETA/pricing/payment/dispatch work remain unstarted.

[M7C3C1_BACKEND_CANONICAL_SHARED_TRIPS_CLOSED]
- M7C3C1 is merged and formally closed on `production-readiness`. Approved feature head `2a1310aa08608cf5db02f929ccb7da3a4e7f2e2d` is preserved under PR #12 merge commit `be3aad3047644a55669f85b930e432087b53ed98`; the implementation and all independent-review correction commits remain visible.
- All 18 forward-only migrations are current. Migration 17, `20260728130000_canonical_shared_trip_aggregation`, adds versioned manifests, ordered passenger/merchant membership, per-demand attempts, aggregate offer/reservation ownership, and shared Trip provenance. Migration 18, `20260729120000_harden_canonical_shared_trip_integrity`, adds one-offer-per-manifest uniqueness, exact relational ownership, immutable accepted/terminal snapshots, and monotonic lifecycle triggers. Migrations 1–17 and both frozen release tags remain unchanged.
- Migration 18's five MySQL integrity triggers require a DBA-managed `log_bin_trust_function_creators=1` setting or an equivalent reviewed capability when binary logging is enabled. A non-`SUPER`, database-scoped migration account successfully deployed all 18 migrations on binary-logged MySQL 8.0.46; application code contains no trigger-deployment bypass.
- Passenger-only, merchant-only, mixed passenger/merchant, and one-member manifests are supported. One manifest owns exactly one aggregate offer and reservation and may create exactly one shared Trip; one one-off DriverRoute availability creates at most one canonical Trip while multiple member dispatches may point to it.
- `canonical_global_capacity_v1` conservatively sums every passenger seat and parcel unit across the whole route. Formation holds and decrements both dimensions once; acceptance performs no second decrement; rejection, expiry, and invalidation restore exactly once. Segment-level and residual-capacity reuse remain deferred.
- Stable member ordering and SHA-256 member/manifest fingerprints freeze route version, departure window, quantities, and destinations. Passenger, parcel-count, destination, route, or eligibility drift invalidates the whole manifest and prohibits partial Trip creation; expected internal lifecycle transitions do not cause false drift.
- Generic expiry excludes manifest-owned reservations. The shared lifecycle owns aggregate expiry, two-worker convergence, poison-manifest isolation, pointer cleanup, and one-time capacity restoration.
- Per-demand attempts are categorical and historical. Single and shared matchers use the union of prior DriverRoute attempts; released members may regroup independently until their own five-attempt bound without making unrelated members unavailable.
- Driver aggregate serializers are owner-only and exclude member identities, demand IDs, fingerprints, private reservations, phones, parcel descriptions, recipients, and coordinates. Passenger and merchant owner-status responses remain co-member blind and expose only their own demand and assigned Trip projection.
- `CANONICAL_SHARED_TRIPS_ENABLED` defaults false, requires entry, matching, and Trip-creation gates, and is rejected in staging/production. There is no public runner, automatic worker, Flutter shared capability or aggregate UI, segment ledger, map/GPS/location permission, realtime dependency, pricing/payment surface, or dispatch control. M7C3C2, M7D, and M7E are not started.
- Post-merge MySQL 8.0.46 evidence includes all 18 migrations from empty, repeat no-op deployment, current status, five active triggers, and a populated migration-16 upgrade retaining six single-demand offers and two Trips with zero manifests/members introduced. Checksum-backed backup/restore preserves the constraints and triggers and cleans the isolated restore database.
- Real-MySQL regression passes exactly 141 M7C3C1 assertions, 98 M7C3A assertions, 79 M7C1 assertions, and 76 public-onboarding checks, plus trusted-session, onboarding-foundation, and route-lifecycle harnesses. The documented Windows aggregate-wrapper `spawn EINVAL` remains a tooling-only obligation; every underlying harness passes individually and Linux CI is authoritative.
- Workspace and compatibility regression passes 201 API tests, 27 admin tests, and 179 Flutter tests with clean formatting, analysis, typecheck, build, standard/security/tooling validation, production-configured admin, production-like APK, and artifact scans. The raw production audit contains only the four documented Prisma CLI moderate transitive findings; no force fix was run.
- Legacy preflight passes `22/22`. Deterministic smoke remains score `0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, winner `darb`; shared records remain isolated from legacy matching, batching, comparison, Trip, tracking, and reset behavior.
- All four workflows passed on exact merge commit `be3aad3047644a55669f85b930e432087b53ed98`: Admin CI run `30447066090`, Backend and MySQL CI run `30447066248`, Flutter Android CI run `30447066087`, and Security and Configuration CI run `30447066229`.

[M7C3B_FLUTTER_CANONICAL_OFFERS_CLOSED]
- M7C3B is merged and closed on `production-readiness`. Approved feature head `11454b4a08307d27a7616bf935c860b887d8ecf0` is preserved under PR #11 merge commit `61e186afe1ace7923093b2dfde511f2d7bb66b09`; the implementation and correction commits remain visible.
- Flutter consumes driver-owned canonical offers and passenger/merchant owner assignment status without invoking matching, offer creation, capacity mutation, expiry, reassignment, or Trip lifecycle mutation.
- Driver offer history closes the M7C3A pagination obligation with an opaque, stable, bounded `(created_at, id)` keyset cursor. Owner filtering precedes pagination, equal timestamps use ID ordering, and insertion between pages cannot duplicate or skip older results.
- Accept/reject extend the actor-bound encrypted version-2 operation bundle with write-before-send, stable-key authentication retry, response-loss/process-death recovery, payload/actor blocking, and delete-after-owner-detail reconciliation. Logout and session termination preserve unresolved encrypted work for same-account recovery.
- Accept, reject, and exact recovery re-fetch capability and authoritative offer state before sending. Mutation generation fencing prevents an older offered response from restoring terminal actions, and ambiguous server/invalid-response outcomes preserve the actor-bound unresolved bundle until authoritative reconciliation.
- Passenger and merchant status are owner-only and disclose no pre-accept driver identity. Assigned state exposes only an approved minimum canonical Trip/vehicle summary and truthful no-tracking/no-map/no-ETA wording.
- Refresh is manual, pull-to-refresh, or foreground resume with request-generation fencing. There is no polling, push, WebSocket, Socket.IO, or realtime channel.
- Arabic RTL, English LTR, categorical controls, semantic status announcements, dirty rejection back warnings, scrollable responsive layouts, and 200% text coverage are included.
- Production/staging canonical entry remains fail closed. The capability contract publishes separate safe booleans for route catalog, entry, matching, Trip creation, driver offers, assignment reads, maps, and live tracking.
- One demand per offer and Trip and one canonical Trip per one-off DriverRoute availability remain enforced. M7C3C aggregation, M7D maps/GPS, and M7E live tracking/realtime are not started.
- M7C3A accepted obligations remain: broader administrative deadlock/backoff stress is future work. The driver-offer pagination obligation is resolved by M7C3B.
- Merged-head validation is green with 193 API tests, 27 admin tests, and 179 Flutter tests. Disposable MySQL 8.0.46 applied all 16 unchanged migrations from empty, repeated deployment as a no-op, reported current status, passed the M7C3A 98-assertion and M7C1 79-assertion harnesses, and passed trusted-session, onboarding, 76-check public-onboarding, route-lifecycle, backup/restore, and restrictive cleanup gates.
- Selected real-emulator evidence covers Arabic-default and English layouts, driver accepted-offer list/detail, passenger pending/cancelled/assigned history and minimum Trip summary, merchant pending/unavailable history, manual refresh, landscape/back behavior, and the explicit absence of map/tracking/ETA controls. Accept/reject response loss, process death, actor isolation, payload fencing, secure-save failure, auth refresh, rejection replay, expiry, and terminal races are proven by persistent-state integration and Flutter automation; they are not claimed as a complete manual device matrix.
- Production-like admin and APK artifacts pass isolation scanning. Legacy demo preflight remains `22/22`; deterministic smoke remains score `0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, winner `darb`.
- Accepted non-blocking obligations remain: refresh is required to advance the display-only countdown snapshot; unknown Trip/vehicle enums need localized fail-closed presentation; offer-card semantics may duplicate announcements; disabled actions need clearer spoken reasons; manual process-death/emulator evidence must not be overstated; and capability-disabled direct assignment lists currently use an empty rather than dedicated unavailable state.
- M7C3C aggregation/shared-trip membership is not started. M7D maps/GPS/location ingestion and M7E realtime/pricing/production dispatch are not started. One canonical Trip per one-off DriverRoute availability remains enforced.

[M7C3A_BACKEND_CANONICAL_MATCHING_CLOSED]
- M7C3A is merged and closed on `production-readiness` and remains backend-only. M7C3B Flutter offer/assignment UI is also closed; M7C3C combined passenger/merchant batching and M7D/M7E maps, GPS, realtime, pricing, and production dispatch are not started.
- Forward-only migrations 14 and 15 normalize non-null operational mode across canonical demand, MerchantOrder/Parcel parent-child rows, offers, reservations, and trips. Correction migration 16 adds non-null status ownership keys, demand fingerprints, assignment provenance, same-dispatch pointer foreign keys, and one-off availability uniqueness without changing migrations 1-15.
- `CanonicalDemandDispatch` owns exactly one passenger request or merchant order and enforces one active offer, one accepted offer, and one canonical trip per demand. Until M7C3C introduces an explicit aggregate trip/membership model, one `DriverRoute` availability may own at most one active/accepted canonical offer and one canonical Trip.
- Local/test/demo matching requires explicit entry, matching, and trip-creation gates. Staging/production fail closed, and no public runner or scheduler exists.
- `canonical_route_match_v1` uses departure fit (45%), capacity utilization (25%), trust (20%), and recent-assignment fairness (10%) with a stable documented tie-break. It uses no coordinates, geometry, fake ETA, demographics, or legacy score.
- Offer creation atomically creates one held reservation and one decrement. Driver owner-only list/detail and idempotent accept/reject APIs use safe allowlist serializers. Rejection/expiry restore once; later bounded matching excludes terminal candidates and stops after five attempts.
- Acceptance confirms rather than decrements, revalidates live route/demand/driver authority, departure time, exact reservation amounts, and the persisted demand fingerprint, then fills the one-off availability and creates one canonical Trip with a bounded deterministic `canonical_route_snapshot_v1` checksum. Merchant snapshots preserve the exact accepted parcel count and destination-stop multiset without parcel descriptions. Acceptance creates no location, GPS, map, simulation, or realtime state.
- Passenger and merchant owner status APIs expose dispatch state and a minimum post-acceptance Trip/vehicle summary without candidate, score, reservation, phone, coordinate, or parcel-description disclosure.
- Legacy match/trip/tracking paths explicitly exclude canonical records. The deterministic matcher, batcher, comparison, and demo formulas remain unchanged.
- Independent correction evidence: all 16 migrations apply from empty; the checksum-backed 13-migration baseline upgrades through migrations 14-16; repeat deployment is a no-op; and the disposable MySQL 8.0.46 M7C3A harness passes 98 persistent-state assertions. Added proofs cover two workers/two demands competing for one availability, one trip per one-off availability, same-dispatch pointers, accepted-offer trip provenance, merchant parcel drift, elapsed departure invalidation, canonical/generic expiry ownership, exact restoration, and exact response-loss replay.
- Compatibility evidence remains green: 190 API, 27 admin, and 163 Flutter tests pass; the M7C1 harness passes 79 assertions (the original 78 behavior assertions plus migration-16 currency); trusted-session, onboarding, 76-check public-onboarding, and route-lifecycle harnesses pass; and checksum-backed restore/upgrade cleanup succeeds. Production admin and release APK artifact scans pass with no client contract or dependency change.
- Production-like admin and release APK builds pass artifact isolation. Runtime logs contain no configured secret values, authorization headers, database URLs, phone numbers, route snapshot JSON, parcel descriptions, or raw idempotency keys. Canonical entry remains hidden and matching/trip creation remain fail-closed in staging/production.
- Live demo preflight passes 22/22 on real MySQL and deterministic smoke remains exact: score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, winner `darb`. Canonical rows do not enter legacy comparison or tracking.

[M7C3A_POST_MERGE_CLOSURE]
Merge and migration integrity (2026-07-27):
- PR #10 was merged with a merge commit. Approved feature head `e0f69a771caac3e23e5fc5384e93897e6dcd3c96` is preserved as an ancestor of merge commit `81629473b76bf3f287bf04f177256edf92d85b9b`; original implementation and corrective commits remain visible. The local and remote feature branches were deleted only after ancestry verification.
- The production-readiness drift after reviewed base `757265d467e4b769f62a073841adbd35184a58c4` was limited to unrelated README prose commit `39617f70640825369656d4508b336f46cff9c596`; no operational compatibility review was required and the feature branch was not rebased.
- All 16 forward-only MySQL migrations are current. Migrations 1-15 remain unchanged. Migration 16, `20260727110000_harden_canonical_assignment_integrity`, enforces same-dispatch ownership, accepted-offer/Trip provenance, merchant demand fingerprints, and one canonical Trip per one-off availability. Empty deployment, repeat no-op, current status, checksum-backed migration-13 upgrade through 16, and current-state restore all passed without `db push`, reset, migrate resolution, or migration editing.

Canonical assignment result:
- Normalized operational modes and `CanonicalDemandDispatch` own canonical demand assignment. The deterministic scorer creates at most one active offer per demand and one canonical Trip per demand, dispatch, accepted offer, and one-off DriverRoute availability.
- Passenger and merchant matching create one held capacity reservation and one decrement. Accept confirms the existing hold, revalidates route, demand, driver authority, departure, reservation amounts, and merchant parcel fingerprint, then creates one canonical Trip with an immutable privacy-bounded route snapshot and checksum. Exact acceptance replay returns the same Trip without a second decrement.
- Reject and canonical expiry restore capacity exactly once, generic reservation expiry cannot double-restore an offer hold, and bounded reassignment excludes rejected/expired drivers. Passenger and merchant owner-status APIs conceal cross-owner demand, offer, reservation, candidate, phone, coordinate, and parcel-description data.
- Legacy matcher, batcher, comparison, trip lifecycle, and simulated tracking remain isolated from canonical records. Canonical matching creates no legacy Match, Trip, ParcelBatch, ComparisonRun, LocationEvent, or tracking state.

Merged-head validation and release boundary:
- Local validation passed dependency installation, Prisma validate/generate, workspace typecheck/build, 190 API tests, 27 admin tests, 163 Flutter tests, standard/security/workflow/tooling policy, production-configured admin and release-APK artifact scans, and the raw production audit. Only the four approved Prisma CLI moderate transitives remain; no force fix was run.
- Disposable MySQL 8.0.46 with `utf8mb4_0900_ai_ci` passed the 98-assertion M7C3A harness, the 79-assertion M7C1 harness, trusted sessions, onboarding, the 76-check public-onboarding harness, route lifecycle, deterministic reset/reseed, and backup/restore. The Windows aggregate runner still reproduces documented `spawn EINVAL`; individual harnesses and Linux CI are authoritative.
- Live preflight passed 22/22. Deterministic smoke remained score `0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.
- Canonical entry, matching, and canonical Trip creation remain explicit local/test/demo gates and fail closed in staging/production. No public matching/expiry runner, automatic worker, Flutter offer UI, combined batching, map/GPS/realtime dependency, pricing, or dispatch UI was added.
- Admin, backend-mysql, mobile, and security workflows all passed on exact merge commit `81629473b76bf3f287bf04f177256edf92d85b9b`.

Accepted obligations and next boundary:
- M7C3B resolved driver-offer pagination with the stable `(created_at, id)` keyset cursor.
- Continue broader deadlock/backoff stress across administrative route and availability mutations.
- M7C3B is closed. M7C3C is not started. Maps/GPS/realtime remain M7D/M7E.

[PROJECT_OVERVIEW]
Darb is a Palestine-focused smart route-sharing logistics MVP.

Current implementation status: M7B Canonical Route Management, M7C1 Backend Multi-Route Operational Foundation, M7C2 Flutter Multi-Route Role Flows, and M7C3 canonical matching/shared-trip aggregation, offers, assignments, and Flutter presentation are closed on `production-readiness`. Production canonical matching remains disabled; M7C3C3 was not begun, and M7D/M7E maps, GPS, location ingestion, realtime, ETA, pricing, payment, and dispatch work are not started.

Locked MVP corridor:
Hebron / PPU / Bab Al-Zawiya -> Bethlehem.

The locked corridor remains the deterministic demo/test reference. M7B adds a feature-gated canonical route-management foundation without switching passenger, merchant, matching, batching, trip creation, Flutter role flows, or production multi-route entry away from the legacy corridor.

[M7_APPROVED_ROUTE_DECISIONS]
- Admin owns canonical route and stop creation, version publication, pause/resume, and retirement.
- Drivers cannot create or edit canonical route geometry or stops; a later milestone lets them select published routes.
- Controlled beta is limited to no more than five approved routes.
- Outbound and inbound directions are separate canonical routes. Loops require explicit later approval.
- Passenger and merchant arbitrary coordinates are deferred; approved stop selection belongs to M7C.
- One merchant order belongs to one immutable route version. Multi-route orders are deferred.
- M7B supports only one-off driver availability foundations. Recurring schedules are deferred.
- Published route versions and their ordered stops are immutable. Corrections clone a new draft version.
- Used routes, versions, and stops remain readable history and cannot be destructively deleted.
- Paused versions reject new availability and demand after M7C integration; active historical work is not rewritten.
- Route pricing, provider selection, maps, GPS, realtime, and dispatching are outside M7B.
- The original deterministic corridor, `darb_route_score`, simulation points, and approved metrics remain unchanged.

[M7B_FIXED_CORRIDOR_AUDIT]
- Deterministic demo fixtures: `LOCKED_CORRIDOR_KEY`, corridor labels/coordinates, demo route points, seeded passenger and merchant stops, comparison formulas, smoke expectations, Flutter demo presets, and their regression fixtures.
- Reusable logic: coordinate range validation, role ownership, trusted sessions, request IDs, safe auditing/logging, trip lifecycle, REST polling, MySQL migration/recovery tooling, localization, and production/demo isolation.
- Future M7C migration targets: passenger/merchant coordinate DTOs, driver route creation, match/batch corridor filters, role mobile forms, and trip/match route references.
- M7B production blockers: no stable canonical route identity, immutable version, reusable stop, ordered stop membership, transactional publication, draft concurrency, or canonical availability reference.
- Migration concerns: `DriverRoute` currently combines corridor and capacity state; existing match/trip relations depend on it; legacy fields and behavior must remain additive and nullable throughout M7B.

Implemented in M1:
- TypeScript backend API foundation.
- PostgreSQL Prisma schema.
- Seeded demo accounts.
- Deterministic demo reset endpoint.
- Auth login endpoint.
- Protected `/api/v1/me` endpoint.
- Structured audit events for login and demo reset.

Implemented in M2A:
- Passenger manual request APIs.
- Driver locked-corridor route APIs.
- Merchant order/parcels APIs.
- Admin read-only dashboard/list APIs.
- Role guards and ownership checks.
- Audit events for manual role actions.

Implemented in M2B:
- Route-based matching API.
- Merchant parcel batching API.
- Darb vs nearest-driver comparison API.
- Persistent `ParcelBatch`, `Match`, and `ComparisonRun` records.
- Deterministic Haversine-based demo metrics.
- Audit events for match decisions, parcel batches, and comparison runs.

Implemented in M3A:
- Driver/admin match accept and reject APIs.
- Trip creation on match acceptance.
- Trip visibility and status update APIs.
- Deterministic simulated tracking API.
- Latest trip location polling API.
- Status side effects across driver route, passenger request, merchant order, parcel batch, and parcels.
- Audit events for match accept/reject, trip status updates, and tracking events.

Implemented in M3B:
- React/Vite admin demo console under `apps/admin`.
- Admin login and current-admin session loading.
- Demo reset panel with reset-key and admin-JWT support.
- Dashboard overview for seeded users, routes, requests, orders, parcels, and trips.
- Matching panel with selected route, score, scoring breakdown, and explanation.
- Parcel batching panel with batch id, parcel count, distance saved, and explanation.
- Comparison table for Darb vs nearest-driver metrics.
- Trip control panel for match accept/reject and valid status progression.
- Deterministic tracking simulation panel with latest location and route-progress trail.
- Full demo sequence button using existing deterministic APIs.

Implemented in M3C:
- Admin console demo-path QA pass from local dev servers.
- Login screen now shows demo admin credentials.
- Demo reset copy now explains that reset recreates the deterministic judge scenario.
- Full Demo Sequence now shows step-by-step progress.
- Matching panel now labels the selected driver/route more clearly.
- Local API smoke sequence revalidated the full judge demo path.

Implemented in M3D:
- Admin console bilingual localization for Arabic and English.
- Arabic is the default language and uses RTL layout.
- English is optional and uses LTR layout.
- Language switch appears on login and authenticated dashboard.
- Selected language persists in `localStorage` under `darb_locale`.
- Document `<html>` `lang` and `dir` update dynamically.
- UI labels, action text, success/error messages, progress steps, roles, statuses, and demo metrics are translated.
- API enum values remain unchanged and are mapped to translated UI labels.
- Locale-aware number and date/time formatting added for `ar-PS` and `en-US`.

Implemented in M4B:
- Stable Flutter SDK installed under `C:\Users\basha\development\flutter` and added to user PATH.
- Android SDK command-line tools installed under existing Android SDK.
- Android licenses accepted.
- `flutter doctor -v` reports Android-capable environment with no issues.
- Android-only Flutter app created under `apps/mobile`.
- Android application ID set to `ps.darb.mobile`.
- Arabic-default mobile shell implemented with Flutter ARB/gen_l10n.
- English optional language switch implemented.
- Locale persists with `darb_locale`.
- `API_BASE_URL` configured through `String.fromEnvironment`.
- Debug APK builds successfully.
- Android runtime validation passed on emulator `Medium_Phone_API_36.0` / `emulator-5554`, Android 16 API 36.

Implemented in M4C:
- Mobile API client for `POST /api/v1/auth/login` and `GET /api/v1/me` only.
- JWT storage uses `flutter_secure_storage` only.
- Locale storage remains in `shared_preferences` only.
- Startup session restoration reads saved JWT and validates it with `/api/v1/me`.
- 401/invalid token clears secure token and returns to login.
- Temporary network/timeout restore failure preserves the possibly valid token and shows retry.
- Login screen with passenger, driver, and merchant demo presets.
- Logout clears secure token and preserves selected language.
- Role-aware routing for passenger, driver, merchant, and unsupported admin mobile role.
- Passenger, driver, and merchant home shells added as role workspaces only.
- Admin mobile login routes to unsupported-role screen with web-admin guidance.
- No mobile business flows were added.

Implemented in M4D:
- Passenger dashboard backed by existing passenger request and trip APIs.
- Passenger create-request form for the locked corridor only.
- Pickup presets reuse seeded corridor-compatible values: `PPU Main Gate` at `31.550000,35.100000` and `Bab Al-Zawiya` at `31.532600,35.099800`.
- Destination is locked to `Bethlehem Center` at `31.705400,35.202400`.
- Passenger request detail shows status, pickup, destination, preferred time, passenger count, created time, and LTR request ID.
- Passenger cancellation uses existing backend transition rules and refreshes after conflict/error.
- Passenger matching uses `POST /api/v1/matches/run` and `GET /api/v1/matches/:id` only.
- Match result shows selected route, score, scoring breakdown, status, and explanation.
- Passenger trip list/detail uses `GET /api/v1/trips`, `GET /api/v1/trips/:id`, and `GET /api/v1/trips/:id/location` only.
- Passenger trip detail polls REST while visible and pauses/resumes with app lifecycle.
- No driver or merchant business UI was added.
- M4D did not add a role-filtered `GET /api/v1/matches` endpoint; that dependency was completed later in M4E1.

Implemented in M4E1:
- Authenticated role-filtered `GET /api/v1/matches` endpoint.
- Driver inbox is limited to matches connected to the driver's own routes.
- Passenger inbox is limited to matches connected to the passenger's own requests.
- Merchant inbox is limited to matches connected to the merchant's own orders.
- Admin inbox can see all matches.
- Optional `status` query validates against the existing `MatchStatus` enum.
- Match summaries are ordered newest first and expose only safe route/request/order/batch fields.
- `GET /api/v1/matches/:id` now grants the connected driver the same ownership access as the inbox and returns the same safe summary contract.
- No database schema or migration change was required.

Implemented in M4E2:
- Independently audited M4E1 against the source, Prisma relations, automated tests, and a fresh real PostgreSQL smoke; no corrective change was required.
- Replaced the driver placeholder shell with a complete role-protected Flutter driver flow.
- Driver dashboard loads current route, proposed match count, active trip, user identity, language controls, refresh, and logout from real APIs.
- Locked-corridor route view/create/deactivate flow uses backend-fixed corridor coordinates and exposes only seats and parcel capacity as driver choices.
- Driver match inbox and detail use the M4E1 safe match-summary contract, localized status/type labels, scoring breakdown, and accept/reject actions.
- Match acceptance navigates directly to the created driver trip.
- Driver trip UI exposes only the next valid status in the approved lifecycle and refreshes safely after conflicts.
- Deterministic tracking step/reset and latest-location display are available without GPS, maps, Socket.IO, or background tracking.
- Driver trip detail polls every 5 seconds and location every 3 seconds while visible, pauses with app lifecycle, and prevents duplicate timers and overlapping actions.
- Arabic remains the default RTL locale; English is optional LTR and persists independently of the secure JWT session.
- No backend, Prisma schema, migration, or dependency change was required.

Implemented in M4F:
- Replaced the final merchant placeholder with a role-protected Flutter merchant dashboard, locked order form, parcel batching, safe match inbox/detail, and read-only connected trip tracking.
- Persisted safe parcel-batch summaries in merchant order list/detail and rejected duplicate batching with a controlled `409`.
- Completed passenger, driver, and merchant business routing in one Android app; the unused generic role-home shell was removed.

Implemented in M5A:
- Rehearsed the full Arabic-first combined passenger + merchant + selected-driver + admin story against real PostgreSQL, browser, and Android emulator state.
- Linked the newest parcel batch to combined matches/trips so one accepted trip carries passenger request, merchant order, and parcel batch state consistently.
- Stabilized the admin Full Demo Sequence order, live localized progress, accepted/completed result state, and translated network recovery.
- Localized cross-role match explanations and simulated tracking labels; mobile dashboard refresh failures now show translated retry state.
- Added deterministic `demo:preflight` and `demo:smoke` tooling, final screenshots, and `DEMO_RUNBOOK.md`.
- Completed five consecutive clean rehearsals without crash, duplicate trip/batch, or manual database correction.

Implemented in M5B:
- Froze hackathon product scope and limited changes to presentation documentation, preflight service-identity hardening, packaging, rehearsal, and final validation.
- Audited the designated presentation machine, performed a no-snapshot cold start, rehearsed controlled API failure/recovery, and ran three final deterministic presentation checks.
- Added `JUDGE_SCRIPT.md`, `BACKUP_DEMO.md`, `README_DEMO_START.md`, and `RELEASE_NOTES.md`.
- Prepared the ignored `release/darb-hackathon-demo/` package and ZIP with APK, safe templates, evidence, and SHA-256 manifests.

Implemented in M5C:
- Preserved the complete PostgreSQL release at commit `074fc4e7cc79c6b08a2baa18ca251b4802aa48c7` and annotated tag `v0.1.0-hackathon`.
- Migrated the active Prisma datasource from PostgreSQL to MySQL without changing application API contracts, roles, matching, batching, trips, tracking, admin screens, or Flutter screens.
- Replaced `@prisma/adapter-pg`/`pg` with `@prisma/adapter-mariadb`/`mariadb` at Prisma 7.8.0.
- Replaced the active PostgreSQL migration history with a fresh MySQL baseline; PostgreSQL SQL remains available from Git history and the fallback tag.
- Added explicit MySQL `TEXT` storage for explanation/description fields that were unbounded PostgreSQL `TEXT`, preventing an implicit `VARCHAR(191)` capacity regression.
- Updated preflight, smoke environment loading, startup documentation, migration instructions, and release packaging for MySQL.
- Validated five deterministic resets, Arabic/emoji round-trip, full cross-role behavior, and five deterministic MySQL rehearsals against the real local database.

Migration integrity result:
- M2B accidentally modified committed `0001_init` to add M2B audit enum values.
- This was unnecessary because those values belong in `0002_matching_batching_comparison`.
- Corrected by restoring `0001_init` and keeping M2B changes in `0002`.
- Corrective commit created: `chore: normalize Prisma migrations`.

Not implemented yet:
- Mobile/public registration.
- AI parser.
- Live GPS tracking.
- Socket.IO.
- Maps, payments, multi-city support, and app-store deployment.

[TECH_STACK]
Actual local runtime checked on 2026-07:
- Node.js: v22.17.1.
- npm: 10.9.2.
- Flutter: 3.44.6 stable.
- Dart: 3.12.2 stable.
- Flutter SDK path: `C:\Users\basha\development\flutter`.
- Android SDK path: `C:\Users\basha\AppData\Local\Android\Sdk`.
- Android SDK platform: android-36.
- Android build tools: 36.0.0.
- Android Studio bundled JDK selected by Flutter: `C:\Program Files\Android\Android Studio\jbr\bin\java`, OpenJDK 21.0.6.

Package versions checked via `npm view` before pinning:
- express: 5.2.1.
- typescript: 6.0.3.
- prisma: 7.8.0.
- @prisma/client: 7.8.0.
- @prisma/adapter-mariadb: 7.8.0.
- zod: 4.4.3.
- jsonwebtoken: 9.0.3.
- bcryptjs: 3.0.3.
- dotenv: 17.4.2.
- mariadb: 3.4.5.
- @types/express: 5.0.6.
- @types/jsonwebtoken: 9.0.10.
- @types/node: 26.1.0.
- vitest: 4.1.9.
- supertest: 7.2.2.
- @types/supertest: 7.2.0.
- tsx: 4.22.4.
- react: 19.2.7.
- react-dom: 19.2.7.
- vite: 8.1.3.
- @vitejs/plugin-react: 6.0.3.
- @types/react: 19.2.17.
- @types/react-dom: 19.2.3.
- flutter_riverpod: 3.3.2.
- go_router: 17.3.0.
- shared_preferences: 2.5.5.
- http: 1.6.0.
- flutter_secure_storage: 10.3.1.
- intl: 0.20.2, pinned by Flutter 3.44.6 `flutter_localizations`.
- flutter_lints: 6.0.0.

Backend:
- Node.js.
- Express.
- TypeScript.
- Prisma.
- MySQL 8.
- Zod.
- JWT.
- bcryptjs.

Admin console:
- React.
- Vite.
- TypeScript.
- Plain CSS.
- Small typed in-repo i18n dictionary; no external localization library.

Mobile Android app:
- Flutter.
- Dart.
- Android only.
- Riverpod.
- go_router.
- shared_preferences.
- http.
- flutter_secure_storage.
- Flutter SDK `flutter_localizations`.
- Flutter ARB/gen_l10n.

Required admin env:
- `VITE_API_BASE_URL`, for example `http://localhost:3000`.

Localization:
- Supported admin locales: Arabic `ar`, English `en`.
- Default locale: Arabic `ar` unless `darb_locale` is already saved.
- Arabic document mode: `lang="ar"`, `dir="rtl"`.
- English document mode: `lang="en"`, `dir="ltr"`.
- Locale persistence key: `darb_locale`.
- Future Flutter screens must also support Arabic default, English optional, and runtime RTL/LTR switching.

[SYSTEM_FLOW]
M1 flow:
1. Operator configures `DATABASE_URL`, `JWT_SECRET`, and `DEMO_RESET_KEY`.
2. API starts at `PORT`, default `3000`.
3. `GET /api/v1/health` returns health status.
4. `POST /api/v1/demo/reset` resets and seeds demo data.
5. Demo reset is protected by either an admin JWT or `x-demo-reset-key` matching `DEMO_RESET_KEY`.
6. Seeded users can login through `POST /api/v1/auth/login`.
7. Authenticated users can call `GET /api/v1/me`.

M3B admin console flow:
1. Operator starts API and admin app.
2. Admin app reads `VITE_API_BASE_URL`.
3. Judge signs in with seeded admin credentials.
4. Console loads dashboard, routes, passenger requests, merchant orders, and trips.
5. Judge can reset demo data and the console re-authenticates because seeded users are recreated.
6. Judge can run matching, batching, comparison, match accept/reject, trip status progression, and deterministic tracking simulation.

M3D localization flow:
1. First admin visit opens in Arabic without browser-language detection.
2. Language switch toggles `ar` and `en` without resetting auth or demo state.
3. Selected locale is saved to `darb_locale`.
4. Refresh restores the saved locale.
5. UI direction follows locale and technical values such as phone numbers, IDs, URLs, and coordinates remain readable LTR.

M4B mobile shell flow:
1. Android app starts in Arabic when `darb_locale` is not saved.
2. Arabic UI uses RTL through Flutter localization/direction handling.
3. User can switch to English from the welcome shell.
4. Selected language persists under `darb_locale` through `shared_preferences`.
5. Welcome shell shows app-shell status and configured `API_BASE_URL` diagnostics only.
6. No passenger, driver, merchant, auth, matching, trip, or tracking business flow is implemented yet.

M4C mobile auth/session flow:
1. App starts at `/splash` and loads the saved locale independently from auth state.
2. App reads JWT from secure storage key `darb_jwt`.
3. If no token exists, unauthenticated users route to `/login`.
4. If a token exists, app calls `GET /api/v1/me` with `Authorization: Bearer <token>`.
5. If `/me` succeeds, session is restored and user routes by role.
6. If `/me` returns 401 or invalid token, token is deleted and user routes to `/login`.
7. If restore fails due network or timeout, token is preserved and splash shows retry.
8. Login calls `POST /api/v1/auth/login`, saves JWT securely, sets current user, and routes by role.
9. Logout deletes secure JWT, clears auth state, returns to `/login`, and preserves selected language.
10. No refresh token, registration, biometric auth, GPS, maps, Socket.IO, or business-flow API calls exist.

M4D passenger mobile flow:
1. Passenger logs in with M4C auth.
2. `/passenger` loads active passenger requests and visible passenger trips.
3. If no active request exists, passenger can open `/passenger/request/new`.
4. Create form submits backend snake_case payload fields without translated enum values.
5. Request detail at `/passenger/request/:id` can cancel only when backend-permitted actions are shown.
6. Request detail can run route matching and navigate to `/passenger/match/:id`.
7. Match detail displays selected route, final score, scoring breakdown, status, and explanation.
8. Dashboard exposes connected passenger trip when one exists.
9. Trip detail at `/passenger/trip/:id` polls trip detail every 5 seconds and latest location every 3 seconds while visible.
10. Polling stops on dispose, pauses on background/inactive lifecycle, and resumes on foreground.
11. Passenger cannot accept/reject matches, mutate trip status, trigger tracking simulation, or reset tracking.

M4E1 match inbox flow:
1. Authenticated caller requests `GET /api/v1/matches`, optionally with `?status=<MatchStatus>`.
2. The API applies ownership filtering in the Prisma query for driver, passenger, or merchant callers; admin receives the unscoped inbox.
3. Results are ordered by `created_at desc`.
4. Each result is serialized through the same explicit safe-summary contract used by `GET /api/v1/matches/:id`.
5. Driver detail ownership is based on the connected driver route, matching list, accept, and reject permissions.
6. Invalid statuses return `400`; missing authentication returns `401`.

M4E2 driver mobile flow:
1. Driver logs in through the existing M4C secure session flow and routes to `/driver`.
2. Dashboard loads `GET /api/v1/driver/routes`, `GET /api/v1/matches`, and `GET /api/v1/trips`; failed requests show an error instead of fabricated counts.
3. `/driver/route` shows the current `active`, `assigned`, or `on_trip` route, or creates the locked route when none exists.
4. `/driver/matches` shows own-route matches with proposed/sent assignments first; an optional proposed filter calls `GET /api/v1/matches?status=proposed`.
5. `/driver/match/:id` shows the safe assignment summaries and scoring breakdown, then accepts or rejects only backend-permitted matches.
6. Accepted matches navigate to `/driver/trip/:id`.
7. Driver trip actions follow `accepted -> pickup_started -> picked_up -> in_transit -> delivered -> completed`; arbitrary jumps are never rendered.
8. Tracking controls call deterministic step/reset endpoints and show the latest polled location plus a seven-point progress indicator.
9. Trip and location polling pause in background/inactive lifecycle states, resume in foreground, stop on dispose, and do not create duplicate timers.
10. Driver routes are protected by the existing role redirect, so passenger, merchant, admin, and unauthenticated users cannot enter them.

Workspace scripts:
- `npm run dev:api` starts the API workspace.
- `npm run dev:admin` starts the admin Vite app.
- `npm run build:api` builds the API workspace.
- `npm run build:admin` builds the admin workspace.
- `npm run build` builds all workspaces.
- `npm run typecheck:api` typechecks the API workspace.
- `npm run typecheck:admin` typechecks the admin workspace.
- `npm run typecheck` typechecks all workspaces.
- `npm run test:admin` runs admin localization tests.
- `npm run prisma:generate` generates the API Prisma client from the root workspace.

[ARCHITECTURE]
Actual folder structure:

```text
.
├── package.json
├── README.md
├── PROJECT_MAP.md
└── apps
    ├── admin
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── vite.config.ts
    │   ├── index.html
    │   ├── .env.example
    │   └── src
    │       ├── api.ts
    │       ├── App.tsx
    │       ├── i18n
    │       │   ├── LocaleContext.tsx
    │       │   ├── locale.ts
    │       │   ├── locale.test.ts
    │       │   └── translations.ts
    │       ├── main.tsx
    │       ├── styles.css
    │       └── vite-env.d.ts
    ├── mobile
    │   ├── pubspec.yaml
    │   ├── pubspec.lock
    │   ├── l10n.yaml
    │   ├── android
    │   ├── lib
    │   │   ├── main.dart
    │   │   ├── app.dart
    │   │   ├── core
    │   │   │   ├── api
    │   │   │   │   ├── api_client.dart
    │   │   │   │   └── api_error.dart
    │   │   │   ├── config
    │   │   │   │   └── app_config.dart
    │   │   │   ├── i18n
    │   │   │   │   ├── domain_labels.dart
    │   │   │   │   └── locale_controller.dart
    │   │   │   ├── routing
    │   │   │   │   └── app_router.dart
    │   │   │   ├── theme
    │   │   │   │   ├── app_theme.dart
    │   │   │   │   └── app_tokens.dart
    │   │   │   └── widgets
    │   │   │       ├── language_switch.dart
    │   │   │       └── darb_card.dart
    │   │   ├── features
    │   │   │   ├── auth
    │   │   │   │   ├── application
    │   │   │   │   │   └── auth_controller.dart
    │   │   │   │   ├── data
    │   │   │   │   │   ├── auth_repository.dart
    │   │   │   │   │   └── token_storage.dart
    │   │   │   │   ├── domain
    │   │   │   │   │   └── auth_models.dart
    │   │   │   │   └── presentation
    │   │   │   │       ├── demo_accounts.dart
    │   │   │   │       ├── login_screen.dart
    │   │   │   │       ├── splash_screen.dart
    │   │   │   │       └── unsupported_role_screen.dart
    │   │   │   ├── driver
    │   │   │   │   ├── application
    │   │   │   │   │   └── driver_controller.dart
    │   │   │   │   ├── data
    │   │   │   │   │   ├── driver_models.dart
    │   │   │   │   │   └── driver_repository.dart
    │   │   │   │   └── presentation
    │   │   │   │       ├── driver_home_screen.dart
    │   │   │   │       ├── driver_route_screen.dart
    │   │   │   │       ├── driver_match_inbox_screen.dart
    │   │   │   │       ├── driver_match_detail_screen.dart
    │   │   │   │       ├── driver_trip_screen.dart
    │   │   │   │       └── driver_ui.dart
    │   │   │   ├── matching
    │   │   │   │   ├── data
    │   │   │   │   │   ├── matching_models.dart
    │   │   │   │   │   └── matching_repository.dart
    │   │   │   │   └── presentation
    │   │   │   │       └── match_detail_screen.dart
    │   │   │   ├── merchant
    │   │   │   │   ├── application
    │   │   │   │   │   └── merchant_controller.dart
    │   │   │   │   ├── data
    │   │   │   │   │   ├── merchant_models.dart
    │   │   │   │   │   └── merchant_repository.dart
    │   │   │   │   └── presentation
    │   │   │   │       ├── merchant_home_screen.dart
    │   │   │   │       ├── merchant_order_form_screen.dart
    │   │   │   │       ├── merchant_order_detail_screen.dart
    │   │   │   │       ├── merchant_match_inbox_screen.dart
    │   │   │   │       ├── merchant_match_detail_screen.dart
    │   │   │   │       └── merchant_trip_screen.dart
    │   │   │   ├── passenger
    │   │   │   │   ├── application
    │   │   │   │   │   └── passenger_controller.dart
    │   │   │   │   ├── data
    │   │   │   │   │   ├── passenger_models.dart
    │   │   │   │   │   └── passenger_repository.dart
    │   │   │   │   └── presentation
    │   │   │   │       ├── create_request_screen.dart
    │   │   │   │       ├── passenger_home_screen.dart
    │   │   │   │       └── request_detail_screen.dart
    │   │   │   └── trips
    │   │   │       ├── application
    │   │   │       │   └── passenger_trip_controller.dart
    │   │   │       ├── data
    │   │   │       │   ├── trip_models.dart
    │   │   │       │   └── trip_repository.dart
    │   │   │       └── presentation
    │   │   │           └── passenger_trip_screen.dart
    │   │   └── l10n
    │   │       ├── app_ar.arb
    │   │       ├── app_en.arb
    │   │       └── generated AppLocalizations files
    │   └── test
    │       ├── app_shell_test.dart
    │       ├── auth_controller_test.dart
    │       ├── auth_repository_test.dart
    │       ├── driver_controller_test.dart
    │       ├── driver_flow_widget_test.dart
    │       ├── driver_repository_test.dart
    │       ├── merchant_controller_test.dart
    │       ├── merchant_flow_widget_test.dart
    │       ├── merchant_repository_test.dart
    │       ├── passenger_controller_test.dart
    │       └── passenger_flow_repository_test.dart
    └── api
        ├── package.json
        ├── tsconfig.json
        ├── vitest.config.ts
        ├── prisma.config.ts
        ├── .env.example
        ├── prisma
        │   ├── schema.prisma
        │   └── migrations
        │       ├── 0001_init
        │       ├── 0002_matching_batching_comparison
        │       └── 0003_trips_tracking
        └── src
            ├── app.ts
            ├── server.ts
            ├── config.ts
            ├── lib
            │   ├── audit.ts
            │   ├── geo.ts
            │   └── prisma.ts
            ├── middleware
            │   ├── auth.ts
            │   └── error.ts
            ├── modules
            │   ├── admin.ts
            │   ├── auth.ts
            │   ├── batching.ts
            │   ├── comparison.ts
            │   ├── driver.ts
            │   ├── matching.ts
            │   ├── merchant.ts
            │   ├── passenger.ts
            │   ├── trips.ts
            │   └── demoReset.ts
            └── tests
                ├── auth.test.ts
                ├── demoReset.test.ts
                ├── matchInbox.test.ts
                ├── matchingBatchingComparison.test.ts
                ├── manualRoleApis.test.ts
                └── tripsTracking.test.ts
```

[DATA_MODEL]
Implemented Prisma models:
- User.
- DriverProfile.
- DriverRoute.
- PassengerRequest.
- MerchantOrder.
- Parcel.
- ParcelBatch.
- Match.
- ComparisonRun.
- Trip.
- LocationEvent.
- DemoScenario.
- AuditEvent.

User includes:
- id.
- name.
- phone.
- password_hash.
- role.
- demo_account.
- created_at.

AuditEvent covers:
- auth login.
- demo reset.
- passenger request created.
- passenger request cancelled.
- driver route created.
- driver route deactivated.
- merchant order created.
- parcel batch created.
- comparison run created.
- match accepted.
- match rejected.
- trip status updated.
- location recorded.
- tracking simulation step.
- driver verification later.
- match decisions later.
- admin actions.

M2A schema changes:
- Expanded `AuditAction` enum with M2A action values.
- No new tables were required.

M2B schema changes:
- Added `ParcelBatchStatus` enum.
- Added `MatchStatus` enum.
- Added `ParcelBatch` model.
- Added `Match` model with persisted `scoring_breakdown` JSON.
- Added `ComparisonRun` model.
- Expanded `AuditAction` with `parcel_batch_created` and `comparison_run_created`.

M3A schema changes:
- Added `TripStatus` enum.
- Added `Trip` model.
- Added `LocationEvent` model.
- Expanded `AuditAction` with `match_accepted`, `match_rejected`, `trip_status_updated`, `location_recorded`, and `tracking_simulation_step`.

[STATE_MACHINES]
M1 defines schema enum values only. Business state transition enforcement is not implemented yet.

Current enum support:
- UserRole: passenger, driver, merchant, admin.
- DriverRouteStatus: inactive, active, assigned, on_trip, completed.
- RequestStatus: draft, pending, matched, accepted, picked_up, in_transit, delivered, cancelled.
- MerchantOrderStatus: draft, submitted, batched, assigned, in_transit, completed.
- ParcelStatus: pending, batched, assigned, picked_up, in_transit, delivered.
- ParcelBatchStatus: created, proposed, assigned, picked_up, in_transit, delivered.
- MatchStatus: proposed, sent_to_driver, accepted, rejected, expired.
- TripStatus: created, accepted, pickup_started, picked_up, in_transit, delivered, completed, cancelled.
- AuditAction: auth_login, demo_reset, passenger_request_created, passenger_request_cancelled, driver_route_created, driver_route_deactivated, merchant_order_created, parcel_batch_created, comparison_run_created, match_accepted, match_rejected, trip_status_updated, location_recorded, tracking_simulation_step, driver_verification, match_decision, admin_action.

[API_CONTRACTS]
Implemented endpoints:
- `GET /api/v1/health`.
- `POST /api/v1/auth/login`.
- `GET /api/v1/me`.
- `POST /api/v1/demo/reset`.
- `POST /api/v1/passenger/requests`.
- `GET /api/v1/passenger/requests`.
- `GET /api/v1/passenger/requests/active`.
- `GET /api/v1/passenger/requests/:id`.
- `PATCH /api/v1/passenger/requests/:id/cancel`.
- `POST /api/v1/driver/routes`.
- `GET /api/v1/driver/routes`.
- `GET /api/v1/driver/routes/active`.
- `PATCH /api/v1/driver/routes/:id/deactivate`.
- `POST /api/v1/merchant/orders`.
- `GET /api/v1/merchant/orders`.
- `GET /api/v1/merchant/orders/:id`.
- `GET /api/v1/admin/dashboard`.
- `GET /api/v1/admin/drivers`.
- `GET /api/v1/admin/requests`.
- `GET /api/v1/admin/orders`.
- `GET /api/v1/admin/routes`.
- `POST /api/v1/matches/run`.
- `GET /api/v1/matches`.
- `GET /api/v1/matches/:id`.
- `POST /api/v1/merchant/orders/:id/batch`.
- `POST /api/v1/compare/run`.
- `GET /api/v1/compare/runs/:id`.
- `POST /api/v1/matches/:id/accept`.
- `POST /api/v1/matches/:id/reject`.
- `GET /api/v1/trips`.
- `GET /api/v1/trips/:id`.
- `POST /api/v1/trips/:id/status`.
- `POST /api/v1/trips/:id/simulate/step`.
- `POST /api/v1/trips/:id/simulate/reset`.
- `GET /api/v1/trips/:id/location`.

Demo reset protection:
- Admin JWT accepted if admin already exists.
- `x-demo-reset-key` accepted if it matches `DEMO_RESET_KEY`.
- Public unauthenticated reset without the key is rejected.

Auth login request:
```json
{
  "phone": "+970590000001",
  "password": "<DEMO_PASSENGER_PASSWORD>"
}
```

Auth login response:
```json
{
  "token": "<jwt>",
  "user": {
    "id": "...",
    "name": "Demo Passenger",
    "phone": "+970590000001",
    "role": "passenger",
    "demo_account": true
  }
}
```

Passenger create request example:
```json
{
  "pickup_label": "PPU Main Gate",
  "pickup_lat": 31.55,
  "pickup_lng": 35.1,
  "destination_label": "Bethlehem Center",
  "destination_lat": 31.7054,
  "destination_lng": 35.2024,
  "preferred_time": "2026-07-02T10:00:00.000Z",
  "passenger_count": 1
}
```

Driver create route example:
```json
{
  "seats_available": 2,
  "parcel_capacity_available": 5
}
```

Driver route rules:
- Route is automatically locked to Hebron / PPU / Bab Al-Zawiya -> Bethlehem.
- If optional route labels or corridor key are supplied and do not match the locked corridor, the API rejects the request.

Merchant create order example:
```json
{
  "pickup_label": "Hebron Merchant Pickup",
  "pickup_lat": 31.5326,
  "pickup_lng": 35.0998,
  "parcels": [
    {
      "destination_label": "Bethlehem Market",
      "destination_lat": 31.7054,
      "destination_lng": 35.2024,
      "size": "S",
      "priority": "normal"
    }
  ]
}
```

Run match example:
```json
{
  "passengerRequestId": "<passenger_request_id>"
}
```

Run match response includes:
```json
{
  "match": {
    "score": "0.9317",
    "method": "darb_route_score",
    "explanation": "Driver selected because the route matches the Hebron / PPU / Bab Al-Zawiya -> Bethlehem corridor, pickup is near the route, capacity is available, and trust score is high."
  },
  "scoringBreakdown": {
    "corridorOverlap": 0.95,
    "pickupDistanceScore": 0.827,
    "timingFit": 0.9,
    "trustScore": 0.86,
    "capacityFit": 1,
    "finalScore": 0.9317
  }
}
```

Role-filtered match inbox:
```http
GET /api/v1/matches
GET /api/v1/matches?status=proposed
```

Inbox rules:
- Authentication is required; missing authentication returns `401`.
- Driver sees only matches whose driver route belongs to the authenticated driver's profile.
- Passenger sees only matches whose passenger request belongs to the authenticated passenger.
- Merchant sees only matches whose merchant order belongs to the authenticated merchant.
- Admin sees all matches.
- Optional `status` accepts `proposed`, `sent_to_driver`, `accepted`, `rejected`, or `expired` from the existing `MatchStatus` enum.
- Invalid status returns `400`.
- Results use `created_at desc` ordering.

Inbox response shape:
```json
{
  "matches": [
    {
      "id": "<match_id>",
      "status": "proposed",
      "score": "0.9317",
      "method": "darb_route_score",
      "explanation": "...",
      "scoring_breakdown": {
        "corridorOverlap": 0.95,
        "pickupDistanceScore": 0.827,
        "timingFit": 0.9,
        "trustScore": 0.86,
        "capacityFit": 1,
        "finalScore": 0.9317,
        "estimatedDeviationKm": 1.92
      },
      "created_at": "<iso_datetime>",
      "driver_route": {
        "id": "<route_id>",
        "origin_label": "Hebron / PPU / Bab Al-Zawiya",
        "destination_label": "Bethlehem",
        "corridor_key": "hebron-ppu-bab-al-zawiya-to-bethlehem",
        "seats_available": 2,
        "parcel_capacity_available": 5,
        "status": "active",
        "driver": {
          "vehicle_type": "sedan",
          "verified": true,
          "trust_score": 86
        }
      },
      "passenger_request": {
        "id": "<request_id>",
        "pickup_label": "PPU Main Gate",
        "destination_label": "Bethlehem Center",
        "preferred_time": "<iso_datetime>",
        "passenger_count": 1,
        "status": "pending",
        "created_at": "<iso_datetime>"
      },
      "merchant_order": null,
      "parcel_batch": null
    }
  ]
}
```

Safe contract notes:
- Optional `passenger_request`, `merchant_order`, and `parcel_batch` summaries are `null` when not connected.
- Merchant order summary includes `id`, `pickup_label`, `status`, `parcel_count`, and `created_at`.
- Parcel batch summary includes `id`, `status`, `estimated_distance_saved`, `explanation`, and `created_at`.
- Password hashes, JWTs, reset keys, phone numbers, user ownership foreign keys, and unrelated personal fields are not serialized.
- `GET /api/v1/matches/:id` uses the same safe `match` summary and retains top-level `scoringBreakdown` for existing mobile/admin compatibility.

Create parcel batch:
```http
POST /api/v1/merchant/orders/<order_id>/batch
```

Run comparison example:
```json
{
  "scenarioKey": "darb_batch_wins",
  "passengerRequestId": "<passenger_request_id>",
  "merchantOrderId": "<merchant_order_id>"
}
```

Comparison response includes:
```json
{
  "comparison": {
    "darb_trips": 1,
    "nearest_driver_trips": 6,
    "darb_estimated_distance": "21.53",
    "nearest_estimated_distance": "129.18",
    "darb_estimated_cost": "43.06",
    "nearest_estimated_cost": "258.36",
    "parcel_batching_benefit": "5 parcels can use 1 Darb corridor trip instead of 5 nearest-driver parcel trips.",
    "driver_utilization": "1.00",
    "winner": "darb"
  }
}
```

Accept match:
```http
POST /api/v1/matches/<match_id>/accept
```

Reject match:
```http
POST /api/v1/matches/<match_id>/reject
```

Update trip status:
```json
{
  "status": "pickup_started"
}
```

Simulate tracking step:
```http
POST /api/v1/trips/<trip_id>/simulate/step
```

Latest location response:
```json
{
  "location": {
    "trip_id": "<trip_id>",
    "source": "simulated",
    "sequence": 1,
    "lat": "31.550000",
    "lng": "35.100000"
  }
}
```

Role and ownership rules:
- Passenger role only can create/list/view/cancel passenger requests.
- Passenger can only access own requests.
- Passenger cancellation is allowed only for `pending` or `matched` requests.
- Driver role only can create/list/deactivate routes.
- Driver can only access own routes through their driver profile.
- Driver route creation is locked to the single MVP corridor.
- Driver deactivation is allowed only for active routes.
- Merchant role only can create/list/view merchant orders.
- Merchant can only access own orders.
- Merchant order creation accepts 1 to 10 parcels.
- Admin role only can access admin read-only endpoints.
- Passenger can run/view match results for own passenger request.
- Merchant can run/view match results for own merchant order.
- Admin can run/view matches for seeded or explicit demo records.
- Driver can list and view matches connected to own driver routes.
- Passenger can list only matches connected to own passenger requests.
- Merchant can list only matches connected to own merchant orders.
- Admin can list all matches.
- Merchant can batch only own order.
- Admin can batch seeded/demo order.
- Admin only can run and read comparison runs.
- Driver can accept/reject only matches for own driver route.
- Admin can accept/reject demo matches.
- Driver can see/update own trips.
- Passenger can see trips connected to own request.
- Merchant can see trips connected to own order.
- Admin can see all trips.
- Only driver owner or admin can update trip status or trigger simulated tracking.
- Passenger, merchant, driver owner, and admin can read latest location when connected to the trip.

[MATCHING_LOGIC]
Implemented in M2B.

Seed data includes the locked corridor and demo route prerequisites needed for later matching work.

M2B matching filters:
- Driver route must be active.
- Driver route must use `hebron-ppu-bab-al-zawiya-to-bethlehem`.
- Driver profile must exist and be verified.
- Passenger count must fit `seats_available` when a passenger request is present.
- Parcel count must fit `parcel_capacity_available` when a merchant order is present.
- Inactive routes are ignored.

M2B scoring formula:
```text
score =
  0.40 * corridor_overlap
+ 0.25 * pickup_distance_score
+ 0.15 * timing_fit
+ 0.10 * trust_score
+ 0.10 * capacity_fit
```

Scoring breakdown fields:
- `corridorOverlap`.
- `pickupDistanceScore`.
- `timingFit`.
- `trustScore`.
- `capacityFit`.
- `finalScore`.
- `estimatedDeviationKm`.

Tie-breaks:
- Higher score.
- Lower estimated deviation.
- Higher trust score.
- Stable route id order for deterministic demo.

Batching rules:
- Uses parcels from the merchant order.
- Allows 1 to 10 parcels.
- Uses only the locked corridor.
- Requires a verified active driver route with enough parcel capacity.
- Produces one deterministic batch when capacity allows.
- Updates order status to `batched`.
- Produces judge-friendly explanation and estimated distance saved.

Comparison formulas:
- Corridor distance uses Haversine between Hebron/PPU/Bab Al-Zawiya and Bethlehem.
- `darb_trips = 1` when passenger or parcel demand exists.
- `nearest_driver_trips = passenger_request_count + parcel_count`.
- `estimated_cost = estimated_distance * 2`.
- `parcel_batching_benefit` explains trip reduction.
- `driver_utilization = (parcel_count + passenger_count) / (parcel_count + 1)` clamped by deterministic demand formula.
- Winner is `darb` when Darb cost and trips are less than or equal to nearest-driver baseline.

[TRIP_STATUS_LOGIC]
Implemented in M3A.

Match accept side effects:
- Match status becomes `accepted`.
- Trip status becomes `accepted`.
- DriverRoute status becomes `assigned`.
- PassengerRequest status becomes `accepted` if present.
- ParcelBatch status becomes `assigned` if present.
- MerchantOrder status becomes `assigned` if present.
- Parcels become `assigned` if merchant order is present.

Match reject side effects:
- Match status becomes `rejected`.
- No trip is created.

Approved trip flow:
```text
accepted -> pickup_started -> picked_up -> in_transit -> delivered -> completed
```

Allowed cancellation path:
```text
accepted/pickup_started/picked_up/in_transit -> cancelled
```

Status side effects:
- `pickup_started`: DriverRoute becomes `on_trip`.
- `picked_up`: PassengerRequest, ParcelBatch, and Parcels become `picked_up` when present.
- `in_transit`: PassengerRequest, MerchantOrder, ParcelBatch, and Parcels become `in_transit` when present.
- `delivered`: PassengerRequest, ParcelBatch, and Parcels become `delivered`; MerchantOrder becomes `completed`.
- `completed`: DriverRoute becomes `completed`; Trip `completed_at` is set.

[TRACKING_SIMULATION]
Implemented in M3A.

Behavior:
- Uses fixed route points for Hebron / PPU / Bab Al-Zawiya -> Bethlehem.
- `POST /api/v1/trips/:id/simulate/step` creates exactly one `LocationEvent`.
- Sequence starts at `0` and increments by one per simulated step.
- Coordinates repeat deterministically if sequence exceeds route path length.
- `GET /api/v1/trips/:id/location` returns latest event by sequence.
- No Socket.IO and no live GPS integration yet.

[ADMIN_DEMO_CONSOLE]
Implemented in M3B under `apps/admin`.

Features:
- One login screen using `POST /api/v1/auth/login`.
- Login screen displays seeded demo admin credentials for judge/demo use.
- Stores admin JWT in `localStorage` for hackathon demo use.
- Loads current admin via `GET /api/v1/me`.
- Demo Control panel can call `POST /api/v1/demo/reset` with reset key and/or admin JWT.
- Demo Control explains that reset recreates the deterministic judge scenario.
- Reset flow re-authenticates the admin because demo reset recreates seeded users.
- System Overview panel uses admin dashboard/list endpoints for counts and seeded records.
- Matching panel calls `POST /api/v1/matches/run` and displays selected route, score, breakdown, and explanation.
- Parcel Batch panel calls `POST /api/v1/merchant/orders/:id/batch` and displays batch id, parcel count, estimated distance saved, and explanation.
- Comparison panel calls `POST /api/v1/compare/run` and displays Darb vs nearest-driver metrics in a simple table.
- Trip Flow panel calls match accept/reject, lists trips, and advances the valid trip lifecycle.
- Tracking Simulation panel calls simulate step/reset and latest location polling.
- Full Demo Sequence button runs reset, login, dashboard inputs, match, batch, comparison, accept, complete status progression, and one tracking step.
- Full Demo Sequence displays step-by-step progress and stops with a clear surfaced error if a step fails.

Backend changes for M3B:
- No backend permission changes were required.
- Existing M3A permissions already allow admin to batch demo orders, accept/reject matches, update demo trips, and simulate tracking.

M3C QA/polish changes:
- No backend changes were required.
- Admin app HTML was served locally by Vite.
- API was served locally against PostgreSQL.
- Browser automation/visual inspection was not available in the current tool environment, so visual review must still be performed by opening the console in a browser.

Local admin CORS fix:
- API supports env-based `CORS_ORIGINS`.
- Default local origins include `http://localhost:5173`, `http://localhost:5174`, `http://localhost:5175`, and matching `127.0.0.1` origins.
- CORS preflight and login responses include `Access-Control-Allow-Origin` for allowed admin console origins.

M3D localization:
- Arabic and English are supported in the admin console.
- Arabic is the default language and RTL.
- English is optional and LTR.
- Language switch is available on login and authenticated dashboard.
- Switching language does not reload, reset authentication, or reset demo state.
- UI labels, buttons, notices, progress steps, roles, statuses, metrics, and demo explanations use the typed dictionary in `apps/admin/src/i18n/translations.ts`.
- Locale helpers, persistence, status/role/source label mapping, document `lang`/`dir`, and locale-aware formatting live in `apps/admin/src/i18n/locale.ts`.
- React provider/hook live in `apps/admin/src/i18n/LocaleContext.tsx`.
- Admin localization tests live in `apps/admin/src/i18n/locale.test.ts`.
- Backend enum/API values remain unchanged; translations are presentation-only.

[MOBILE_ANDROID_APP]
Implemented in M4B under `apps/mobile`.

Scope implemented:
- Android-only Flutter project `darb_mobile`.
- Android application ID: `ps.darb.mobile`.
- Welcome/app-shell route only at `/`.
- Arabic default locale with RTL.
- English optional locale with LTR.
- Language switch on the welcome shell.
- Locale persistence key: `darb_locale`.
- ARB/gen_l10n localization files:
  - `apps/mobile/l10n.yaml`.
  - `apps/mobile/lib/l10n/app_ar.arb`.
  - `apps/mobile/lib/l10n/app_en.arb`.
  - Flutter-generated `AppLocalizations` files.
- `API_BASE_URL` build configuration through `String.fromEnvironment`.
- Default development API base URL: `http://10.0.2.2:3000`.
- Debug Android cleartext HTTP enabled only in `android/app/src/debug/AndroidManifest.xml`.
- Main manifest includes internet permission.
- No GPS, live location, Socket.IO, auth, role, matching, trip, tracking, or payment code added.

Mobile API URL examples:
- Android emulator to host API: `--dart-define=API_BASE_URL=http://10.0.2.2:3000`.
- Physical Android phone to host API: `--dart-define=API_BASE_URL=http://<computer-lan-ip>:3000`.
- Future hosted demo API: `--dart-define=API_BASE_URL=https://<demo-api-domain>`.

Mobile match-inbox backend dependency:
- M4E1 resolved the backend gap with role-filtered `GET /api/v1/matches`.
- M4E2 now consumes this endpoint in the Flutter driver inbox and dashboard.

M4B Android runtime validation:
- Existing AVD found: `Medium_Phone_API_36.0`.
- Initial emulator boot got stuck as ADB `offline`; a cold boot with wiped emulator data recovered it.
- Runtime device: `emulator-5554`, `sdk gphone64 x86 64`, Android 16 API 36.
- App launched with `flutter run -d emulator-5554 --no-resident --dart-define=API_BASE_URL=http://10.0.2.2:3000`.
- `adb shell pm clear ps.darb.mobile` succeeded before runtime validation.
- Arabic opened by default and used RTL.
- English switch changed UI to English/LTR.
- English persisted after force-stop/relaunch.
- Switching back to Arabic persisted after force-stop/relaunch.
- API environment text showed `http://10.0.2.2:3000`.
- No Flutter counter-template UI, crash, overflow, or visibly broken layout was observed.
- Screenshots captured under `C:\Users\basha\AppData\Local\Temp\opencode`:
  - `darb_m4b_ar.png`.
  - `darb_m4b_en.png`.
  - relaunch verification screenshots for both languages.

[MOBILE_AUTH_AND_ROLE_ROUTING]
Implemented in M4C under `apps/mobile`.

Scope implemented:
- API client uses existing `String.fromEnvironment('API_BASE_URL')` through `AppConfig`.
- API client calls only `POST /api/v1/auth/login` and `GET /api/v1/me`.
- API client sends JSON headers and `Authorization: Bearer <token>` when a token is provided.
- API timeout is 12 seconds.
- API errors are mapped to network, timeout, validation, unauthorized, forbidden, server, and unknown categories.
- Error objects and `toString()` do not include raw JWT or password values.
- DTO parsing is manual and typed; no code generation or JSON annotation package was added.
- JWT is stored only in Flutter secure storage key `darb_jwt`.
- Passwords, raw login payloads, and JWTs are not stored in shared preferences.
- Locale remains stored in shared preferences key `darb_locale`.
- Riverpod owns auth/session state, login action state, logout, restored user, and role routing inputs.
- go_router routes:
  - `/splash`.
  - `/login`.
  - `/passenger`.
  - `/driver`.
  - `/merchant`.
  - `/unsupported-role`.
- Unauthenticated users route to `/login`.
- Passenger routes to `/passenger`.
- Driver routes to `/driver`.
- Merchant routes to `/merchant`.
- Admin routes to `/unsupported-role`.
- Users cannot manually navigate to another role route because redirects always return them to their own role route.
- Unsupported admin message is localized as:
  - Arabic: `لوحة تحكم المسؤول متاحة عبر تطبيق الويب.`
  - English: `The admin console is available through the web application.`
- Role home shells show Darb branding, current user name, role label, locked corridor, language switch, logout, workspace-ready copy, and clearly labeled coming-next copy.
- No passenger request, driver route, merchant order, match list, match decision, trip, tracking, AI, Socket.IO, GPS, map, registration, refresh-token, or payment feature was implemented.

M4C mobile translations:
- Arabic and English ARB entries added for splash/session restoration, login, phone, password, show/hide password, sign-in, demo accounts, passenger, driver, merchant, admin, logout, errors, retry, role workspace, locked corridor label, coming-next copy, and unsupported admin mobile role.
- Arabic remains default.
- English remains optional and persisted independently of auth state.
- Phone fields and demo phone labels render LTR inside Arabic layouts.

[MOBILE_PASSENGER_FLOW]
Implemented in M4D under `apps/mobile`.

Routes:
- `/passenger`: passenger dashboard.
- `/passenger/request/new`: locked-corridor create request form.
- `/passenger/request/:id`: passenger-owned request detail.
- `/passenger/match/:id`: passenger-owned match result detail.
- `/passenger/trip/:id`: passenger-owned trip and latest location detail.

Endpoint-to-screen mapping:
- Passenger dashboard uses `GET /api/v1/passenger/requests/active` and `GET /api/v1/trips`.
- Create request uses `POST /api/v1/passenger/requests`.
- Request detail uses `GET /api/v1/passenger/requests/:id`.
- Cancel request uses `PATCH /api/v1/passenger/requests/:id/cancel`.
- Matching action uses `POST /api/v1/matches/run` with `{ "passengerRequestId": "<id>" }`.
- Match detail uses `GET /api/v1/matches/:id`.
- Passenger trip detail uses `GET /api/v1/trips/:id` and `GET /api/v1/trips/:id/location`.

Locked corridor form:
- No city selection.
- Pickup presets:
  - `PPU Main Gate`, latitude `31.550000`, longitude `35.100000`.
  - `Bab Al-Zawiya`, latitude `31.532600`, longitude `35.099800`.
- Destination is fixed to `Bethlehem Center`, latitude `31.705400`, longitude `35.202400`.
- Passenger count limited to 1 through 4 to match backend validation.
- Preferred time is sent as ISO UTC.
- API payload fields remain backend snake_case and enum/status values are not translated before submission.

Passenger matching behavior:
- Displays selected driver/route, match status, final score, scoring breakdown, and backend explanation.
- Breakdown labels are localized and values are formatted as percentages.
- No raw JSON is shown.
- No compatible driver errors render a localized empty state.
- The M4D passenger UI does not use the role-filtered `GET /api/v1/matches` endpoint added later in M4E1.

Passenger trip polling behavior:
- Trip detail polls detail every 5 seconds.
- Latest location polls every 3 seconds.
- Polling starts while the screen is visible.
- Polling stops when provider/screen is disposed.
- App lifecycle pause/inactive stops timers.
- App lifecycle resume restarts timers without duplicate timers.
- Stale state is shown when a returned location is older than 5 minutes.
- Passenger cannot mutate trip status or trigger tracking simulation.

M4D mobile translations:
- Arabic and English ARB entries added for passenger dashboard, active request, create request, pickup presets, destination, preferred time, passenger count, submit, request detail, cancel, match action, match result, scoring breakdown, trip detail, latest location, status labels, and refresh/retry states.
- Arabic remains default; English remains optional and persisted independently of auth/session state.
- Request IDs, match IDs, trip IDs, coordinates, and phone numbers remain readable LTR where used.

[MOBILE_DRIVER_FLOW]
Implemented in M4E2 under `apps/mobile`.

Role-protected routes:
- `/driver`: driver dashboard.
- `/driver/route`: locked-corridor route detail/create/deactivate.
- `/driver/matches`: role-filtered match inbox.
- `/driver/match/:id`: driver-owned match detail and accept/reject.
- `/driver/trip/:id`: driver-owned trip lifecycle and deterministic tracking.

Endpoint mapping:
- Dashboard: `GET /api/v1/driver/routes`, `GET /api/v1/matches`, `GET /api/v1/trips`.
- Route flow: `GET /api/v1/driver/routes`, `GET /api/v1/driver/routes/active`, `POST /api/v1/driver/routes`, `PATCH /api/v1/driver/routes/:id/deactivate`.
- Match flow: `GET /api/v1/matches`, optional `?status=proposed`, `GET /api/v1/matches/:id`, `POST /api/v1/matches/:id/accept`, `POST /api/v1/matches/:id/reject`.
- Trip flow: `GET /api/v1/trips`, `GET /api/v1/trips/:id`, `POST /api/v1/trips/:id/status`.
- Tracking: `POST /api/v1/trips/:id/simulate/step`, `POST /api/v1/trips/:id/simulate/reset`, `GET /api/v1/trips/:id/location`.

Locked driver route:
- Origin: `Hebron / PPU / Bab Al-Zawiya`, latitude `31.532600`, longitude `35.099800`.
- Destination: `Bethlehem`, latitude `31.705400`, longitude `35.202400`.
- Corridor key: `hebron-ppu-bab-al-zawiya-to-bethlehem`.
- Backend owns and persists the fixed coordinates; mobile submits only the accepted locked labels/corridor and selected capacities.
- Driver may select seats from backend-compatible `0..8` and parcel capacity from `0..20`; raw coordinates and city selection are not editable.
- Operational route summary includes `active`, `assigned`, and `on_trip`; deactivation is rendered only for `active` routes.

Driver match behavior:
- Inbox consumes only the safe M4E1 response and never displays raw JSON, credentials, phone numbers, or owner foreign keys.
- Proposed and sent-to-driver assignments are grouped first; each group remains newest first.
- Cards show assignment type, pickup/destination, passenger/parcel counts, batch savings when present, final score, status, created time, and explanation.
- Detail shows corridor overlap, pickup-distance score, timing fit, trust score, capacity fit, related assignment summaries, explanation, and status.
- Accept/reject buttons exist only for `proposed` and `sent_to_driver`, are disabled during requests, and refresh after conflicts.

Driver trip and tracking behavior:
- UI sequence is strictly `accepted -> pickup_started -> picked_up -> in_transit -> delivered -> completed`.
- Only one valid next action is rendered; completed/cancelled trips render no transition action.
- Status mutations remain backend-authoritative and conflict errors trigger a translated refresh.
- Trip detail polls every 5 seconds; latest location polls every 3 seconds.
- Poll failures preserve the last known good state; explicit action failures are surfaced.
- App pause/inactive stops timers; resume restarts them; provider disposal cancels them; repeated resume does not duplicate timers.
- Simulation uses the backend's seven deterministic route points and shows latitude, longitude, sequence, source, recorded time, and progress without a map.

M4E2 localization:
- All driver dashboard, route, inbox, match action, trip action, tracking, error, and status text is present in Arabic and English ARB files.
- Arabic remains default RTL; English remains optional LTR; `darb_locale` persistence is unchanged.
- Technical IDs and coordinates are rendered LTR where needed.

[MOBILE_MERCHANT_FLOW]
Implemented in M4F under `apps/mobile`.

Role-protected routes:
- `/merchant`: merchant dashboard with latest order, latest persisted batch, role-filtered match count, and connected active trip.
- `/merchant/order/new`: locked-corridor order form.
- `/merchant/order/:id`: merchant-owned order, parcels, persisted batch, match, and connected-trip actions.
- `/merchant/matches`: merchant-owned role-filtered match inbox.
- `/merchant/match/:id`: safe read-only merchant match detail.
- `/merchant/trip/:id`: read-only connected trip, order, parcel, and latest-location state.

Endpoint mapping:
- Orders: `GET /api/v1/merchant/orders`, `GET /api/v1/merchant/orders/:id`, and `POST /api/v1/merchant/orders`.
- Batching: `POST /api/v1/merchant/orders/:id/batch`.
- Matching: `POST /api/v1/matches/run` with `{ "merchantOrderId": "<id>" }`, `GET /api/v1/matches`, optional `?status=proposed`, and `GET /api/v1/matches/:id`.
- Trips and tracking: `GET /api/v1/trips`, `GET /api/v1/trips/:id`, and `GET /api/v1/trips/:id/location`.
- Merchant screens never call match accept/reject, trip mutation, simulation step, or simulation reset endpoints.

Locked order form:
- Pickup is fixed to `Hebron Merchant Pickup`, latitude `31.532600`, longitude `35.099800`.
- Destination choices are limited to the seeded route-compatible Bethlehem presets: `Bethlehem Market`, `Bethlehem University Area`, `Manger Street`, `Beit Jala Junction`, and `Bethlehem Center` at latitude `31.705400`, longitude `35.202400`.
- Each parcel selects only a destination preset, backend enum size `S|M|L`, and backend enum priority `low|normal|high`.
- The form enforces 1 through 10 parcel rows, never exposes coordinate fields, disables submission while running, preserves rows after API failures, and navigates to the new order detail after success.
- Arabic labels are displayed to the user while backend labels and enum values remain English in API payloads.

Batching and matching behavior:
- Order detail renders every parcel, its size/priority/status, latest persisted batch status, estimated distance benefit, and backend explanation.
- Batch action is available only for a submitted order without a persisted batch; backend `order_already_batched`, invalid state, and unavailable capacity responses are translated and followed by an authoritative refresh.
- Matching becomes available after a batch exists and is hidden while an existing proposed, sent-to-driver, or accepted match exists.
- Match inbox consumes the M4E1 safe role-filtered contract; cards and detail show order, route, score, status, scoring breakdown, explanation, and batch summary when connected.
- Merchant match detail is explicitly read-only and contains no accept/reject controls.

Merchant trip polling behavior:
- Connected trip detail and merchant order detail each poll every 5 seconds using separate guarded timers.
- Latest location polls every 3 seconds using its own guarded timer.
- App lifecycle pause/inactive/detached stops all timers; resume restarts them; provider disposal cancels them; repeated resume cannot duplicate timers.
- Poll failures preserve the last good state.
- Trip detail shows the locked route, status timeline, order state, each parcel state, latitude, longitude, sequence, source, recorded time, and deterministic progress without maps or GPS.
- Trip and tracking screens are read-only for merchants.

M4F backend contract correction:
- `GET /api/v1/merchant/orders` and `GET /api/v1/merchant/orders/:id` now include newest-first `parcel_batches` with only batch fields and a safe route summary, so batch state survives app relaunch.
- Batch route summaries exclude driver ownership/profile fields and other personal data.
- `POST /api/v1/merchant/orders/:id/batch` now rejects an existing batch with `409 order_already_batched` and accepts only the `submitted` state, preventing duplicate batches.
- No Prisma schema or migration change was required.

M4F localization:
- Merchant dashboard, order form, parcel fields, batch flow, matching inbox/detail, waiting-for-driver copy, trip/order/location state, errors, priorities, and merchant-specific statuses are present in Arabic and English ARB files.
- Arabic remains default RTL, English remains optional LTR, and `darb_locale` plus secure JWT restoration are unchanged.
- Technical IDs and coordinates remain LTR where needed.

[DEMO_MODE]
Implemented endpoint:
- `POST /api/v1/demo/reset`.

Seeded demo accounts:
- Passenger: `+970590000001` / local `DEMO_PASSENGER_PASSWORD` value.
- Driver 1: `+970590000002` / local `DEMO_DRIVER_PASSWORD` value.
- Driver 2: `+970590000003` / local `DEMO_DRIVER_PASSWORD` value.
- Merchant: `+970590000004` / local `DEMO_MERCHANT_PASSWORD` value.
- Admin: `+970590000005` / local `DEMO_ADMIN_PASSWORD` value.

Seeded demo data:
- Locked corridor: Hebron / PPU / Bab Al-Zawiya -> Bethlehem.
- Driver profiles.
- One active driver route on the locked corridor.
- One inactive alternate driver route.
- One pending passenger request.
- One submitted merchant order.
- Five parcels.
- Three demo comparison scenario records.

[SECURITY_AND_PRIVACY]
Implemented:
- Seeded demo-account login.
- JWT auth for protected route.
- `/api/v1/demo/reset` bootstrap protection via admin JWT or `x-demo-reset-key`.
- Password hashing with bcryptjs.
- Structured audit records for login and reset.
- Zod validation for login input.

Not implemented yet:
- Rate limiting.
- Full role matrix beyond M1 routes.
- Production logging sink.

[TESTING_STRATEGY]
Implemented minimal tests:
- Auth login validation and JWT issue path with mocked Prisma.
- Demo reset rejects missing reset key.
- Demo reset succeeds with valid reset key and mocked Prisma transaction.
- Passenger request create/read ownership/cancel tests.
- Driver route create/locked-corridor/deactivate ownership tests.
- Merchant order create/ownership/parcel-count tests.
- Admin dashboard/list authorization tests.
- Matching route-compatible route beats wrong-direction route.
- Matching ignores inactive/unverified routes through candidate query.
- Matching rejects capacity mismatch.
- Matching rejects non-owner access.
- Matching returns persisted scoring breakdown.
- Match inbox rejects unauthenticated requests.
- Match inbox applies driver-route, passenger-request, merchant-order, and admin-all role filters.
- Match inbox validates status filtering and newest-first ordering.
- Match inbox and detail responses include scoring and related summaries while excluding sensitive fields.
- Match detail allows the connected driver, passenger, merchant, and admin, and rejects unrelated users.
- Batching own order succeeds.
- Batching rejects non-merchant/non-admin.
- Batching rejects another merchant's order.
- Batching rejects invalid order state.
- Comparison admin run succeeds and persists.
- Comparison rejects non-admin.
- Comparison GET returns saved run.
- Match accept/reject tests.
- Trip visibility tests for driver, passenger, merchant, admin, and unrelated user.
- Trip status transition tests.
- Status side-effect tests.
- Simulated tracking step tests.
- Latest location polling tests.
- Admin console TypeScript typecheck.
- Admin console production build.
- Admin localization tests for Arabic default, saved English restore, document `lang`/`dir`, persistence, translation lookup, unknown-key fallback, and status label mapping.
- Mobile app-shell tests for Arabic default, RTL direction, English switching, LTR direction, `darb_locale` persistence, saved English restoration, `API_BASE_URL` config, and absence of Flutter counter-template content.
- Mobile auth repository tests for successful login parsing, failed login mapping, `/me` parsing, authorization header sending, and avoiding raw-token exposure in errors.
- Mobile auth controller tests for no-token login state, valid saved-token restoration, 401 token removal, temporary network failure preserving token with retry state, and logout token removal.
- Mobile routing/widget tests for passenger, driver, merchant, unsupported admin, role-route protection, Arabic RTL login, English LTR switch, demo preset fill, loading disabled button, translated invalid credentials, logout returning to login, and locale preservation after logout.
- Mobile M4D repository tests for passenger request list/active/detail parsing, create request payload, cancel request, match run/scoring breakdown parsing, trip list/detail parsing, latest-location parsing, and backend error mapping.
- Mobile M4E2 repository tests for route list/active parsing, locked create payload, deactivation, match inbox/filter/detail, accept/reject, trip list/detail/status payload, simulation step/reset, and latest-location parsing.
- Mobile M4E2 controller tests for dashboard success/empty/error, route creation conflict and deactivation failure, inbox empty/order/filter/error, accept/reject refresh, valid next status, and polling lifecycle/timer deduplication.
- Mobile M4E2 routing/widget tests for driver-only routes, passenger/merchant/unauthenticated redirects, Arabic RTL and English LTR, locked route form without editable coordinates, safe match summaries, scoring detail, accept/reject loading state, valid-only trip action, and simulated location progress.
- Mobile M4F repository/controller/widget tests for locked merchant order creation, persisted batching, safe merchant matching, read-only connected trip observation, polling lifecycle, localization, and role-route protection.
- M5A API regression proves a combined match carries the newest merchant parcel batch into its accepted trip.
- M5A mobile controller regressions prove passenger, driver, and merchant dashboard refresh failures enter visible error state; localized match/tracking widget assertions cover Arabic explanations and simulated-source labels.

Required validation commands:
- `npm install`.
- `npm run typecheck`.
- `npm run prisma:validate`.
- `npm run prisma:generate`.
- `npm run test`.
- `npm run db:migrate` applies the checked-in MySQL migration history with `prisma migrate deploy`.
- `npm run db:migrate:status` verifies the MySQL migration state.
- `npm run build`.
- `npm run typecheck:admin`.
- `npm run test:admin`.
- `npm run build:admin`.
- Endpoint validation against local API and MySQL.
- Mobile: `flutter pub get`, `flutter gen-l10n`, `dart format --set-exit-if-changed .`, `flutter analyze`, `flutter test`, and the port-3000 debug APK build.
- Demo: `npm run demo:preflight` and `npm run demo:smoke`.
- `npm audit --omit=dev`.

Prisma config behavior:
- `apps/api/prisma.config.ts` uses `DATABASE_URL` when set.
- For schema validation/generation without a local `.env`, it uses a non-secret placeholder MySQL URL.
- Real database operations require a reachable MySQL `darb` database.
- The approved release migration mechanism is `npm run db:migrate`, not `db push`.

[MILESTONES]
M1 Foundation And Demo Reset target:
- Backend starts.
- PostgreSQL schema exists.
- Prisma validation passes.
- Seeded demo accounts exist after reset.
- Demo corridor exists after reset.
- Demo reset endpoint works with protection.
- Auth login works for all four roles after reset.
- `/api/v1/me` works.

M1 validation results:
- `npm install`: passed.
- `npm run prisma:validate`: passed.
- `npm run prisma:generate`: passed.
- `npm run typecheck`: passed.
- `npm run test`: passed, 2 files and 4 tests.
- `npm run build`: passed.
- `npm run db:push`: passed against `postgresql://postgres:postgres@localhost:5432/darb?schema=public`; database `darb` was created/synced.
- Real API validation: passed for `GET /api/v1/health`, `POST /api/v1/demo/reset`, `POST /api/v1/auth/login` for passenger/driver/merchant/admin, and `GET /api/v1/me` for each role.
- `npm audit --omit=dev`: reports 3 moderate findings through Prisma CLI transitive `@hono/node-server`; `npm audit fix --force` would install `prisma@6.19.3`, a breaking downgrade, so it was not applied.

M2A validation results:
- Pre-step M1 validation passed: `npm run prisma:validate`, `npm run prisma:generate`, `npm run typecheck`, `npm run test`, `npm run build`.
- Git initialized and M1 committed as `chore: initialize Darb foundation`.
- `npm run prisma:validate`: passed.
- `npm run prisma:generate`: passed.
- `npm run typecheck`: passed.
- `npm run test`: passed, 3 files and 21 tests.
- `npm run build`: passed.
- `npm run db:push`: passed against local PostgreSQL.
- Real M2A smoke validation passed for health, demo reset, auth, `/me`, passenger request create/list-active/read/cancel, driver route create/list/list-active/deactivate, merchant order create/list/detail, and admin dashboard/list endpoints.

M2B validation results:
- Pre-step git status: clean.
- Pre-step validation passed: `npm run prisma:validate`, `npm run prisma:generate`, `npm run typecheck`, `npm run test`, `npm run build`.
- `npm run prisma:validate`: passed.
- `npm run prisma:generate`: passed.
- `npm run typecheck`: passed.
- `npm run test`: passed, 4 files and 34 tests.
- `npm run build`: passed.
- `npm run db:push`: passed against local PostgreSQL.
- Real M2B smoke validation passed for demo reset, match run/read, merchant batch, comparison run/read.
- Real smoke output included match score `0.9317`, batch status `created`, estimated distance saved `86.12`, comparison winner `darb`, Darb trips `1`, nearest-driver trips `6`.

M3A validation results:
- Migration integrity check completed.
- Corrective migration commit created: `chore: normalize Prisma migrations`.
- Pre-step validation passed: `npm run prisma:validate`, `npm run prisma:generate`, `npm run db:push`, `npm run typecheck`, `npm run test`, `npm run build`.
- `npm run prisma:validate`: passed.
- `npm run prisma:generate`: passed.
- `npm run typecheck`: passed.
- `npm run test`: passed, 5 files and 47 tests.
- `npm run build`: passed.
- `npm run db:push`: passed against local PostgreSQL.
- Real M3A smoke validation passed against local PostgreSQL for `GET /api/v1/health`, `POST /api/v1/demo/reset`, login as admin/passenger/driver/merchant, `GET /api/v1/me`, match run, parcel batch, comparison run/read, match accept, full trip status progression to `completed`, simulated tracking step, and latest location polling.
- Real smoke output included dashboard users `5`, match status `proposed`, match score `0.9317`, batch status `created`, comparison winner `darb`, accepted trip status `accepted`, final trip status `completed`, simulated location sequence `0`, latest sequence `0`, latest source `simulated`.

M3B validation results:
- `npm install`: passed; reported existing 3 moderate audit findings, and `npm audit fix --force` was not run.
- `npm run prisma:validate`: passed.
- `npm run prisma:generate`: passed.
- `npm run typecheck:api`: passed.
- `npm run test`: passed, 5 files and 47 tests.
- `npm run build:api`: passed.
- `npm run typecheck:admin`: passed.
- `npm run build:admin`: passed.
- `npm run typecheck`: passed for admin and API workspaces.
- `npm run build`: passed for admin and API workspaces.
- Real M3B smoke validation passed against local PostgreSQL for demo reset, admin login, dashboard load, admin routes/requests/orders load, match run/read, parcel batch, comparison run/read, match accept, full status progression to `completed`, trips list, simulated tracking step, and latest location polling.
- Real smoke output included dashboard users `5`, routes `2`, requests `1`, orders `1`, match score `0.9317`, batch status `created`, distance saved `86.12`, comparison winner `darb`, trip count `1`, final status `completed`, location sequence `0`, latest source `simulated`.

M3C validation results:
- Pre-step `git status`: clean.
- Pre-step `npm run prisma:validate`: passed.
- Pre-step `npm run prisma:generate`: passed.
- Pre-step `npm run typecheck`: passed for admin and API workspaces.
- Pre-step `npm run test`: passed, 5 files and 47 tests.
- Pre-step `npm run build`: passed for admin and API workspaces.
- Local API dev server started with PostgreSQL on port `3100`.
- Local admin Vite server started and served the app HTML on port `5174` via IPv6 loopback.
- Local full demo API sequence passed for demo reset, admin login, dashboard/routes/requests/orders load, match run, parcel batch, comparison run, match accept, trip progression to `completed`, tracking step, and latest location.
- Local smoke output included users `5`, routes `2`, requests `1`, orders `1`, match score `0.9317`, batch status `created`, comparison winner `darb`, final status `completed`, location sequence `0`, latest sequence `0`.
- Final `npm run prisma:validate`: passed.
- Final `npm run prisma:generate`: passed.
- Final `npm run typecheck`: passed for admin and API workspaces.
- Final `npm run test`: passed, 5 files and 47 tests.
- Final `npm run build`: passed for admin and API workspaces.
- Final `npm run typecheck:admin`: passed.
- Final `npm run build:admin`: passed.
- Visual browser inspection could not be performed from the current tool environment; remaining manual check is to open the admin app in a browser and click through the full demo path.

M3D validation results:
- `npm install`: passed; reported existing 3 moderate audit findings, and `npm audit fix --force` was not run.
- `git status`: showed only intended M3D files before commit.
- `npm run prisma:validate`: passed.
- `npm run prisma:generate`: passed.
- `npm run typecheck`: passed for admin and API workspaces.
- `npm run test`: passed, 5 files and 48 API tests.
- `npm run build`: passed after rerunning sequentially once Prisma generation completed.
- `npm run typecheck:admin`: passed.
- `npm run build:admin`: passed.
- `npm run test:admin`: passed, 1 file and 7 tests.
- Admin localization tests cover Arabic default, saved English restore, document `lang`/`dir`, persistence, translation lookup, unknown-key fallback, and status labels without changing API values.
- Local API dev server started with PostgreSQL on port `3103`.
- Local admin Vite server started and served the app on port `5175`.
- Local full backend demo smoke passed after localization changes: reset, admin login, dashboard, match, batch, comparison, accept, status progression to `completed`, tracking step, and latest location.
- Local smoke output included users `5`, match score `0.9317`, batch status `created`, comparison winner `darb`, final status `completed`, location sequence `0`, latest sequence `0`.
- Interactive browser visual inspection could not be performed from the current tool environment; remaining manual check is to clear `darb_locale`, open the admin console, confirm Arabic RTL default, login and run demo flow in Arabic, switch to English, refresh to confirm English persists, switch back to Arabic, and confirm auth/demo state remain functional.

M4B validation results:
- Initial toolchain inspection found Flutter, Dart, and adb missing from PATH.
- Flutter stable installed to `C:\Users\basha\development\flutter` and added to user PATH.
- Android platform-tools added to user PATH.
- Android command-line tools installed under `C:\Users\basha\AppData\Local\Android\Sdk\cmdline-tools\latest`.
- `flutter channel stable`: completed.
- `flutter upgrade`: Flutter already current on stable.
- `flutter config --android-sdk "C:\Users\basha\AppData\Local\Android\Sdk"`: completed.
- `flutter doctor --android-licenses`: all SDK licenses accepted.
- Installed missing Android SDK Platform 36 and Android Build Tools 28.0.3 to satisfy Flutter doctor.
- Final `flutter --version`: Flutter 3.44.6 stable, Dart 3.12.2.
- Final `dart --version`: Dart 3.12.2 stable.
- Final `flutter doctor -v`: no issues found; Android toolchain ready with Android SDK 36.0.0 and Android Studio bundled JDK OpenJDK 21.0.6.
- `flutter pub get`: passed.
- `flutter gen-l10n`: passed.
- `dart format --set-exit-if-changed .`: passed after formatting.
- `flutter analyze`: passed, no issues.
- `flutter test`: passed, 5 tests.
- `flutter build apk --debug --dart-define=API_BASE_URL=http://10.0.2.2:3000`: passed.
- Debug APK output: `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`.
- `flutter devices`: no Android emulator or physical Android device connected; Windows, Chrome, and Edge only.
- `adb devices`: no Android devices attached.
- Existing repo regression passed: `npm run prisma:validate`, `npm run prisma:generate`, `npm run typecheck`, `npm run test`, and sequential `npm run build`.

M4B runtime validation results:
- Repository baseline before runtime validation was clean at commit `a00ed58 feat: initialize Arabic-first Flutter app`.
- Existing AVD `Medium_Phone_API_36.0` found through emulator list.
- AVD cold boot with wiped emulator data became visible as `emulator-5554`.
- `flutter devices` reported `sdk gphone64 x86 64 (mobile)`, Android 16 API 36.
- App data cleared with `adb shell pm clear ps.darb.mobile`.
- Runtime launch passed with `flutter run -d emulator-5554 --no-resident --dart-define=API_BASE_URL=http://10.0.2.2:3000`.
- Arabic default, RTL, English/LTR switch, relaunch persistence for English, relaunch persistence for Arabic, configured API URL, no counter-template UI, and no visible crash/overflow were verified.
- No M4B code fix was needed and no separate M4B fix commit was created.

M4C validation results:
- Added dependency versions: `http 1.6.0`, `flutter_secure_storage 10.3.1`.
- `flutter pub get`: passed.
- `flutter gen-l10n`: passed.
- `dart format --set-exit-if-changed .`: passed.
- `flutter analyze`: passed, no issues.
- `flutter test`: passed, 22 mobile tests.
- `flutter build apk --debug --dart-define=API_BASE_URL=http://10.0.2.2:3000`: passed.
- Debug APK output: `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`.
- Existing repo regression passed: `npm run prisma:validate`, `npm run prisma:generate`, `npm run typecheck`, `npm run test`, and `npm run build`.

M4C Android runtime smoke:
- API started locally with `npm run dev:api` using local PostgreSQL URL, development JWT secret, and demo reset key.
- API health returned `{"ok":true,"service":"darb-api"}`.
- Demo data reset passed with `POST /api/v1/demo/reset` and `x-demo-reset-key`.
- Mobile launched on `emulator-5554` with `API_BASE_URL=http://10.0.2.2:3000`.
- Cleared app data before smoke.
- Arabic default login screen verified.
- Passenger demo account logged in and routed to passenger home shell.
- Force-stop/relaunch restored passenger session through `/api/v1/me`.
- Logout returned to login and preserved Arabic locale.
- Driver demo account logged in and routed to driver home shell.
- Merchant demo account logged in and routed to merchant home shell.
- Invalid password showed translated invalid-credentials error.
- English switch changed login UI to LTR English.
- Force-stop/relaunch preserved English selection.
- No crash, overflow, or visibly broken layout was observed during smoke.
- Runtime screenshots captured under `C:\Users\basha\AppData\Local\Temp\opencode`, including Arabic login, passenger restore, driver, merchant, invalid-password, English, and English relaunch screenshots.

M4D validation results:
- Pre-step repository baseline was clean at `a72e876 feat: add mobile auth and role routing`.
- Pre-step mobile validation passed: `flutter pub get`, `flutter gen-l10n`, `flutter analyze`, `flutter test`.
- Pre-step workspace validation passed: `npm run prisma:validate`, `npm run prisma:generate`, `npm run typecheck`, `npm run test`, `npm run build`.
- Backend contracts inspected directly before implementation: `passenger.ts`, `matching.ts`, `trips.ts`, `demoReset.ts`, and this project map.
- No backend contract mismatch blocked M4D.
- No backend code changes were made.
- `flutter pub get`: passed.
- `flutter gen-l10n`: passed.
- `dart format --set-exit-if-changed .`: passed.
- `flutter analyze`: passed, no issues.
- `flutter test`: passed, 25 mobile tests.
- `flutter build apk --debug --dart-define=API_BASE_URL=http://10.0.2.2:3000`: passed.
- Debug APK output: `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`.
- Existing repo regression passed: `npm run prisma:validate`, `npm run prisma:generate`, `npm run typecheck`, `npm run test`, `npm run build`.

M4D Android runtime smoke:
- Emulator: `emulator-5554`, `Medium_Phone_API_36.0`, Android 16 API 36.
- API started locally with local PostgreSQL URL, development JWT secret, and demo reset key.
- API health returned `{"ok":true,"service":"darb-api"}`.
- Demo data reset passed with `POST /api/v1/demo/reset` and `x-demo-reset-key`.
- App data cleared before runtime smoke.
- App launched with `flutter run -d emulator-5554 --no-resident --dart-define=API_BASE_URL=http://10.0.2.2:3000`.
- Arabic default verified.
- Passenger login verified.
- Passenger dashboard loaded and showed seeded active request.
- Request detail opened and showed LTR request ID, pickup, destination, preferred time, count, status, and created time.
- Matching ran for the passenger request and showed selected route, score, scoring breakdown, and explanation.
- Seeded request cancellation was verified when backend state permitted it.
- New locked-corridor request was created from the passenger form and opened in detail.
- Matching ran for the new request and displayed result.
- Existing admin API was used outside the passenger app to accept the generated match and simulate one location event.
- Passenger dashboard showed connected trip after relaunch/session restoration.
- Passenger trip detail showed accepted status and latest simulated location with latitude, longitude, sequence, source, and recorded time.
- English switch changed UI to LTR English.
- Force-stop/relaunch preserved passenger session and English locale.
- Passenger app did not show driver/merchant accept/reject, trip mutation, or simulation controls.
- Runtime screenshots captured under `C:\Users\basha\AppData\Local\Temp\opencode`, including dashboard, request detail, match, cancel result, create form, created request, trip detail, and English relaunch.

M4E1 validation results:
- Repository baseline was clean on `master` at `cb0ff92 feat: add passenger mobile flow`.
- No remote is configured for this repository.
- No Prisma schema or migration files changed.
- `npm run prisma:validate`: passed.
- `npm run prisma:generate`: passed with Prisma 7.8.0.
- `npm run typecheck`: passed for admin and API workspaces.
- `npm run test`: passed, 6 API test files and 57 tests.
- `npm run build`: passed for admin and API workspaces.
- `flutter pub get`: passed.
- `flutter gen-l10n`: passed.
- `dart format --set-exit-if-changed .`: passed, 42 files checked and 0 changed.
- `flutter analyze`: passed with no issues.
- `flutter test`: passed, 25 mobile tests.
- Focused M4E1 test file contains 9 tests covering authentication, all four role filters, newest-first ordering, safe summaries, scoring breakdown, valid/invalid status filters, and detail ownership consistency.

M4E1 real PostgreSQL smoke:
- Local PostgreSQL on port `5432` and a temporary API on port `3110` were used; demo data was reset through the protected real endpoint.
- Passenger, both drivers, merchant, and admin logged in through the real auth endpoint.
- Passenger matching created match `cmrixqnun000qkkhnwkoufhvk` and merchant matching created match `cmrixqnvb000skkhna1zahtjo`.
- Selected driver inbox returned both connected matches; alternate driver inbox returned zero.
- Passenger inbox returned exactly the passenger match; merchant inbox returned exactly the merchant match; admin inbox returned both.
- Admin results were newest first and included scoring breakdown and the safe summary contract without sensitive ownership or credential fields.
- Connected driver detail returned `200`; unrelated driver detail returned `403`.
- After the passenger match was accepted, `status=proposed` returned only the merchant match and `status=accepted` returned only the passenger match.
- Invalid status returned `400`.

M4E1 independent audit before M4E2:
- Audited `PROJECT_MAP.md`, `apps/api/src/modules/matching.ts`, `apps/api/src/tests/matchInbox.test.ts`, Prisma `Match` relations, list ownership scopes, safe serialization, and detail ownership.
- Confirmed the M4E1 commit added no Prisma schema or migration change.
- Fresh regression passed unchanged: Prisma validation/generation, workspace typecheck, 6 API files/57 tests, workspace build, Flutter dependency/localization generation, clean formatting, analysis, and the then-current 25 mobile tests.
- Fresh PostgreSQL smoke on port `5432` with API port `3111` reset the demo, created passenger match `cmriyh2ht001ebghng3bcfr2p`, and confirmed selected driver 1 saw exactly one match while alternate driver 2 saw zero.
- The same smoke confirmed passenger/admin visibility, proposed filtering, scoring breakdown, invalid status `400`, and unauthenticated `401`.
- M4E1 passed without a corrective change or audit-only commit.

M4E2 validation results:
- No package dependency, backend source, Prisma schema, or migration change was made.
- `npm run prisma:validate`: passed.
- `npm run prisma:generate`: passed with Prisma 7.8.0.
- `npm run typecheck`: passed for admin and API workspaces.
- `npm run test`: passed, 6 API files and 57 tests including the M4E1 inbox regression.
- `npm run build`: passed for admin and API workspaces.
- `flutter pub get`: passed.
- `flutter gen-l10n`: passed.
- `dart format --set-exit-if-changed .`: passed, 54 files checked and 0 changed.
- `flutter analyze`: passed with no issues.
- `flutter test`: passed, 44 mobile tests including M4C auth/session and M4D passenger regressions.
- `flutter build apk --debug --dart-define=API_BASE_URL=http://10.0.2.2:3000`: passed.
- Debug APK output: `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`.

M4E2 Android/PostgreSQL runtime smoke:
- Emulator: `emulator-5554`, AVD `Medium_Phone_API_36.0`, Android 16 API 36.
- Local PostgreSQL remained on port `5432`; an unrelated existing local project occupied port `3000`, so the runtime-only Darb build used API port `3111` and `API_BASE_URL=http://10.0.2.2:3111` without stopping the unrelated process.
- Demo reset passed; passenger matching created match `cmriyy9cm0028bghnls3fe209` for driver 1, while alternate driver 2 inbox returned zero.
- App data was cleared before launch and Arabic opened by default in RTL.
- Driver 1 login reached the real driver dashboard with seeded active route, proposed count `1`, and no fabricated active trip.
- Active route detail was visible; automated tests separately cover create/deactivate payloads, states, and failures.
- Own-route match appeared in the inbox with passenger summary and score; match detail showed all scoring components and accept/reject actions.
- Accept created trip `cmriyzs91002dbghnwcvfxeie` and navigated directly to driver trip detail.
- Two deterministic simulated points were recorded; latest location showed sequence `1`, source `simulated`, and updated route progress.
- UI advanced only through `accepted -> pickup_started -> picked_up -> in_transit -> delivered -> completed`; all timeline steps completed and the next-status action disappeared.
- Real API verification after UI completion returned trip status `completed`, driver route status `completed`, latest sequence `1`, and alternate driver match count `0`.
- English switch changed the complete driver trip to LTR English.
- Force-stop/relaunch restored the driver secure session and English locale, returning to the English driver dashboard.
- Logout returned to the English login screen, confirming locale persistence after session removal.
- Visual inspection found no crash, overflow, raw JSON, editable coordinates, map/GPS controls, or visibly broken layout in the exercised Arabic and English paths.
- The final deliverable APK was rebuilt after runtime smoke with the requested default emulator API URL on port `3000`.

M4F validation results:
- Baseline was clean on `master` at `103099e feat: add driver mobile flow`; no Git remote is configured.
- Port `3000` was selected after both `3000` and `3111` were verified free; API, emulator runtime, smoke, documentation, and APK all use `http://10.0.2.2:3000`.
- Backend correction was committed separately as `70e8f97 fix: persist merchant batch state`.
- No dependency, Prisma schema, migration, admin, passenger, or driver feature change was made.
- The now-unused generic `RoleHomeScreen` shell was removed after the merchant role became the final specialized mobile role; no role-home Dart orphan remains.
- `npm run prisma:validate`: passed.
- `npm run prisma:generate`: passed with Prisma 7.8.0.
- `npm run typecheck`: passed for admin and API workspaces.
- `npm run test`: passed, 6 API files and 59 tests.
- `npm run build`: passed for admin and API workspaces.
- `flutter pub get`: passed.
- `flutter gen-l10n`: passed.
- `dart format --set-exit-if-changed .`: passed.
- `flutter analyze`: passed with no issues.
- `flutter test`: passed, 60 mobile tests including M4C auth/session, M4D passenger, and M4E2 driver regressions.
- `flutter build apk --debug --dart-define=API_BASE_URL=http://10.0.2.2:3000`: passed.
- Debug APK output: `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`.

M4F tests added:
- Repository contract tests cover order list/detail, safe persisted batches, exact locked pickup/destination DTOs, three-parcel creation, batch, merchant matching body, inbox/status filter, match detail, trip list/detail, and latest location.
- Controller tests cover dashboard success/empty/error state, latest order/batch/waiting match/active trip, 1-to-10 parcel bounds, batch-then-match state gating, and exactly three lifecycle-aware trip/order/location timers.
- Widget/routing tests cover Arabic RTL merchant dashboard, English persistence, locked form without editable coordinates, three-parcel submission, batching, scoring detail, absence of accept/reject and trip/simulation controls, read-only trip/location state, cross-role guards, and unauthenticated redirect.
- API regression tests cover safe persisted batch summaries and `409 order_already_batched` without creating a duplicate.

M4F real PostgreSQL/API smoke:
- Protected reset succeeded against local PostgreSQL on port `5432` with API port `3000`.
- Merchant login returned the seeded order, then a real three-parcel order was created using the locked coordinates.
- Batch creation returned status `created`, estimated distance saved `43.06`, persisted in subsequent order detail, and a duplicate attempt returned `409`.
- Merchant matching returned final score `0.951`; merchant inbox returned the owned match, selected driver 1 returned it, and alternate driver returned zero.
- Selected driver accepted the match; merchant trip list returned the connected trip.
- Authorized driver progressed the trip through `pickup_started`, `picked_up`, and `in_transit` and recorded two deterministic locations.
- Merchant subsequently observed trip/order/all-parcel status `in_transit` and location sequence `1`.
- Merchant trip mutation and simulation attempts both returned `403`.

M4F Android runtime smoke:
- Emulator `emulator-5554`, AVD `Medium_Phone_API_36.0`, Android 16 API 36 ran through `flutter run` with `API_BASE_URL=http://10.0.2.2:3000` after app data was cleared.
- Arabic opened by default in RTL; merchant preset login reached the real merchant dashboard.
- A new order with three parcel rows was created in the UI; no editable latitude/longitude field was present and order detail showed all three parcels.
- With no route capacity available, batching rendered the translated no-compatible-driver state without losing the order; after an authorized alternate route was activated, retry succeeded and displayed persisted batch ID, explanation, and `43.06 km` benefit.
- Merchant matching navigated to safe scoring detail with status proposed, all scoring components, and the explicit read-only notice; no accept/reject controls were present.
- Role-filtered inbox displayed only merchant-owned matches from the exercised merchant account.
- The selected driver accepted through the authorized API; dashboard refresh showed the connected trip and assigned order.
- While merchant trip detail remained visible, authorized driver actions changed trip/order/all parcel states to `in_transit` and added location sequence `0`; the UI updated automatically after the 5/5/3-second polling windows.
- Merchant trip displayed no status or simulation controls.
- Switching to English changed the screen to LTR; force-stop/relaunch restored both secure merchant session and English locale; logout returned to English login and preserved locale.
- Visual inspection found no crash, overflow, raw JSON, coordinate editor, map/GPS controls, or driver mutation actions in the exercised merchant flow.

[M5A_DEMO_HARDENING]
Scope:
- Integration validation and surgical demo hardening only; no new product feature, table, migration, dependency, AI, Socket.IO, live GPS, map, payment, registration, multi-city, deployment, or scoring design was added.
- Baseline was clean on `master` at `8531bb0 feat: add merchant mobile flow`; no Git remote is configured.
- Preferred environment is fixed to host API `http://localhost:3000`, Android emulator API `http://10.0.2.2:3000`, and Vite admin `http://localhost:5173` with 5174/5175 supported by CORS.

Final judge story and combined-flow result:
- The existing schema and contracts were explicitly intended to support one match with both `passenger_request_id` and `merchant_order_id`; M5A uses that combined story.
- A surgical correction now loads the merchant order's newest parcel batch during matching and writes `parcel_batch_id` to the combined match. Accepting it creates one trip linked to passenger request, merchant order, and parcel batch.
- Primary story: reset -> passenger request -> merchant five-parcel batch -> one explainable combined match -> selected driver acceptance -> valid lifecycle and deterministic locations -> passenger/merchant observers -> admin comparison.
- The selected driver owns the match through its route; the alternate driver sees zero. Passenger and merchant see only their connected data and cannot mutate trip/tracking.

Deterministic reset audit:
- Protected reset without a key/admin token returned `403`.
- Five consecutive real PostgreSQL resets produced identical counts and stable seeded identities: 5 users, 2 driver profiles, 2 driver routes, 1 passenger request, 1 merchant order, 5 parcels, 3 demo scenarios, and 2 reset audit events.
- Every reset left 0 parcel batches, matches, trips, location events, and comparison runs; no duplicate active route, batch, accepted match, orphan trip, or mutable demo-created request/order remained.
- Each full smoke also ends with the no-route `404` recovery case followed by a clean protected reset.

Demo tooling and documentation:
- `npm run demo:preflight` checks required environment values, PostgreSQL, API health, admin reachability/config, mobile URL, debug APK, and adb device. Final result: 10/10 checks passed.
- `npm run demo:smoke` uses real HTTP APIs for protection, reset, all role logins, combined match/batch, ownership isolation, acceptance conflicts, lifecycle conflicts, three locations, cross-role state, comparison, CORS, no-route handling, and reset recovery.
- The smoke script contains no reset/JWT/database secrets; only intentionally seeded demo credentials are present.
- A controlled dead-port invocation exits nonzero with `[demo:smoke] FAILED`, proving failure is not silently skipped.
- Presenter runbook: `DEMO_RUNBOOK.md`.
- Evidence screenshots: `docs/demo/screenshots/` outside generated build directories.

Five-run rehearsal result:
- Five consecutive `npm run demo:smoke` runs passed in 2.20, 1.86, 1.79, 1.76, and 1.80 seconds.
- Every run produced final score `0.9317`, location sequence `2`, comparison winner `darb`, 1 versus 6 trips, distance `21.53` versus `129.19`, and estimated cost `43.06` versus `258.38`.
- Every run rejected unauthorized/cross-role/duplicate/invalid actions as expected and restored the deterministic seed without manual database edits.

Admin Full Demo Sequence audit:
- Real browser QA ran the Arabic default RTL console through reset/login/load, merchant batch, combined match, comparison, acceptance, full lifecycle, and tracking using current APIs.
- The sequence is ordered so the merchant batch exists before the combined match, stops visibly on a failed API call, and updates the match, batch, route, request, order, trip, tracking, and comparison cards to authoritative final state.
- All 14 progress steps retranslate live when switching locale; English LTR and Arabic RTL persist through `darb_locale` and page reload.
- Controlled API outage showed the translated network error; API recovery plus refresh restored the authenticated dashboard.

Cross-role emulator and visual QA:
- Real Android 16/API 36 emulator QA covered Arabic login; passenger dashboard/request/match/trip; driver dashboard/inbox/match/trip; merchant dashboard/order/batch/match/trip; and an English representative screen for every role.
- The selected driver accepted and advanced the real combined trip through `accepted -> pickup_started -> picked_up -> in_transit -> delivered -> completed`; invalid lifecycle controls disappeared.
- Passenger and merchant observed the same in-transit trip and location sequence `1`; merchant order, all five parcels, and batch agreed with trip state and remained read-only.
- Merchant English locale and secure JWT survived force-stop/relaunch. Passenger, driver, and merchant representative English screens were LTR.
- Visual inspection found no crash, overflow, clipped primary action, untranslated localization key, raw JSON, unauthorized control, or sensitive credential exposure. Technical IDs/coordinates remained readable LTR.
- Match/explanation/status and simulated-source display were localized; backend API enum values remain English.

Failure and recovery result:
- Invalid login/no token, reset protection/idempotence, duplicate batch `409`, duplicate acceptance `409`, invalid status jump `409`, role mutation `403`, cross-role match isolation, no-route `404`, polling disposal/lifecycle timer deduplication, CORS, session/locale relaunch, and API outage/retry are covered by real smoke, emulator/browser exercises, and focused regressions.
- Dashboard manual refresh now promotes failures to visible translated retry state for passenger, driver, and merchant instead of silently retaining stale success state; retry after API recovery succeeds without clearing the valid JWT.
- No authorization rule was weakened.

Final M5A validation:
- `npm install`: passed; existing 3 moderate Prisma CLI transitive findings remain and `npm audit fix --force` was not run.
- `npm run prisma:validate` and `npm run prisma:generate`: passed with Prisma 7.8.0; no schema or migration changed.
- Workspace `npm run typecheck`, `npm run test`, and `npm run build`: passed; API has 6 files / 60 tests.
- Admin `npm run typecheck:admin`, `npm run test:admin`, and `npm run build:admin`: passed; admin has 1 file / 7 tests.
- Mobile dependency/localization generation, clean formatting (69 files), analysis, tests, and debug APK build passed; mobile has 62 tests.
- Final post-build `demo:preflight` passed 10/10 and `demo:smoke` passed against real PostgreSQL/API in 1.98 seconds, ending with clean reset recovery.

APK:
- Final command: `flutter build apk --debug --dart-define=API_BASE_URL=http://10.0.2.2:3000`.
- Output: `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`.
- Installed successfully on `emulator-5554`.

[M5B_PRESENTATION_FREEZE]
Scope freeze:
- Darb feature development is frozen for the hackathon presentation. Only presentation-blocking corrections are permitted.
- No new API, screen, business feature, database table, dependency, matching formula, architecture, AI, Socket.IO, GPS, map, payment, registration, multi-city, app-store, or deployment work was added.
- The only executable correction was strengthening `demo:preflight` to validate Darb API/admin identity instead of accepting any HTTP 200 response on the expected ports.

Designated presentation machine audit (2026-07-13):
- The exact event judge machine cannot be independently identified from repository context. M5B validated the currently designated presentation machine `C:\Users\basha\Desktop\Darb`; if the event uses another physical machine, run the transfer checklist in `README_DEMO_START.md` before presenting.
- Windows 11 Pro 24H2, version `10.0.26100`, build `26100` (`flutter doctor` reported `10.0.26100.8655`).
- Node.js `v22.17.1`; npm `10.9.2`; PostgreSQL `18.3`, Windows service `postgresql-x64-18` running automatically on port 5432.
- Flutter `3.44.6` stable; Dart `3.12.2`; Android SDK `C:\Users\basha\AppData\Local\Android\Sdk`, platform/build-tools 36.0.0.
- Flutter-selected Java: Android Studio bundled OpenJDK `21.0.6` at `C:\Program Files\Android\Android Studio\jbr\bin\java`.
- AVD `Medium_Phone_API_36.0`, `emulator-5554`, Android 16/API 36.
- Memory: 15.84 GB total / 3.16 GB free at audit. Disk: C 77.01 GB free; D 163.16 GB free.
- Active presentation network: Wi-Fi `192.168.6.28`, gateway `192.168.6.1`; VMware and Hyper-V local adapters also present.
- Port ownership was inspected before stopping anything: verified Darb Node API on 3000, verified Darb Vite on 5173, PostgreSQL on 5432. No unrelated process was terminated.

Frozen URLs and artifacts:
- API `http://localhost:3000`; admin `http://localhost:5173`; Android emulator API `http://10.0.2.2:3000`.
- Debug APK source: `apps/mobile/build/app/outputs/flutter-apk/app-debug.apk`, 191,880,956 bytes.
- APK SHA-256: `0F9C367DEFC1A9E986E1522D2E2331962EE6E5D685B32D217FA09DB4B425B619`, unchanged after the required final rebuild.
- Presenter script: `JUDGE_SCRIPT.md`; operational runbook: `DEMO_RUNBOOK.md`; backup: `BACKUP_DEMO.md`; start card: `README_DEMO_START.md`; notes: `RELEASE_NOTES.md`.
- Ignored package folder: `release/darb-hackathon-demo/`; ignored ZIP: `release/darb-hackathon-demo.zip`.

Cold-start result:
- Verified M5A API/Vite ownership, stopped only those processes, shut down the emulator, left PostgreSQL untouched, and confirmed ports 3000/5173 free.
- Cold-state preflight correctly blocked at 7/10 because API, admin, and Android device were unavailable.
- No-snapshot AVD boot, API, Vite, fresh APK uninstall/install, launch, and readiness completed in `33.71` seconds (target under 3 minutes).
- Post-start preflight passed 10/10; protected reset completed in `0.73` seconds (target under 30 seconds); cold smoke completed in `2.95` seconds.
- Fresh mobile install opened Arabic by default; real browser opened the admin login in Arabic RTL; the full admin sequence completed with authoritative match/batch/trip/tracking/comparison state.
- An initial dress-rehearsal launcher incorrectly forwarded Vite flags through the nested root npm script, so Vite did not bind. No source defect existed; the exact documented command `npm run dev:admin` was used for the timed clean rerun and passed.

Failure and recovery rehearsal:
- With authenticated Arabic admin and passenger sessions open, the verified API process was stopped during the demo.
- Admin displayed the translated server-connection error; mobile displayed the Arabic retry state without crashing or losing the passenger session.
- Restarting the same API configuration restored admin Refresh and mobile Retry; a protected reset then completed without database edits.
- Full visual recovery time was `89.07` seconds (target under 2 minutes); API was healthy after `53.83` seconds and the recovery reset took `0.45` seconds.
- A separate final recovery run proved preflight blocks while API is absent and completed API restart + 10/10 preflight + full smoke in `4.10` seconds.
- Controlled unrelated HTTP services on a temporary port were rejected as “not the Darb API” and “not the Darb admin console,” proving port/service conflict identity detection.

Three final rehearsals using `JUDGE_SCRIPT.md`:
- The written presenter timeline is fixed at exactly `8:00`; automated technical execution is recorded separately and does not pretend to be spoken presentation time.
- Arabic-primary: passed, technical flow `2.56` seconds, no presenter/technical issue.
- Normal full: passed, technical flow `2.16` seconds, no presenter/technical issue.
- Recovery: preflight blocked the outage, then passed after restart; technical smoke `2.43` seconds and recovery + smoke `4.10` seconds.
- Every run returned score `0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, winner `darb`, and clean reset recovery.

Final M5B validation:
- Prisma validation/generation passed with Prisma 7.8.0; no schema or migration changed.
- Workspace typecheck/build passed; API 6 files / 60 tests passed.
- Admin typecheck/build passed; 1 file / 7 tests passed.
- Mobile dependency/localization generation, clean formatting (69 files), analysis, 62 tests, and debug APK build passed.
- Final `demo:preflight` passed 10/10; final real PostgreSQL/API `demo:smoke` passed in `2.04` seconds with all frozen values.
- `npm audit fix --force` was not run. The existing Prisma CLI advisory remains documented.

Release identity:
- Final annotated local tag: `v0.1.0-hackathon`, pointing to the M5B freeze commit.
- The package checksum manifest and packaged `RELEASE_NOTES.md` resolve the exact freeze commit after the commit/tag is created.
- No remote was configured or pushed.

[M5C_MYSQL_PROVIDER_MIGRATION]
Safety and fallback:
- Work began from clean PostgreSQL release commit `074fc4e7cc79c6b08a2baa18ca251b4802aa48c7`; `v0.1.0-hackathon` still points exactly to it.
- Work is isolated on branch `mysql-release`; the PostgreSQL commit/tag and migration history were not amended or moved.
- The local ignored `apps/api/.env` is used without printing, documenting, packaging, or committing real credentials/secrets.
- Authenticated read-only inspection confirmed the intended `darb` database had 0 tables, views, triggers, routines, and events before migration.
- No PostgreSQL row transfer was performed; deterministic demo reset is the MySQL data strategy.

Observed MySQL target:
- MySQL Community Server 8.0.46 on local port 3306.
- Database: `darb`.
- Database character set/collation: `utf8mb4` / `utf8mb4_0900_ai_ci`.
- Prisma-created tables use `utf8mb4_unicode_ci` and support Arabic, English, and emoji.

Prisma/provider changes:
- Prisma schema datasource provider is `mysql`; Prisma ORM/Client remain 7.8.0.
- Runtime uses `@prisma/adapter-mariadb` 7.8.0 and `mariadb` 3.4.5 with credentials parsed internally from `DATABASE_URL` into driver options.
- PostgreSQL runtime dependencies `@prisma/adapter-pg`, `pg`, and `@types/pg` were removed after real MySQL validation.
- Active migration history contains `20260713114812_mysql_baseline` and `20260713114851_preserve_text_capacity`, with `migration_lock.toml` provider `mysql`.
- The follow-up migration explicitly maps parcel-batch/match explanations, comparison benefit, and demo-scenario description to MySQL `TEXT`, preserving the former unbounded PostgreSQL capacity.
- JSON maps to MySQL `JSON`; deterministic decimals retain their declared precision/scale; dates use `DATETIME(3)` through Prisma.
- Approved commands: `npm run db:migrate` and `npm run db:migrate:status`. `db push` is not the release mechanism.

Reset and Unicode verification:
- Five consecutive protected resets produced the exact counts: users 5, driver profiles 2, routes 2, passenger requests 1, merchant orders 1, parcels 5, demo scenarios 3, audit events 2, and zero batches, matches, trips, locations, and comparison runs.
- After every reset, the admin dashboard returned users 5, drivers 2, routes 2, passenger requests 1, merchant orders 1, and parcels 5.
- An Arabic-plus-emoji passenger request was created and read through the real HTTP API with exact text equality, then removed by a final protected reset.

Demo tooling and rehearsal:
- `demo:preflight` loads the ignored API environment when shell values are absent and reports only presence/provider-safe facts.
- Preflight verifies MySQL protocol, connectivity, expected database, `utf8mb4`, collation, Darb API/admin identity, API URL consistency, APK, and Android device.
- `demo:smoke` loads the same ignored environment without displaying values and retains the complete cross-role story and recovery checks.
- Five full real MySQL rehearsals passed with score `0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, winner `darb`, alternate-driver isolation, combined trip state, and clean recovery reset.
- Rehearsal technical durations were 5.46, 5.03, 4.96, 4.99, and 6.03 seconds.
- Final preflight passed 12/12.
- Final workspace validation passed: Prisma validate/generate, migration deploy/status, typecheck, 6 API files / 60 tests, and build.
- Final admin validation passed: typecheck, 1 file / 7 tests, and production build.
- Final mobile validation passed: dependency/localization generation, 69 files with zero formatting changes, analysis with no issues, and 62 tests.
- The unchanged debug APK retained the approved API URL/hash, installed on `emulator-5554`, opened Arabic-first, and completed real passenger login/dashboard loading against the MySQL-backed API.

Release documentation:
- MySQL setup/provider-transition instructions: `MYSQL_MIGRATION.md`.
- Updated operational files: `README.md`, `README_DEMO_START.md`, `DEMO_RUNBOOK.md`, `BACKUP_DEMO.md`, `RELEASE_NOTES.md`, and the safe API environment template.
- PostgreSQL fallback instructions consistently reference `v0.1.0-hackathon`.

[SUCCESS_CRITERIA]
M1 success criteria:
- API can start.
- Prisma schema validates.
- Demo reset is protected.
- Demo reset seeds deterministic users and corridor data.
- Seeded demo accounts can login after reset.
- Authenticated users can call `/api/v1/me`.
- PROJECT_MAP.md documents actual implementation state.

[ORPHANS & PENDING]
Current pending items:
- npm audit reports 3 moderate findings through Prisma CLI transitive `@hono/node-server`. The available force fix would downgrade Prisma from 7.8.0 to 6.19.3, so this needs a Prisma upstream patch or explicit approval to downgrade.
- Judge-day reliability now depends on local MySQL, API, Vite, and emulator readiness; run `npm run db:migrate:status`, `npm run demo:preflight`, and `npm run demo:smoke` before presenting.
- The comparison and tracking are intentionally deterministic hackathon simulations, not production routing, live GPS, or live prices.
- Existing PostgreSQL rows were intentionally not migrated; `v0.1.0-hackathon` remains the working PostgreSQL fallback.
- If a different physical event machine is used, its MySQL database/service, safe local environment, port 3306, emulator acceleration, APK install, migration status, and full preflight remain a required transfer check.
- Next recommended step: preserve both release tags, transfer the ignored MySQL release ZIP to the actual event machine, apply/status-check migrations against an empty dedicated database, run preflight and one smoke, then present the frozen eight-minute script.

Commands to run locally:
```powershell
# Set DATABASE_URL, JWT_SECRET, DEMO_RESET_KEY in the current shell.
npm install
npm run prisma:validate
npm run prisma:generate
npm run db:migrate
npm run db:migrate:status
npm run dev:api
npm run demo:preflight
npm run demo:smoke
```

[M6B1A_PRODUCTION_ISOLATION]
Scope:
- Added the canonical `APP_ENV` model: `local`, `test`, `demo`, `staging`, and `production`.
- Added fail-closed backend validation for database URL, minimum/non-placeholder JWT secret, explicit production-like CORS, release identity, and demo-only credentials.
- Staging/production reject demo enablement; production also rejects wildcard and local CORS origins.
- No Prisma schema, migration, or dependency change was made.

Route registration:
- `POST /api/v1/demo/reset`, tracking simulation step/reset, and deterministic comparison routes register only when demo features are enabled.
- Staging and production return `404` because these routers are absent.
- Normal role routes, trip lifecycle/reads, and latest-location reads remain registered.

Credential/build isolation:
- Backend demo reset reads passwords only from validated `DEMO_*_PASSWORD` values.
- Admin uses typed `VITE_APP_ENV` configuration; production-like builds require HTTPS and omit credentials, reset tools, full demo automation, deterministic comparison, and simulation UI.
- Admin JWT persistence moved from `localStorage` to `sessionStorage`; logout/startup clear the legacy token location.
- Flutter uses typed compile-time `APP_ENV` configuration; production-like builds require HTTPS and omit presets and driver simulation controls while retaining read-only location.

Sensitive-data safety:
- Admin user relations use explicit safe selections and allowlisted serializers.
- `password_hash` and authentication metadata cannot be serialized by admin driver/request/order/route responses.

Focused documentation:
- `docs/architecture/environment-matrix.md`.
- `docs/security/production-isolation.md`.
- `docs/decisions/ADR-001-demo-production-separation.md`.

Validation status:
- Focused configuration, route-isolation, safe-serialization, admin configuration/session, and Flutter build-isolation tests added.
- Prisma validate/generate, workspace typecheck/build, 8 API files / 72 tests, and 3 admin files / 12 tests passed.
- Flutter dependency/localization generation, 70-file clean formatting, analysis, and 65 tests passed.
- Explicit demo and production-like admin builds passed; the production bundle scan found no former passwords, reset header/path, simulation/comparison paths, or Full Demo Sequence text.
- Explicit demo debug and production-like release APKs built; extracted production APK scan found no known or injected demo passwords. Production-like APK SHA-256: `5B55A9D1E59801E5C341A7C56845EA989FEC40D490E3F3BE9EF47178B3F46A9A`.
- Real MySQL demo preflight passed 18/18 and full smoke retained score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.
- Separate production-mode runtime validation passed 10/10: health and normal role/trip/location routes remained registered, while reset, simulation step/reset, and deterministic comparison returned `404`.

Remaining after M6B1A:
- M6B1B implements rate limiting, structured/redacted production logging, request IDs, security headers, body limits, and database-backed readiness below.
- Server-managed admin sessions remain part of the later authentication lifecycle milestone.

[M6B1B_PRODUCTION_HTTP_BASELINE]
Scope:
- Every request receives a generated UUID or strictly validated inbound `X-Request-Id`; responses expose the same header and safe errors include `request_id`.
- Pino emits asynchronous JSON operational logs using an allowlist of environment/release, request, route, status, duration, actor, and event fields. Bodies, query strings, headers, tokens, passwords, phones, coordinates, database URLs, reset keys, error messages, and stacks are excluded.
- Global `/api/v1` and stricter login rate limiters use IPv6-safe IP keys. Login adds only a one-way normalized-phone digest. Health routes and CORS preflight are excluded; the current MemoryStore is single-instance only.
- Staging/production require explicit `TRUST_PROXY`; direct mode trusts no forwarded headers and proxy mode accepts only a documented hop count.

HTTP policy:
- Helmet disables `X-Powered-By`, MIME sniffing, framing, and referrer leakage, and applies same-site resource policy. HSTS is emitted only in staging/production.
- JSON bodies are limited to 64 KB and form bodies to 16 KB. Invalid/oversized bodies return controlled errors without echoing content.
- Central errors preserve safe domain codes, sanitize Zod details, map known Prisma conflict/not-found cases, and return generic unknown/database failures with request IDs.
- Shared coordinate schemas enforce latitude `-90..90` and longitude `-180..180` for passenger requests, merchant pickup, and parcel destinations while retaining the existing numeric-string contract.

Health and lifecycle:
- `/api/v1/health` preserves service identity; `/health/live` is database-independent; `/health/ready` performs a bounded, read-only Prisma/MySQL check and returns redacted `503` on failure/timeout.
- Health endpoints precede rate limiting. Demo preflight now requires database-backed readiness.
- SIGINT/SIGTERM stop new connections, close the HTTP server, disconnect Prisma, emit safe lifecycle events, and enforce a 10-second shutdown bound.
- No Prisma schema or migration change was made. Admin and Flutter contracts/source remain unchanged by M6B1B.

Focused documentation:
- `docs/security/http-security-baseline.md`.
- `docs/operations/logging-and-request-ids.md`.
- `docs/operations/health-and-readiness.md`.
- `docs/decisions/ADR-002-operational-logging-and-correlation.md`.

Validation status:
- Configuration, request ID, redaction, actor metadata, global/login rate limits, proxy spoof resistance, IPv6-safe keying, headers/HSTS/CORS, body limits, safe errors, coordinate boundaries, and readiness success/failure/timeout regressions are automated.
- Added exact dependencies after 2026-07 registry checks: Helmet `8.3.0`, express-rate-limit `8.5.2`, and Pino `10.3.1`. `pino-http` was evaluated but not added because the smaller allowlisted middleware avoids broad default request serialization.
- Prisma validate/generate, workspace typecheck/build, 10 API files / 94 tests, and production-like admin typecheck/build with 3 files / 12 tests passed.
- Flutter dependency/localization generation, 70-file clean formatting, analysis, and 65 tests passed. No APK rebuild was performed because M6B1B changed no admin/mobile source or shared client configuration.
- Real MySQL demo preflight passed 19/19, including readiness. Full smoke retained score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, winner `darb`, and reset recovery.
- Demo runtime headers/request IDs passed and 55 captured structured completion events contained no authorization material, password/phone keys, database URLs, seeded phones, or precise demo coordinates.
- Production-like real-MySQL checks passed: health/live/ready `200`, normal protected API `401`, demo reset/comparison/simulation `404`, CORS preflight `204`, login `401,401,401,429` with `Retry-After`, oversized JSON safe `413`, malformed JSON safe `400`, HSTS/security headers present, and `X-Powered-By` absent.
- Production log inspection passed across 14 completion events. With an unavailable database, liveness stayed `200`, readiness returned redacted `503 not_ready`, and a safe readiness-failure event was recorded.
- `npm audit --omit=dev` still reports the three known moderate Prisma CLI transitive `@hono/node-server` findings; its only proposed repair is the prohibited breaking Prisma `6.19.3` downgrade. `npm audit fix --force` was not run.
- No Prisma schema or migration changed.

Remaining security backlog after M6B1B:
- Shared external rate-limit storage is required before horizontal multi-instance scaling.
- Hosting selection must confirm the exact proxy-hop topology, TLS termination, React deployment headers, and external health-check policy.
- Server-managed admin sessions, refresh/session lifecycle, registration/OTP, distributed tracing, and production deployment remain later milestones.

[M6B2_ENGINEERING_DELIVERY_FOUNDATION]
Scope:
- Added four focused, locally validated GitHub Actions workflows for real-MySQL backend checks, admin, Flutter Android, and security/configuration gates.
- Added canonical `.nvmrc`, `.flutter-version`, and `.java-version` toolchain sources plus portable `validate`, focused validation, audit, workflow, tracked-content, and artifact-scan commands.
- Added a multi-stage, non-root API runtime image, separate controlled migration target, and private-network local staging simulation. No provider, hosting, schema, migration, API, admin, or mobile product change was introduced.
- Added transaction-consistent MySQL backup with SHA-256, fail-closed isolated restore verification, and reproducible safe release metadata.

CI and security contract:
- Backend CI creates only `darb_ci` in an ephemeral MySQL 8 service, deploys migrations from empty twice, checks status, runs all API tests/build, and executes the compiled deterministic real-MySQL smoke.
- Admin and mobile build production-like artifacts without demo configuration or signing secrets and scan outputs for reset/simulation/demo markers.
- Production APK scanning proved runtime-only UI gating retained driver simulation endpoint strings. A surgical compile-time product-build guard now removes those two existing calls from release artifacts while preserving demo/debug behavior; no screen or backend contract changed.
- Security CI rejects prohibited tracked artifacts and high-confidence credentials without printing values; high/critical and unapproved moderate dependency advisories fail. The moderate exception is limited to the documented Prisma CLI chain.
- External GitHub actions are immutable-SHA pinned. CI is active on the private `origin` repository for pushes and pull requests targeting `production-readiness`.

Operator commands:
- `npm run validate`, `validate:backend`, `validate:admin`, `validate:security`, and `validate:all`.
- `npm run mysql:backup` and `npm run mysql:restore:verify -- -- --dump <ignored-dump> --database darb_restore_<name> --confirm-isolated [--cleanup]` (the extra separator preserves flags with npm 10 on Windows).
- `npm run release:metadata -- -- --release <id> --environment <type> --output release/metadata.json`.
- Staging build/start, migration, health, isolation, and shutdown procedures are in `docs/operations/staging-startup.md`.

Recovery targets and boundaries:
- Provisional controlled-beta targets are RPO 15 minutes, RTO 2 hours, 30-day retention pending approval, monthly isolated restore rehearsal, and future encrypted owner-limited managed backups. No cloud backup infrastructure is claimed.
- Clean staging cannot exercise an authenticated normal route until onboarding or approved restored staging identities exist; unauthenticated `401` confirms protected routes remain registered.
- Remaining product work includes production user onboarding/OTP, server-managed access/refresh session lifecycle, verification, and later product capabilities. M6B2 does not implement them.

M6B2 validation status (2026-07-13):
- Local workflow parsing and required-step/reference checks passed for all four workflow files. The standard repository validation passed Prisma validate/generate, workspace typecheck/build, 94 API tests, 12 admin tests, tracked-content scanning, the precise npm audit policy, and 5 tooling safety/reproducibility tests.
- The production admin artifact scan passed. Flutter dependency/localization generation, 70-file clean formatting, analysis, and all 65 tests passed; the production-like release APK built and its extracted native payload passed the forbidden demo-marker scan. The generated APK remains ignored and is not a release artifact.
- Both API Docker targets built. Runtime user `node`, missing-configuration failure, explicit empty-database migration, live/ready `200`, protected route `401`, demo reset/comparison/simulation `404`, HSTS/security/request-ID headers, structured logs, and graceful shutdown (0.41 seconds) passed against an isolated MySQL 8 staging simulation with no seeded users.
- A real local MySQL logical backup and SHA-256 sidecar were created in the ignored backup directory. Restore into `darb_restore_m6b2_20260713` passed checksum, Prisma migration status, Darb physical-table identity, and read-only connectivity checks; verification took 2.876 seconds (3.53 seconds command elapsed) and cleanup removed only the isolated database.
- Demo preflight passed 19/19 and the real MySQL deterministic smoke retained score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, winner `darb`, and reset recovery.
- Safe release metadata generation passed with two migration checksums and reproducible output under `SOURCE_DATE_EPOCH`.

M6B2A private remote and real CI execution (2026-07-17):
- Repository-local Git identity is configured for Bashar Tomeza. `origin` is `https://github.com/bashartomeza/Darb.git`; GitHub confirmed the repository is private and the authenticated `bashartomeza` account has `ADMIN` permission.
- Local and remote history were compared before every push. `production-readiness` was synchronized only by normal fast-forward pushes; no force, history rewrite, branch deletion, or tag replacement was used.
- Frozen annotated tags were pushed unchanged: `v0.1.0-hackathon` still peels to PostgreSQL release `074fc4e7cc79c6b08a2baa18ca251b4802aa48c7`, and `v0.2.0-hackathon-mysql` still peels to MySQL release `7f5c5bace1b081c32f6a24a7352c6b163ac97438`.
- The first real execution proved two CI/tooling defects rather than product regressions: security test paths were incorrectly rooted for the API workspace and the Ubuntu APK scan used GNU `tar` for a ZIP-format APK. Corrective commits `3a14206`, `e15bf56`, and `3eb16a9` use workspace-relative test paths, generate the ignored Prisma client with a credential-free generation-only URL, and use the provisioned JDK's cross-platform `jar` extraction with the prior local fallback.
- All workflows completed successfully on `3eb16a91b953b1a7384b3d9d211f70a3449b24ee`: Admin CI run `29568556711`, Backend and MySQL CI run `29568556661`, Security and Configuration CI run `29568556715`, and Flutter Android CI run `29568556794`. This includes the ephemeral real-MySQL deterministic integration smoke and the Ubuntu production-like APK build/artifact scan.
- Exact successful check contexts are `admin`, `backend-mysql`, `mobile`, and `security`.
- Branch protection was not activated. Read-only branch-protection and ruleset queries returned HTTP 403 because the current GitHub plan does not support protection for this private repository. After a plan upgrade, the recommended single-owner policy is strict required checks for all four contexts, blocked force pushes/deletions, no mandatory second-person approval, and administrator bypass retained for emergency owner recovery.
- M6C identity/session development has not started. The remaining M6B2A delivery decision is whether to upgrade the GitHub plan and approve the verified protection policy.

[M6C1A_TRUSTED_ACCOUNT_AND_SESSION_FOUNDATION]
Scope and compatibility:
- Every user now has `account_status` (`active`, `pending`, `suspended`, or `disabled`), `security_version`, optional operational status reason, status timestamp, and optional last-login timestamp. Existing/demo users default safely to active at security version 1.
- Successful logins create server-managed `AuthSession` rows. The existing `token` response field remains the access JWT; `access_token`, expiry, safe session, and eligible refresh fields are additive, so current admin and Flutter parsers remain compatible.
- Passenger, driver, and merchant logins receive rotating refresh tokens. Admin browser login creates a revocable short-lived session but receives no refresh token. Client refresh consumption remains M6C1B.
- No registration, OTP, password recovery, approval flow, product screen, map/GPS/realtime, notification, price, or payment capability was added.

Token and enforcement policy:
- Access JWT claims are limited to subject, role, session ID, security version, and standard issued/expiry timestamps. Staging/production default to 900 seconds and enforce a 300–1800 second boundary.
- Refresh tokens contain a lookup identifier plus 256 random bits. Only an HMAC-SHA-256 digest is stored; staging/production require a non-placeholder `REFRESH_TOKEN_PEPPER`. Refresh lifetime defaults to 30 days and is capped at 90 days in production-like environments.
- Every protected request validates signature/expiry and loads the MySQL session/user. Missing, expired, revoked, cross-user, inactive-account, role-mismatched, or security-version-mismatched state fails immediately.
- Refresh consumption uses a conditional one-time update inside a MySQL transaction. Valid used-token replay revokes the affected session and its remaining refresh tokens and writes a safe audit event.

API and administration:
- `POST /api/v1/auth/refresh` rotates eligible mobile refresh credentials.
- `GET /api/v1/auth/sessions` returns only the current user's allowlisted session summaries.
- `DELETE /api/v1/auth/sessions/:id`, `POST /api/v1/auth/logout`, and `POST /api/v1/auth/logout-all` provide owned-session, current-session, and all-session revocation. Logout-all atomically increments `security_version`.
- `PATCH /api/v1/admin/users/:id/status` allows an admin to activate, suspend, or disable an account. Inactive transitions require a normalized reason, revoke all sessions, bump security version, and are audited. Current-admin self-suspension and last-active-admin removal are prevented.
- Added safe audit actions for session creation/refresh/revocation, logout-all, refresh reuse, account-status change, and blocked inactive login. Operational redaction covers raw access/refresh tokens, hashes, and the refresh pepper.

Schema, migration, reset, and recovery:
- New forward-only MySQL migration `20260717094000_trusted_sessions` adds the user trust fields, audit actions, `auth_sessions`, and `refresh_tokens`. Earlier migrations and both frozen release tags remain unchanged.
- Session/token indexes cover user active-state lookup, expiry, replay state, and token lookup. Foreign keys explicitly cascade user/session deletion and set replacement links null. Tables use `utf8mb4`.
- Demo reset deletes refresh tokens before sessions, recreates all seeded users as active/version 1, and leaves no session/token orphans.
- A verified ignored backup was created before migration. The pre-migration backup restored into an isolated database and upgraded successfully with `--migrate`; a post-migration backup also restored at current migration status. Both isolated databases were cleaned up.

Local validation (2026-07-17):
- Migration deployed from empty on disposable `darb_m6c1a_ci`, a second deploy was idempotent, and status was current. The disposable run verified both tables, all seven required indexes, all three foreign keys/delete rules, `utf8mb4`, five active/version-1 demo users, and zero session/token rows after cleanup reset.
- Real MySQL rotation, replacement use, used-token replay, session revocation, repeated logout, logout-all, admin suspension, immediate rejection, reactivation/fresh login, and cleanup passed. Two concurrent refreshes produced exactly one success; replay defense revoked the affected session.
- Deterministic regression remained score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.
- Focused architecture and operations documentation: `docs/security/account-and-session-model.md`, `docs/security/refresh-token-rotation.md`, `docs/operations/session-revocation.md`, and `docs/decisions/ADR-004-server-managed-sessions.md`.
- Draft PR #1 CI passed on implementation/documentation head `bd37dac7390c360e59130486cb317889c70157f7`: Admin CI run `29572269624`, Backend and MySQL CI run `29572269627`, Flutter Android CI run `29572269643`, and Security and Configuration CI run `29572269622`. Exact successful contexts were `admin`, `backend-mysql`, `mobile`, and `security`; the PR remained draft and unmerged.

Remaining after M6C1A:
- M6C1B must add Flutter refresh-token secure persistence, single-flight refresh/retry, expiry handling, and logout cleanup. A later secure browser-session milestone must address admin expiry UX; admin refresh tokens remain intentionally excluded.
- Expired-session cleanup scheduling, registration/OTP/public onboarding, distributed authentication caching, notifications, and incident automation are not implemented.

[M6C1A_INDEPENDENT_SECURITY_REVIEW_CORRECTIONS]
Review scope and disposition (2026-07-17):
- Independently reviewed PR #1 from base `production-readiness` at `75e1e7f4d79cbaf26b697852cf2072d138c1aca1` through original head `0b65b3e31a83f6d88bc28ab2e2ae97e0bbc6e034`. The worktree and remote head matched, all 45 changed files were reviewed, both frozen release tags remained unchanged, and the PR remained draft/unmerged.
- No Critical finding was identified. Three High findings blocked merge: concurrent removal of both active admins, acceptance of the documented refresh-pepper template placeholder, and refresh-based role elevation after a role change. Surgical Medium corrections also covered explicit JWT algorithm restriction, credential creation before transaction commit, transactional login eligibility, absolute refresh expiry, and persistent MySQL assertions.

Corrected security and transaction behavior:
- Account-status changes now use serializable MySQL transactions. A transaction write conflict maps to safe `account_status_conflict`; a real concurrent two-admin test persisted exactly one active and one inactive admin.
- Staging/production reject template-shaped JWT/refresh secrets without echoing submitted values. HS256 is explicit for both access-token signing and verification; unsupported HMAC algorithms are rejected before session lookup.
- Mobile refresh credentials bind the issued passenger/driver/merchant role into the HMAC-protected opaque value. A role/client mismatch revokes the session and refresh rows and cannot mint a newly elevated token; admin remains ineligible for long-lived refresh.
- Login conditionally revalidates active status, role, and security version inside the transaction. Access JWT creation occurs before login/rotation transaction callbacks resolve, so signing failure rolls credential changes back rather than committing an undeliverable session or replacement.
- Refresh rotation retains the original absolute session expiry. Replacement rows and `refresh_token_expires_in` are capped to the remaining session lifetime.
- Issuer/audience omission is documented as deliberate for the current single issuer/resource-server trust domain. The existing global production limiter covers refresh; a dedicated distributed limiter remains a later evidence-driven abuse-control decision.

Test and recovery hardening:
- API regression is now 133 tests, including exact placeholder rejection, HS512 rejection, transactional issuance, concurrent-eligibility behavior, role-change revocation, absolute refresh expiry, serializable account status, and safe transaction-conflict mapping.
- The real disposable-MySQL session smoke now checks persistent rows after sequential replay and simultaneous refresh: one used token, one linked replacement, the session revoked, and every token in the chain revoked. It also proves role-change revocation, concurrent login/suspension cleanup, and the last-active-admin invariant without logging credentials or record IDs.
- Restore verification now requires `auth_sessions` and `refresh_tokens`. Its direct Windows invocation correctly launches npm migration commands. The ignored pre-migration backup restored and upgraded to all three migrations; the post-migration backup restored at current status; both checksum-verified isolated databases were removed.

Independent local validation:
- `npm ci`, Prisma validate/generate, workspace typecheck, 133 API tests, workspace builds, 12 admin tests, production admin build, workflow validation, tracked-secret scan, audit policy, and 6 tooling tests passed.
- Raw `npm audit --omit=dev` still reports only the three documented moderate Prisma CLI transitive entries and proposes a breaking force downgrade; no force fix was run.
- Flutter dependency resolution/localization generation, zero-change format check, analysis, and 65 tests passed. No Flutter or admin product source change was required.
- Dedicated `darb_m6c1a_ci` migration applied from empty, redeployed idempotently, and reported current before the strengthened real-MySQL suite passed. Local demo preflight passed 22/22 with API, admin, and Android emulator.
- Deterministic smoke remained score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.

Remaining review risks:
- The global in-memory refresh rate limit is acceptable for the controlled beta but must be reconsidered with distributed deployment or abuse evidence.
- Automated expired-session cleanup, mobile refresh consumption (M6C1B), and a future secure admin browser-session/expiry UX remain pending. PR #1 must remain unmerged until the corrective head passes all four GitHub Actions contexts and the team leader approves merge.

[M6C1A_MERGE_AND_POST_MERGE_VERIFICATION]
Merge result (2026-07-17):
- PR #1 was marked ready after the approved security gate and merged into `production-readiness` with a merge commit. The approved final feature head was `f1fa28c13492dcfe5a1b4c507607bbd250412335`; the merge commit is `c84ab84b9e3bd360e60edbf1a6b1c292e84b2f5b`.
- The remote and safely merged local `m6c1a/trusted-sessions` branches were deleted after synchronization. Local `production-readiness` was updated by fast-forward only and matched `origin/production-readiness` at the merge commit before this documentation record.
- Frozen release tags remain unchanged: `v0.1.0-hackathon` peels to `074fc4e7cc79c6b08a2baa18ca251b4802aa48c7`, and `v0.2.0-hackathon-mysql` peels to `7f5c5bace1b081c32f6a24a7352c6b163ac97438`.

Post-merge migration and validation:
- The intended local MySQL 8 `darb` database already contained `20260717094000_trusted_sessions`. Prisma validation/generation passed, migration deploy reported no pending migrations, and migration status was current at all three migrations; no migration SQL was edited.
- `npm ci`, workspace validation, Prisma validation/generation, typecheck, 133 API tests, builds, 12 admin tests, production admin build, workflow validation, tracked-secret scan, audit policy, and 6 tooling tests passed. Raw production-dependency audit retained only the three documented moderate Prisma CLI transitive findings; no force fix was run.
- Flutter dependency resolution/localization generation, zero-change format check, analysis, 65 tests, and the production-like APK scan passed. The disposable real-MySQL session suite reapplied all migrations from empty, verified idempotent deploy/status, and passed refresh rotation, replay/session revocation, exactly-one-winner concurrent refresh, logout/logout-all, account suspension/immediate rejection, role binding, admin concurrency, persistent-state assertions, and cleanup.
- Live demo preflight passed 22/22 with MySQL, API, admin, and Android emulator. Deterministic smoke retained score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.

Merge-commit CI:
- All required workflows passed on merge commit `c84ab84b9e3bd360e60edbf1a6b1c292e84b2f5b`: Admin CI run `29576328593`, Backend and MySQL CI run `29576328601`, Flutter Android CI run `29576328515`, and Security and Configuration CI run `29576328563`. Exact successful contexts were `admin`, `backend-mysql`, `mobile`, and `security`.
- M6C1A is merged and post-merge verified. M6C1B mobile refresh-token consumption remains the next milestone and has not started.

[M6C1B_CLIENT_REFRESH_AND_SESSION_CONTROLS]
Scope and compatibility (2026-07-17):
- Flutter passenger, driver, and merchant flows now consume the M6C1A rotating-refresh contract through one authenticated-client boundary. Existing backend product contracts, matching/batching behavior, role authorization, Flutter screens, and admin business UI remain intact.
- The mobile app persists a versioned `darb_auth_bundle_v1` secure-storage document containing the access token, optional refresh token, API-derived UTC expiries, optional session ID, and legacy-access marker. The client does not decode JWT claims. A valid former `darb_jwt` is migrated safely; corrupt/unsupported bundles fail closed; logout clears auth keys while preserving locale.
- Admin remains access-token only and receives no browser refresh implementation. No Prisma schema, migration, dependency, release tag, or frozen-release change was made.

Refresh, retry, and termination policy:
- A canonical `AuthSessionCoordinator` performs proactive refresh below a 60-second access-expiry threshold. Every protected mobile repository uses `AuthenticatedApiClient`; the raw API client is reserved for the refresh call to prevent recursion.
- Concurrent callers share exactly one in-flight refresh. The full rotated bundle is persisted before memory replacement. Only exact `401 access_token_expired` receives one refresh and one request retry; `403` and unrelated errors never refresh or retry.
- Network, timeout, and server refresh failures preserve the bundle and authenticated route for an explicit retry. Invalid/revoked/expired/replayed/account-unavailable state and malformed refresh responses clear credentials, invalidate role/trip/session providers, stop polling, and route to login with a localized reason.
- Routing projects refreshing and retryable states to the prior authenticated role. This preserves the active `/security/sessions` route and other role screens while refresh is pending.

Session and admin UX:
- A shared Arabic-first RTL / English LTR `/security/sessions` screen is available to passenger, driver, and merchant only. It lists allowlisted session summaries and supports revoke-other, revoke-current, logout, and logout-all with localized confirmations. Internal session IDs, token data, phone numbers, and security internals are not displayed.
- Revoking the current session ends local auth; revoking another keeps the current session; logout-all clears locally after server success and preserves state on failure; explicit local logout remains possible during an outage.
- Admin terminal access-token 401s clear `darb_admin_token` from both `sessionStorage` and legacy `localStorage`, clear all in-memory/auth-derived state, return to login, and show one exact localized notice across concurrent failures. Normal login/forbidden/network errors do not force logout, and no admin refresh request is made.

Runtime and security evidence:
- Real Android-emulator scenarios passed restore after restart, proactive refresh, one refresh for three concurrent merchant calls, other/current session revocation, logout-all, immediate suspension handling, terminal invalid-refresh handling, outage-preserving retry and recovery, Arabic default RTL, and English LTR. A route loss found during near-expiry runtime testing was fixed in focused commit `e00c2e9` and is covered by an authenticated-routing projection regression.
- Real admin-browser expiry produced four concurrent terminal responses but one Arabic notice, cleared both browser stores, made zero refresh calls, and allowed a fresh login.
- Production-like admin and release APK builds passed the repository artifact scanner. A separate value-aware local scan found no configured infrastructure secrets or generated runtime access/refresh tokens in production admin, production APK, demo APK, or captured logs; no values were printed.
- Real MySQL session integration passed from an empty disposable database with idempotent migration deployment/status. Main database status remained current at three migrations. Demo preflight passed 22/22 and deterministic smoke remained score `0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.

Tests, validation, and delivery evidence:
- API regression is 13 files / 134 tests, including the exact expired-access middleware code. Admin regression is 3 files / 15 tests. Flutter regression is 100 tests with clean localization generation, formatting, and analysis.
- Workspace typecheck/test/build, Prisma validate/generate, standard validation, security validation, real MySQL session integration, admin production build, mobile production-like APK build, and artifact scans passed. Raw `npm audit --omit=dev` retains only the documented moderate Prisma CLI transitive findings whose proposed repair is a prohibited breaking force downgrade; no force fix was run.
- Draft PR #2 targets `production-readiness` from `m6c1b/client-refresh-sessions` and remains unmerged. On implementation head `e00c2e9cf3134cae9067df7b0b3ffbcaab2d1aec`, Admin CI run `29581217388`, Backend and MySQL CI run `29581217465`, Flutter Android CI run `29581217302`, and Security and Configuration CI run `29581217392` all passed. Exact successful contexts are `admin`, `backend-mysql`, `mobile`, and `security`.
- Focused documentation: `docs/mobile/token-refresh-and-retry.md`, `docs/mobile/session-management.md`, `docs/admin/access-token-expiry.md`, and `docs/decisions/ADR-005-client-refresh-coordination.md`.

Remaining after M6C1B:
- PR #2 requires team-leader review and approval before merge. This task does not merge it.
- Registration/OTP/public onboarding, password recovery, cookie-based admin sessions or browser refresh, distributed rate/refresh coordination, expired-session cleanup scheduling, notifications, maps/live GPS/realtime, and incident automation remain outside this milestone.

[M6C1B_MERGE_AND_POST_MERGE_VERIFICATION]
Merge result (2026-07-17):
- PR #2 was approved after independent security review and merged into `production-readiness` using a merge commit. The approved final feature head was `81fb8e1ed237968700f24501f8d6558f4c7d3ee7`; the merge commit is `131f7269af248ce864e4fb5fadcad2fd02a72d13`.
- The remote feature branch was deleted by the approved merge command. The local feature branch was deleted normally only after verifying it was merged; no squash, rebase, force push, history reset, or tag modification occurred.

Post-merge validation:
- Prisma validation/generation, workspace typecheck/test/build, standard and security validation, admin typecheck/test/build, and Flutter dependency/localization/format/analyze/test checks passed. API regression is 13 files / 134 tests, admin regression is 3 files / 16 tests, and Flutter regression is 106 tests.
- Real MySQL migration status remained current at three migrations. Disposable-database session integration passed refresh rotation, replay revocation, exactly-one-success concurrency, session revocation, logout-all, account-status and role binding, admin concurrency, persistence, cleanup, and production-configuration assertions.
- Live demo preflight passed 22/22. Deterministic smoke retained score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.
- Android-emulator regression confirmed Arabic default RTL, English LTR locale persistence across restart, passenger login, secure session restoration to the passenger route, and a successful post-expiry authenticated refresh. Revocation, logout-all, concurrent refresh, and admin-expiry behavior remained covered by the passing real integration and regression suites.
- Raw `npm audit --omit=dev` retained only the documented three moderate Prisma CLI transitive findings whose proposed repair is a prohibited breaking force downgrade; no force fix was run.

Merge-commit CI:
- All required workflows passed on merge commit `131f7269af248ce864e4fb5fadcad2fd02a72d13`: Admin CI run `29605119294`, Backend and MySQL CI run `29605119237`, Flutter Android CI run `29605119252`, and Security and Configuration CI run `29605119160`. Exact successful contexts were `admin`, `backend-mysql`, `mobile`, and `security`.

Remaining after merge verification:
- A dedicated logout/logout-all busy-state treatment remains a low-priority UX hardening item to make an in-flight termination action clearer and discourage repeated taps; it is not a security or merge blocker.
- M6C2 remains the next milestone and has not started. Registration/OTP/public onboarding, password recovery, cookie-based admin sessions or browser refresh, distributed rate/refresh coordination, expired-session cleanup scheduling, notifications, maps/live GPS/realtime, and incident automation remain outside M6C1B.

[M6C2B1_INVITE_CONTROLLED_ONBOARDING_FOUNDATION]
Scope and locked decisions (2026-07-17):
- Public-beta onboarding is invitation-only, phone-bound, one-time, `+970`/`PS` only, and limited to passenger, driver, or merchant. Admin invitation and multi-role accounts are forbidden. `+972` remains disabled.
- B1 adds foundation and admin operations only. No public start/send/verify/complete route, account/password creation, activation/pending-account workflow, operational session, Flutter/admin UI, real SMS/provider SDK, or legal content was added. `PUBLIC_ONBOARDING_ENABLED=true` fails startup.

Schema and security boundary:
- Forward-only MySQL migration `20260717195454_onboarding_foundation` adds Invitation/Redemption, OnboardingAttempt, OtpChallenge, narrow OnboardingSession, ConsentDocument/UserConsent, durable AbuseCounter, and IdempotencyRecord. Independent review added forward-only corrective migrations `20260719120000_harden_onboarding_foundation` and `20260719123000_enforce_single_invitation_attempt`; no previously applied migration or frozen tag was changed.
- Attempts retain canonical E.164 only for delivery/retry/continuation, plus a versioned phone HMAC and last four. Invitation rows contain no raw phone; raw codes/OTPs/tokens are never stored. Distinct, versioned, domain-separated HMAC keys cover invitation code, phone, challenge-ID OTP, onboarding token, idempotency, and abuse subjects, and configuration rejects reuse with JWT/refresh secrets. Digest columns use `ascii_bin` comparison semantics.
- Strict phone normalization supports Latin, Arabic-Indic, and Eastern Arabic/Persian digits, `+970`, `00970`, safe separators, and explicit-`PS` local input. Unsupported/ambiguous/malformed input and `+972` fail. The preflight reported 5 total, 5 valid, 0 invalid, and 0 collisions without values.
- OTP defaults are six crypto-random digits, five-minute expiry, 60-second cooldown, five attempts, three accepted resends, and five phone sends/day. A durable dispatch claim prevents parallel cooldown bypass and fences late provider results. OTP consumption, attempt transition, and audit evidence commit atomically.
- Each invitation owns at most one matching attempt; OTP requires its successful redemption. Onboarding opaque sessions are stored only as keyed digests, require an eligible unexpired owning attempt at issuance and use, and are never accepted by operational JWT middleware. Consent acceptance requires an effective, non-retired, legally approved document, and user deletion cannot cascade away consent evidence. No fake production legal records exist.
- Durable MySQL atomic counters return exact serialized counts for future phone/IP/invitation/verification/completion buckets plus active admin issuance. Idempotency binds operation, scope digest, key digest/version, payload digest, fenced claim version, state, safe result reference, and expiry; stale processors cannot complete reclaimed claims and raw bodies/secrets are excluded.

Admin API and reset:
- Feature-gated admin-only `POST /api/v1/admin/invitations`, `GET /api/v1/admin/invitations`, and `POST /api/v1/admin/invitations/:id/revoke` create/list/revoke with strict bounded input, exact normalized phone HMAC lookup, durable creation limits, request IDs, and allowlisted audits. Arbitrary invitation metadata is rejected; free-form campaign/source/reason values are not copied into audit metadata. Create returns the raw code once; all summaries expose only masked phone and allowlisted fields.
- Demo reset deletes every new foundation record in foreign-key-safe order and seeds no onboarding credential or legal document. Deterministic matching/tracking/comparison metrics remain unchanged.

Migration/recovery and local validation:
- A checksum-verified ignored backup preceded migration. Current-schema upgrade, empty disposable deploy, repeated deploy, current status, pre-migration restore+upgrade, post-migration backup restore, and isolated cleanup passed.
- Real MySQL races passed for one-time invitation consumption, invitation use/revoke terminal state, one-success OTP verification, rejected resend preservation, exact durable counter increments/no bypass, and one-owner idempotency claims/replays. Fake-provider state, token isolation, admin authorization/serialization/filter/revoke, route absence, and reset cleanup passed.
- Deterministic smoke retained score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, winner `darb`. Full workspace/security/mobile validation and draft-PR CI evidence are recorded after completion.
- Final independent-review validation passed 146 API tests, 16 admin tests, 106 Flutter tests, standard/security validation, production admin/APK artifact scans, 22/22 live preflight, and the expanded disposable real-MySQL suite. The approved Prisma CLI moderate-only audit exception remains unchanged; no force fix was run.
- Draft PR #3 initially passed all exact required contexts on implementation head `1634e9ff438472553aa5bf03c38a5eb54565d785`: Admin CI run `29612026855`, Backend and MySQL CI run `29612026804`, Flutter Android CI run `29612026845`, and Security and Configuration CI run `29612026803`. The PR remains draft and unmerged; the final documentation head must also pass all four checks before handoff.

Remaining after M6C2B1:
- M6C2B2 must implement separately reviewed public onboarding APIs, password/account/consent completion without direct session issuance, pending-role status recovery, real-provider integration, and legal/operational gates. Public onboarding remains disabled. Retention cleanup scheduling, provider/carrier validation, phone recovery/change, driver/merchant evidence/approval, password recovery, and UI remain pending.

[M6C2B1_INDEPENDENT_SECURITY_REVIEW]
Review and corrective scope (2026-07-19):
- Independent review of draft PR #3 found no Critical issue and identified merge-blocking defects in full-metadata phone validity, invitation/attempt/redemption binding, OTP attempt-state and resend concurrency, onboarding-session isolation, consent approval/retention, cross-domain secret separation, and stale idempotency completion. All findings were stated before edits.
- Corrective work stayed on `m6c2b1/onboarding-foundation`; the PR remained draft and unmerged. No public onboarding route, UI, real provider, account creation, operational session issuance, dependency version, frozen release tag, or existing migration was changed.

Forward-only schema corrections:
- `20260719120000_harden_onboarding_foundation` adds challenge-ID OTP dispatch fencing, version-fenced idempotency claims, byte-collated digest columns, a non-truncating checked E.164 boundary, and restrictive user-consent deletion.
- `20260719123000_enforce_single_invitation_attempt` enforces one attempt per one-use invitation. OTP dispatch additionally requires the matching redemption, preventing a pre-consumption sibling attempt from progressing.
- Both migrations applied from empty, redeployed idempotently, upgraded the populated local schema, and upgraded a checksum-verified pre-correction backup in an isolated restore database. A post-correction backup restored at current six-migration status; every disposable database was removed.

Security and concurrency corrections:
- The PS wrapper now requires `libphonenumber-js/max` `isValid()` and rejects possible-but-invalid ranges while retaining Arabic-Indic/Persian digit support, explicit local-region handling, and `+972` rejection.
- Invitation creation retries the extremely rare code-digest collision; attempt creation and consumption enforce invitation ID, role, phone HMAC/version, expiry, revocation, and one-use state.
- OTP dispatch uses a bounded durable claim. Parallel callers cannot bypass cooldown; rejected/unknown results cannot overwrite a newer claimant; late accepted provider results are stored as superseded; only eligible, unexpired, redeemed attempts can send or verify. Challenge consumption, attempt transition, and audit commit atomically.
- Onboarding tokens require an eligible unexpired owning attempt at issuance and consumption. Consent recording requires an effective, non-retired, legally approved document, and ordinary user deletion cannot cascade away acceptance evidence.
- Onboarding peppers must differ from each other and from JWT/refresh secrets. Idempotency claims increment a fencing version on reclaim and stale processors cannot complete the new owner’s record. Abuse-counter increments, returned counts, admission decisions, and threshold audit are serialized in one transaction.
- Admin invitation creation rejects unknown/arbitrary metadata. User-entered campaign/source/revoke text is excluded from audit metadata; the real-MySQL suite scans audit rows against actual test phones, codes, tokens, digests, and free-form reasons without printing them.

Independent validation evidence:
- `npm ci`, Prisma validate/generate, workspace typecheck/build, 146 API tests, standard/security validation, 16 admin tests, explicit production admin build, 106 Flutter tests, workflow validation, six tooling tests, tracked-secret scan, production admin/release-APK artifact scans, and value-aware configured-secret/captured-log scans passed.
- Raw `npm audit --omit=dev` reports only the three approved moderate Prisma CLI transitive entries and proposes the prohibited breaking force downgrade; no force fix was run.
- Expanded disposable MySQL tests prove single-attempt/single-redemption behavior, mismatched binding rejection, no OTP before redemption, concurrent resend exclusion, stale dispatch reclaim/late-result fencing, one-success OTP verification, invalid-state OTP/session rejection, exact abuse admission counts, idempotency reclaim fencing, consent approval/deletion protection, safe admin serialization/audits, route isolation, and clean demo reset.
- Live preflight passed 22/22. Deterministic smoke remained score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.

Residual controls before public launch:
- Public onboarding remains fail-closed and absent. M6C2B2 must add separately reviewed public orchestration, real-provider controls, legal document publication workflow, failed-idempotency policy, exact retention scheduling, and the approved storage-at-rest/backup protection boundary before enabling it.
- Admin invitation creation intentionally has no automatic replay/idempotency behavior; response loss requires safe list/revoke/reissue handling as documented. A future admin UI must not add generic mutation retries.
- PR #3 requires the corrective head to pass all four GitHub Actions contexts before it can be marked ready. It must remain unmerged until team-leader approval.

[M6C2B1_MERGE_AND_POST_MERGE_VERIFICATION]
Merge result (2026-07-19):
- PR #3 was approved after independent schema/security review and merged into `production-readiness` using a merge commit. The approved final feature head was `afe3d8d61af74ada32e4f41f9e2da7688db64478`; the merge commit is `a8d0036cbeba9330fe082b74987c47a004344318`.
- The remote feature branch was deleted by the approved merge command. The local `m6c2b1/onboarding-foundation` branch was deleted normally only after verifying the merge graph and synchronizing local `production-readiness` with `origin/production-readiness`; no squash, rebase, force push, reset, or tag movement occurred.
- All feature and corrective commits remain visible. The merged migration history contains `20260717195454_onboarding_foundation`, `20260719120000_harden_onboarding_foundation`, and `20260719123000_enforce_single_invitation_attempt`; no previously applied migration was modified.

Post-merge database and validation:
- The ignored local environment was confirmed present and targeted the intended local Darb development database without exposing values. A fresh checksum-backed ignored backup preceded post-merge verification. Phone preflight reported `total=5`, `valid=5`, `invalid=0`, and `collisions=0` without printing phone values.
- Prisma validation/generation passed. All six migrations were already applied to local MySQL; two migration deploys were idempotent and final status was current with no pending migration.
- The disposable real-MySQL suite applied all six migrations from empty, redeployed idempotently, and passed deterministic smoke, trusted-session concurrency, invitation single-attempt/consume-revoke races, OTP verification/resend/stale-claim fencing, onboarding-session isolation, exact abuse-counter concurrency, idempotency owner fencing, consent retention, disabled route/provider controls, audit privacy, and demo-reset cleanup.
- A checksum-verified pre-onboarding backup restored into an isolated database and upgraded through every migration. The fresh post-merge backup restored at current status. Each restore contained nine onboarding tables, 13 foreign keys, the single-attempt unique index, 13 `ascii_bin` digest columns, both required check constraints, and six completed migration rows; both isolated databases were removed after verification.
- Workspace typecheck/build, 146 API tests, standard/security validation, 16 admin tests, explicit production admin validation, workflow/tooling/secret policy checks, production admin/release-APK artifact scans, and the configured-secret/captured-log scan passed. Flutter localization generation, zero-change formatting, analysis, and all 106 tests passed. Raw `npm audit --omit=dev` retained only the three approved moderate Prisma CLI transitive findings; no force fix was run.
- Live demo preflight passed 22/22. Deterministic smoke retained score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.

Merge-commit CI and locked boundaries:
- All required workflows passed on merge commit `a8d0036cbeba9330fe082b74987c47a004344318`: Admin CI run `29701306641`, Backend and MySQL CI run `29701306635`, Flutter Android CI run `29701306653`, and Security and Configuration CI run `29701306648`. Exact successful contexts were `admin`, `backend-mysql`, `mobile`, and `security`.
- Public onboarding remains absent and disabled; enabling it still fails configuration. Fake OTP remains forbidden in staging/production, no real provider SDK or SMS traffic exists, no registration/account-creation route or Flutter onboarding UI exists, the admin invitation API remains feature-gated, no invented legal content was added, and operational JWT/session behavior remains unchanged.
- Frozen release tags remain unchanged: `v0.1.0-hackathon` peels to `074fc4e7cc79c6b08a2baa18ca251b4802aa48c7`, and `v0.2.0-hackathon-mysql` peels to `7f5c5bace1b081c32f6a24a7352c6b163ac97438`.

Pre-public-launch obligations:
1. Approve storage-at-rest protection and backup-retention policy.
2. Establish a governed legal-document publication workflow.
3. Approve a failed-idempotency recovery policy.
4. Do not add automatic retries to admin invitation mutations without idempotency.
5. Require independent review of every future public onboarding route.

Remaining after merge verification:
- M6C2B1 is merged and post-merge verified. M6C2B2 remains the next milestone and has not started.

[M6C2B2_CONTROLLED_PUBLIC_ONBOARDING_BACKEND]
Scope and feature boundary (2026-07-19):
- Public onboarding is implemented as an invitation-only backend orchestration for passenger, driver, and merchant. It is false by default and can run only in local/test/demo with invitations enabled, the injected fake provider, distinct keyed secrets, and a complete current legal set. Staging/production startup rejects enablement, fake delivery, and test fixtures. No Flutter onboarding UI, real SMS/provider SDK, admin UI, approval workflow, password recovery, phone change, or operational product feature was added.
- `GET /api/v1/onboarding/config` remains registered while disabled and returns only a safe disabled contract. Enabled routes are consent retrieval, start/resume, resend, verify, completion, status, and pending-status recovery. All errors retain request IDs and stable enumeration-safe codes.

Authorization, replay, and privacy:
- Attempt routes use `Authorization: Onboarding <opaque token>` with a database-enforced `continuation` purpose. Pending driver/merchant status uses the separate `pending_status` purpose. Tokens are random, digest-only, attempt/user-bound, expiring, rotatable, revocable, rejected by operational JWT middleware, and never accepted through Bearer authentication.
- Start claims exactly one invitation attempt/redemption, invokes delivery outside the transaction, and recovers response loss without another OTP. Resend preserves the prior accepted challenge on rejected/unknown delivery. Verification atomically consumes one current challenge, rotates a keyed-digest registration grant on exact replay, and applies durable attempt/IP limits.
- Secret-bearing idempotency payloads use a separate versioned HMAC pepper over canonical payloads. Same-key/different-payload conflicts, processing ownership is fenced, terminal failure requires a new key, and raw invitation codes, phone, OTP, password, grants, or provider errors are not stored. Audits/logs contain only bounded categorical data, safe IDs, role/status, and request ID.

Registration and role outcomes:
- Passwords allow Unicode/spaces, require 15-64 characters, reject all whitespace, and enforce bcrypt's 72-byte UTF-8 ceiling. Arabic/English display names are NFC-normalized and bounded without Western-only composition rules. Completion revalidates the immutable invitation/attempt binding, grant, canonical-phone uniqueness, and exactly the current approved terms/privacy/adult-self-attestation IDs and hashes.
- One serializable MySQL transaction creates the User, three UserConsent rows, redemption/user binding, completed attempt, grant consumption, continuation revocation, and safe audits. Passenger becomes active but receives no AuthSession, RefreshToken, access token, or refresh token and must use normal login. Login now preserves the existing shape while accepting optional explicit `PS` normalization for local, `+970`, `00970`, and Arabic/Persian digits.
- Driver and merchant become pending and receive only a narrow status token. Status recovery uses phone/password with dummy verification and generic `invalid_credentials`; pending accounts cannot login or reach operational routes. Activation later yields `approved_sign_in` and still requires normal login.

Schema, test fixtures, reset, and evidence:
- Forward-only migration `20260719203000_public_onboarding_scopes` adds only the `continuation`/`pending_status` enum values and required bounded audit actions; no table or column was added and all six prior migrations remain unchanged. Test/demo legal text is created only by the disposable integration harness, never by production runtime or migrations.
- Demo reset records onboarded user IDs before deleting attempts, removes their sessions/consents/redemptions/users plus legal fixtures/counters/idempotency in foreign-key-safe order, and recreates only the five deterministic demo accounts and scenario data.
- The real MySQL public harness passed 58 checks covering config/legal gating, generic mismatches, provider rejection, concurrent start/resume, accepted/rejected/concurrent resend, all three role outcomes, login compatibility, status isolation/recovery, verify replay/conflict, consent/adult validation, concurrent completion, keyed payload/privacy assertions, and orphan-free reset. Final workspace, security, admin, Flutter, demo, artifact, PR, and CI evidence is recorded at handoff.
- Committed-head local validation passed clean install, Prisma validation/generation, current seven-migration deploy/status, workspace typecheck/build, 149 API tests, 16 admin tests, security/workflow/tooling policy, the 58-check real-MySQL harness, 106 Flutter tests with zero formatting/analyzer findings, production admin/release-APK artifact scan, 22/22 live preflight, and deterministic smoke (`0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, winner `darb`). Raw dependency audit retains only the three approved moderate Prisma CLI transitives and no force fix was run.

Remaining after M6C2B2:
- M6C2B2 is merged and post-merge verified. Production remains blocked on a real provider, approved legal publication workflow/content, storage-at-rest and backup policy, retention automation, Flutter onboarding UI, and driver/merchant approval operations.

[M6C2B2_MERGE_AND_POST_MERGE_VERIFICATION]
Merge result (2026-07-20):
- PR #4 was approved after independent public-route security review and merged into `production-readiness` using the required merge-commit strategy. The approved final feature head was `11359da8aef6594d62b7ae972392ad58c32caf35`; the merge commit is `05029cc843c362bf895df0f8510439950dacf779`.
- The remote feature branch `m6c2b2/public-onboarding-backend` was deleted by the approved merge command. The local feature branch was deleted normally only after verifying the merge graph and synchronizing local `production-readiness` with `origin/production-readiness`; no squash, rebase, force push, reset, or tag movement occurred.
- All feature, test, review, and documentation commits remain visible in the merge graph. The merged migration history contains seven forward-only migrations, including `20260719203000_public_onboarding_scopes`; no previously applied migration was modified.

Security review outcome:
- The independent review found no Critical or High severity issue remaining at merge. Corrective work before merge fixed invitation enumeration leakage, consent-adult-attestation ambiguity, pending-status token/session revocation on suspension, and audit privacy marker coverage.
- Public onboarding remains restricted to local/test/demo fake-provider operation. Staging/production reject public onboarding enablement and fake delivery; no real provider SDK, SMS traffic, Flutter onboarding UI, admin onboarding UI, or operational auto-session issuance was added.
- Enabled public routes remain invitation-controlled, generic on ineligible/unknown inputs, bounded by durable abuse/idempotency controls, and separated from operational Bearer JWT authorization through `Onboarding` tokens with narrow purposes.

Post-merge database and validation:
- Prisma validation/generation passed against the local ignored MySQL environment. `npm run db:migrate` reported all seven migrations applied and no pending migration; migration status was current.
- Full local validation passed after synchronization: clean install, workspace typecheck, workspace build, 149 API tests, standard validation, security validation, 16 admin tests, admin build, Flutter localization generation, zero-change Dart formatting, Flutter analyze, and 106 Flutter tests.
- Raw `npm audit --omit=dev` still reports only the documented three moderate Prisma CLI transitive findings whose suggested repair is the prohibited breaking force downgrade; no force fix was run.

Real MySQL and runtime evidence:
- The real MySQL public onboarding harness passed 67 checks covering disabled/enabled configuration, enumeration-safe eligibility, one-attempt redemption, lost-response recovery, resend fencing, provider rejection recovery, verify replay/grant rotation, passenger active creation without session issuance, driver/merchant pending access, pending-token isolation, operational-route denial, pending-login denial, consent fail-closed behavior, idempotency fencing, suspension revocation, audit privacy, and clean demo-reset cleanup.
- The live onboarding foundation harness passed against the running API. Live demo preflight passed 22/22 with the MySQL-backed API, admin URL, mobile emulator URL, and Android emulator attached.
- Deterministic smoke retained score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.
- Production-like artifact boundary scans passed for the release APK and a production-configured admin build. Explicit route-boundary tests passed for public-onboarding disablement, staging/production fail-closed behavior, fake-provider rejection outside local/test/demo, log redaction, route isolation, and foundation security.

Merge-commit CI:
- All required workflows passed on merge commit `05029cc843c362bf895df0f8510439950dacf779`: Admin CI run `29730014643`, Backend and MySQL CI run `29730014653`, Flutter Android CI run `29730014631`, and Security and Configuration CI run `29730014675`. Exact successful contexts were `admin`, `backend-mysql`, `mobile`, and `security`.
- Frozen release tags remain unchanged: `v0.1.0-hackathon` peels to `074fc4e7cc79c6b08a2baa18ca251b4802aa48c7`, and `v0.2.0-hackathon-mysql` peels to `7f5c5bace1b081c32f6a24a7352c6b163ac97438`.

Remaining obligations before public launch:
1. Build and independently review the Flutter Arabic/English onboarding UI.
2. Select and validate a real OTP provider, including carrier/error-mode tests.
3. Establish governed production legal-document publication with approved content and hashes.
4. Approve storage-at-rest, backup-retention, and restore policy.
5. Implement retention cleanup automation.
6. Implement driver/merchant review and approval operations.
7. Independently review any future mobile onboarding integration and production-provider path.

Next milestone:
- M6C2C remains next and has not started.

[M6C2C_FLUTTER_CONTROLLED_ONBOARDING]
Scope (2026-07-20):
- Flutter now implements the controlled mobile onboarding client for the existing M6C2B2 backend. This is a mobile-only milestone with no schema change, no migration, no real SMS provider, no production onboarding enablement, no admin invitation UI, no password recovery, no phone change, no multi-role accounts, and no driver/merchant approval workflow.
- The login screen fetches `/api/v1/onboarding/config` through a public onboarding client. Registration and pending-status recovery CTAs are hidden when onboarding is disabled or when config retrieval fails. Direct navigation to onboarding while disabled renders a safe unavailable state and returns to normal sign-in.

Client architecture:
- Public onboarding repository calls config, consents, start, and pending-status recovery without operational Bearer credentials.
- Continuation operations use `Authorization: Onboarding <continuation-token>` for resend, verify, complete, and in-progress status. These requests never pass through the operational refresh coordinator.
- Pending-status operations use `Authorization: Onboarding <pending-status-token>` and never attach operational JWT or refresh credentials. Tokens are never sent in URLs or route parameters.

State machine and secure bundle:
- The mobile onboarding controller uses explicit stages equivalent to checking availability, unavailable, choosing role, invitation/phone entry, starting, OTP sent/resending/verifying, phone verified, loading consents, account details, consent review, completion, passenger-created, pending-review, retryable failure, and terminal failure.
- Secure onboarding state is stored in `darb_onboarding_bundle_v1`, separate from `darb_auth_bundle_v1` and `darb_jwt`. Corrupt, unsupported, incomplete, or expired bundles fail closed and clear only onboarding state.
- Stored onboarding data is limited to bundle version/type, safe stage, role, locale, attempt ID, continuation token/expiry, registration grant/expiry, pending-status token/expiry, masked phone, resend time, and safe idempotency metadata. Raw invitation code, OTP, password, raw phone, full authorization headers, provider details, fake outbox data, JWTs, and refresh tokens are not stored in onboarding state.
- Token/grant replacement follows the crash-consistent order: validate response, construct the replacement bundle, write secure storage, then publish controller state.

User flow and outcomes:
- Arabic remains default RTL; English remains optional LTR. Role labels are passenger/driver/merchant only; admin is never offered.
- Invitation and Palestinian phone entry are kept in widget/controller memory only. Backend remains authoritative for phone normalization and invitation eligibility. The app shows only the backend-returned masked phone after start.
- OTP entry is manual, six digits, paste-capable, and locally normalizes Arabic/Persian digits to ASCII for submission. The mobile app never reads or exposes the fake OTP outbox.
- Consent retrieval requires exactly the three backend-approved documents: terms, privacy, and adult self-attestation. Content is rendered as inert text.
- Password/display-name collection enforces client-side confirmation and delegates final policy enforcement to the backend. Completion rejects any passenger response containing operational token fields.
- Passenger registration clears onboarding state and routes to normal login. Driver and merchant registration replaces continuation state with pending-status state and shows a pending-review screen; operational dashboards remain inaccessible.
- Pending-status recovery asks for phone, `PS` region, and password, stores only the returned pending-status token on success, and uses generic invalid-credentials failure without account/role enumeration.

Validation and tests:
- Added Flutter tests for secure onboarding storage, public/continuation/pending repository header separation, disabled/enabled registration CTA behavior, config failure fail-closed behavior, direct disabled route safety, OTP digit normalization, random idempotency key shape, passenger token-field rejection, pending recovery generic failure, and preservation of operational auth storage independence.
- Existing mobile regression remains passing with the new onboarding coverage: 122 Flutter tests passed locally after generation, formatting, and analysis.

Documentation added:
- `docs/mobile/onboarding-flow.md`
- `docs/mobile/onboarding-secure-state.md`
- `docs/mobile/onboarding-idempotency.md`
- `docs/mobile/pending-account-experience.md`
- `docs/mobile/onboarding-accessibility.md`
- `docs/decisions/ADR-008-mobile-onboarding-state-machine.md`

Validation evidence:
- Full backend/workspace validation passed: clean install, Prisma validate/generate, seven-migration MySQL status current, workspace typecheck, 149 API tests, workspace build, standard validation, and security validation. Raw `npm audit --omit=dev` still reports only the approved three moderate Prisma CLI transitive findings and no force fix was run.
- Explicit admin validation passed: typecheck, 16 tests, normal build, production-configured build, and production artifact scan.
- Explicit Flutter validation passed: dependency resolution, localization generation, zero-change formatting, analysis, 122 tests, debug APK build for `http://10.0.2.2:3000`, production-like release APK build, and production APK scan.
- Real MySQL public onboarding harness passed 67 checks. Live demo preflight passed 22/22 with API, admin, debug APK, MySQL, and Android emulator attached. Deterministic smoke retained score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.
- Android emulator install/launch smoke passed for package `ps.darb.mobile` using the generated debug APK. The exhaustive invite/OTP/operator UI rehearsal remains required for independent review because the repository does not yet provide a full Flutter integration automation harness for reading fake-provider OTP externally and driving all screens.

Remaining after M6C2C:
- Draft PR creation and independent mobile security/state review remain required before merge. Public launch still requires full manual/operator onboarding rehearsal, a real OTP provider, governed legal publication, storage/backup/retention approval, retention automation, admin invitation UI if desired, and driver/merchant approval operations.

[M6C2C_INDEPENDENT_REVIEW_REMEDIATION]
Review scope (2026-07-20):
- Independent review of draft PR #5 confirmed the expected base/head SHAs, clean merge state, four successful CI contexts, unchanged frozen tags, and no dependency/schema/migration change in the submitted PR.
- The review did not accept green CI as sufficient. It identified merge-blocking gaps in stale-response generation fencing, idempotency lifecycle, ambiguous secret-bearing retries, consent-version refresh, strict config/bundle parsing, storage-failure behavior, server-authoritative restoration, immutable role/transition enforcement, response-contract validation, exact credential expiries, and stale availability entry.

Surgical corrections:
- All onboarding async mutations and restoration are now generation-fenced. Clear, abandonment, authenticated-session installation/restoration, provider disposal, or a newer load prevents an older response from persisting or publishing.
- Start, verify, and completion retain exact payload/key pairs only in live private controller memory; known outcomes clear them, exact ambiguous retries reuse them, and edited payloads rotate them. Secret-bearing operations are deliberately not advertised as replayable after process death. Resend alone may persist its safe attempt-scoped key.
- Enabled config parsing now requires `PS`, recognized unique roles/locales, complete password constraints, six OTP digits, and a positive cooldown. Entry/direct routes revalidate availability; transient retrieval failure preserves a valid secure bundle, while authoritative disablement clears it.
- Bundle decoding now rejects unknown enums, illegal stages, missing role/expiry, mixed continuation/pending credentials, and invalid idempotency metadata. Expired writes fail instead of publishing a false success, and secure-storage failures return controlled retry state.
- Restoration validates `/api/v1/onboarding/status` before exposing OTP/account/pending state. Operational authentication clears stale onboarding storage and retains routing precedence.
- Consent conflict now clears completion idempotency, reloads the active documents, increments a UI revision fence, clears all prior checks, shows document versions, and requires fresh explicit acceptance.
- Completion validates immutable role, account status, next action, token/session-field absence, exact server expiry, and passenger versus pending outcome shape. Pending recovery returns role only after valid credentials.
- The backend contract received additive, migration-free expiry fields for continuation, registration grant, and pending status session plus the authenticated pending role. Flutter no longer invents token lifetimes.
- UI hardening adds honest ambiguous retry retention, secret clearing on known outcomes/abandonment, post-attempt back confirmation, filtered/obscured OTP entry, password visibility controls, client-side character/UTF-8 byte checks, localized consent versions/countdown, network/timeout messages, and approved-sign-in copy.

Focused regression coverage:
- Added tests for late-response fencing, exact-key reuse, edited-payload rotation for start/verify/complete, secure-write failure, strict config parsing, mixed/corrupt bundle rejection, masked-phone preservation, server-expiry parsing, passenger session-field rejection, stale-enabled CTA revalidation, consent-version acceptance reset, and operational-auth precedence over stale onboarding state.
- Emulator execution found and corrected two additional state/routing defects: passenger completion and approved-pending result stages had been swapped, and a server-validated restored onboarding bundle was not handed off from login to the onboarding route after process death. Focused controller/widget tests now lock the passenger-created, approved-sign-in, and pending-restoration outcomes.

Independent validation and emulator evidence:
- Final clean install and validation passed: Prisma validate/generate, current seven-migration MySQL status, workspace typecheck/build, 149 API tests, standard/security validation, six tooling tests, 16 admin tests, real MySQL public-onboarding integration, Flutter localization generation, zero-change formatting, analysis, 137 Flutter tests, local debug APK, and production-like release APK.
- Raw `npm audit --omit=dev` retains only the three documented moderate Prisma CLI transitives whose proposed repair is the prohibited breaking force downgrade. No force fix was run.
- Live preflight passed 22/22. Deterministic smoke retained score `0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.
- Passenger completed invitation, externally read/manual OTP entry, all three consents, creation without auto-login, normal access/refresh login, dashboard entry, and confirmed logout. Driver and merchant each completed registration into pending isolation, restored after real process death, remained unable to login, recovered pending status with credentials, refreshed status, and cleared local pending state.
- A real consent-set switch from operator version A to B produced `consent_version_changed`; Flutter cleared all three prior acceptances, rendered B, required fresh acceptance, and then completed. Arabic default, English switch, semantic accessibility tree, and 1.5x font-scale login layout passed. A production-like APK launched fail-closed with Arabic login available and registration/recovery absent; artifact scans found no local secret or temporary review marker.
- A response-loss proxy confirmed start and verify response loss can be retried in-process without losing the workflow. Completion response loss committed server-side and retained the exact form/three acceptances for explicit retry, but the operator automation did not obtain a final replayed-result observation. Resend temporary failure, pending-status temporary failure, TalkBack, and rotation remain uncompleted manual gates.

Independent-review readiness:
- PR #5 must remain draft and unmerged until the remaining response-loss/accessibility gates above are completed and the corrective head passes all four required CI contexts. No schema, migration, dependency, real provider, production enablement, admin onboarding UI, or approval workflow was added.

[M7B_CANONICAL_ROUTE_CATALOG_AND_ADMIN_MANAGEMENT]
Scope and compatibility boundary (2026-07-21):
- M7B adds an admin-owned canonical route catalog without switching passenger requests, merchant orders, batching, matching, trips, or Flutter flows away from the deterministic legacy corridor. The original Hebron / PPU / Bab Al-Zawiya to Bethlehem fixture, labels, coordinates, simulated points, scoring, and operational contracts remain unchanged.
- `ROUTE_MANAGEMENT_ENABLED` and the admin `VITE_ROUTE_MANAGEMENT_ENABLED` both default false. Disabled admin route endpoints return 404, the authenticated read catalog returns a safe empty contract, and the production admin navigation hides the module. `MULTI_ROUTE_ENTRY_ENABLED` defaults false and any attempt to enable it fails startup until M7C exists.
- No map provider or SDK, map UI, GPS permission, realtime dependency, live-location ingestion, route pricing, recurring schedule, capacity reservation, driver mobile selector, or passenger/merchant route selector was added.

Canonical route domain:
- `ServiceRoute` is the stable, normalized route identity with group, region, enum direction, active/retired lifecycle, nullable current-version pointer, creator, and retirement metadata. The controlled beta service layer caps creation at five route identities and exposes no destructive route/version delete API.
- `ServiceRouteVersion` owns bilingual names/descriptions, active dates, origin/destination, explicit optional geometry readiness and safe geometry metadata, estimates, lifecycle timestamps/actors/reasons, and an optimistic `draft_revision`. Published versions are immutable; corrections clone to a new transactionally numbered draft.
- `Stop` is a stable normalized bilingual identity using range-checked `DECIMAL(9,6)` coordinates and active/retired lifecycle. `RouteVersionStop` gives each version a unique, one-based, gap-free stop order, unique membership, four pickup/drop-off permission flags, and bounded optional offset/dwell values.
- Publication uses a real MySQL transaction and row locks: it locks the stable route, reloads and validates the expected draft revision and ordered active stops, verifies bilingual/origin/destination/date/permission invariants, publishes exactly one version, atomically changes the current pointer, safely pauses a replaced current publication, and records an allowlisted audit event. Concurrent draft writes and publication return conflicts rather than silently overwriting.
- Pause/resume/version-retire/route-retire enforce the current pointer, terminal states, required reasons where applicable, active-date checks, and known DriverRoute/MatchOffer/Trip usage. Published/paused/retired versions and used stops remain historically readable and non-destructive.

Driver compatibility and deterministic demo route:
- `DriverRoute` remains the compatibility/availability entity. Nullable `route_version_id` plus one-off departure/window, total/remaining seat and parcel capacity, availability status/revision, and lifecycle timestamps were added with restrictive foreign keys and database checks. Existing corridor and capacity columns remain; the matcher does not read the new fields in M7B.
- The future authenticated driver-availability creation service validates the current published version, one-off future timing, driver profile capacity, and remaining totals, but its HTTP entry point is unreachable while `MULTI_ROUTE_ENTRY_ENABLED=false`.
- Local/test/demo reset idempotently creates one stable deterministic route, published version 1, and three canonical stops from the existing fixture. It preserves the exact fixture geometry and links only the safely compatible outbound demo DriverRoute. No operational beta route is seeded by migration or production runtime.

API, admin, authorization, and privacy:
- Admin-only feature-gated APIs cover route list/create/detail/retire, version create/detail/draft-edit/stop-replace/clone/publish/pause/resume/retire, and stop list/create/edit/retire. Writes use existing trusted admin authentication/live-session enforcement, strict Zod allowlists, bounded request bodies, request IDs, idempotency keys for creation/lifecycle operations, and optimistic revisions for draft mutations.
- Authenticated read-only catalog APIs expose only current published/paused route summaries and ordered stops with bounded pagination. They exclude drafts, retired routes by default, audit actors, provider internals, encoded geometry, phone data, and other administrative metadata.
- Audit events contain only safe IDs, transition/revision/request ID, bounded categorical reason/code, and optional checksum/diff references. Full bodies, coordinates, descriptions, provider payloads, tokens, and credentials are excluded.
- The production React module is separate from `/demo` and provides a bilingual RTL/LTR catalog, loading/empty/error states, search/filter/pagination, identity/version and numeric stop forms, keyboard-accessible stop reordering, permission controls, revision-conflict handling, lifecycle confirmations, explicit geometry readiness, shared responsive design tokens, and no map surface.

Migration, recovery, and validation evidence:
- Forward-only migration `20260721110000_canonical_route_catalog` adds the four canonical tables, enums, compatibility columns, indexes, restrictive foreign keys, utf8mb4 tables, and MySQL CHECK constraints. The seven existing migrations were not edited and no `db push` was used. Main `darb` upgraded from seven to eight migrations, repeated deploy was a no-op, and final status is current.
- Aggregate preflight found two legacy DriverRoute rows, no trips/matches using them, one distinct corridor, and no invalid legacy capacities. A fresh isolated database applied all eight migrations. The populated upgrade passed, and the disposable real-MySQL route harness passed repeatedly before final validation and once again from an empty database at final head.
- Real-MySQL coverage includes route/stop uniqueness, idempotent replay/conflict, version-number and clone concurrency, optimistic draft conflict, stop constraints, invalid publication, one deterministic current publication under concurrency, published immutability, pause/resume/retire rules, usage deletion protection, capacity checks, Arabic round-trip, demo seed/reset idempotency, and final cleanup.
- Ignored checksum-backed backups were made before and after migration. The pre-migration dump restored into an isolated database and upgraded through all eight migrations; the post-migration dump restored at current status. Both isolated restore databases were removed after verification.
- Final local validation passed dependency installation, Prisma validate/generate, eight-migration deploy/status, workspace typecheck/build, 160 API tests, 24 admin tests, standard/security/workflow/tooling gates, production admin and release-APK artifact scans, 141 Flutter tests with zero format/analyzer findings, 22/22 live preflight, fresh emulator APK install, and Arabic-first launch. The release APK was not rebuilt by M7B.
- Deterministic live smoke remains score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.

M7B review and remaining work:
- M7B is intentionally delivered as an unmerged draft PR and requires independent schema, lifecycle, authorization, privacy, and real-MySQL concurrency review before merge.
- M7C remains responsible for explicitly enabled multi-route operational entry and migration of driver/passenger/merchant selection and matching behavior. M7D remains responsible for any separately approved map-provider geometry, map UI, GPS, location ingestion, or realtime design. Neither milestone is implemented here.

[M7B_INDEPENDENT_REVIEW_REMEDIATION]
Review scope (2026-07-22):
- Independent review of draft PR #6 preserved remote head `3e13d173b8507f45659b256ea1a1f7a08abe82db`, both frozen release tags, and the original M7B migration. The review used the production admin at exactly `http://localhost:5173`, a real local MySQL 8.0 disposable review database using `utf8mb4`, and the existing feature gates with route management enabled, multi-route operational entry disabled, and demo UI independently disabled.
- The complete 30-scenario browser matrix passed: disabled navigation/API behavior; admin login and production shell; loading/empty/safe errors; three bilingual stops; invalid coordinates and duplicate keys; stable and duplicate route handling; rapid-submit protection; draft editing; keyboard stop ordering; stop permissions; stale two-view revision conflict; invalid and valid publication; current-pointer update; published/shared-stop immutability; clone and geometry invalidation; retired-stop clone rejection; cross-route pointer ownership; concurrent active-route cap; pause/resume; version/route retirement; public field allowlist; non-admin isolation; passenger/driver/merchant and account/session authorization; Arabic RTL/English LTR; desktop/tablet/narrow layouts; visible focus; long Arabic content at 200% scaling; and demo-console separation.
- Responsive evidence passed at desktop, `768 x 1024`, and `390 x 844`. Tablet and narrow layouts used a single stacked column with a static route sidebar and no horizontal overflow. Arabic remained RTL, English switched to LTR, keyboard reordering remained operable, visible focus was present, and long Arabic content remained usable at 200% browser scaling without horizontal overflow.

Independent-review corrections:
- Route creation now serializes the five-active-route envelope and retries MySQL serialization conflicts. The database now constrains a route's current pointer to one of its own versions through forward-only migration `20260721170000_enforce_route_catalog_integrity`.
- Referenced stops are immutable from their first draft membership. Stop replacement, cloning, and publication lock and validate member stops; cross-region or retired members fail closed. Stop replacement and cloning clear geometry/provider/checksum/estimate approval metadata rather than inheriting stale geometry.
- Public catalog serialization is an explicit safe allowlist that omits internal membership and foreign-key IDs, administrative timestamps, retirement metadata, and provider internals while retaining the stable IDs and ordered permissions clients require.
- The admin retains one idempotency key only for the same unresolved logical mutation, rotates it when payload changes or the outcome becomes authoritative, closes the same-render rapid-submit window with a ref-backed guard, keeps busy controls disabled, and localizes safe generic failures without exposing raw backend messages.
- Real-browser review found two HTTP integration blockers: CORS did not allow `Idempotency-Key`, so idempotent admin POSTs failed preflight, and CORS did not allow `PUT`, so ordered-stop saves failed preflight. The allowlist now includes both and focused HTTP-security tests pin the contract.
- The production-like trusted-session harness was inheriting the local-only legal-fixture flag from its parent process. A small environment-sanitization helper now removes local/test-only flags before production subprocess startup, with delivery-tooling regression coverage. Production configuration continues to fail closed if those flags are supplied directly.

Review validation boundary:
- Focused API CORS/security tests, admin route tests, delivery-tooling tests, the disposable real-MySQL route concurrency harness, and the complete trusted-session integration harness passed after correction. The latter retained the approved deterministic metrics: score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.
- The final local gate passed a clean npm install, Prisma validate/generate, repeatable 9-migration deploy/current status, workspace typecheck/build, 160 API tests, 26 admin tests, 8 tooling tests, workflow/secret/security validation, zero-change Flutter formatting, Flutter analysis, and 141 Flutter tests. Real MySQL route concurrency, trusted-session, 76-check public-onboarding, checksum-backed backup/isolated restore, 22/22 live preflight, deterministic smoke, production-like session isolation, production admin/release-APK artifact scans, and temporary-log scans all passed. Disposable review/restore databases and browser-review artifacts were removed afterward.
- During final validation, the registry began reporting a high-severity advisory against transitive `fast-uri@3.1.3` through Prisma CLI's AJV dependency. A lockfile-only non-breaking update to `3.1.4` removed the high finding without changing Prisma or adding a direct dependency. Raw `npm audit --omit=dev` now reports only the three documented moderate Prisma CLI transitives whose proposed repair remains the prohibited breaking force update; the repository audit policy passes.
- Exact-head GitHub CI remains required before PR #6 can leave draft. PR #6 remains unmerged. M7C and M7D remain out of scope.

[M7B_MERGE_AND_POST_MERGE_CLOSURE]
Merge history and migration integrity (2026-07-22):
- PR #6 was merged with approved feature head `90c2b5cfb8cad078b720a1af33d361a5197bd0a6`; merge commit `771bdb455b84f36e2ca443b8435e0659cea3aa32` preserves the full reviewed history. Corrective PR #7 was then merged with approved head `3280194c08828c8291a9cb893f900c2662fe97e4`; merge commit `4e9c711a3824a7caf0eb23be6d2742dc4d6d244a` preserves the focused production-admin packaging correction.
- All nine MySQL migrations are current. M7B added `20260721110000_canonical_route_catalog` and forward-only integrity migration `20260721170000_enforce_route_catalog_integrity`; no applied migration was edited and no `db push` or migration resolution was used.
- The historical checksum investigation is Outcome A: an isolated local database had applied an uncommitted pre-merge onboarding draft, while canonical Git history remained byte-stable. Clean CI/disposable databases applied the canonical history, so no tracked migration or `_prisma_migrations` row was rewritten.

Closed route-management guarantees:
- Publication enforces a same-route current-version pointer, serialized active-route cap, ordered active stops, optimistic draft revisions, and one intended lifecycle transition. Referenced-stop historical immutability, clone geometry/provider/checksum invalidation, and retired-stop clone rejection remain enforced.
- Admin mutations retain idempotency-key ownership and same-render duplicate-submit fencing. The reviewed CORS correction permits `Idempotency-Key` and `PUT`; the lockfile-only `fast-uri@3.1.4` correction removed the transient high advisory without changing Prisma or adding a direct dependency.
- The 30/30 pre-merge browser matrix passed. Selected merged-head browser verification then passed publication and pointer persistence, published history and shared-stop immutability, clone/invalidation, pause/resume, retirement, public catalog authorization/privacy, desktop/tablet/narrow RTL/LTR behavior, feature-disabled behavior, and multi-route startup refusal.

Artifact, regression, and CI closure:
- Corrective PR #7 removed dormant tracking-simulation control labels from production-configured admin bundles by using the existing compile-time demo boundary; demo behavior remains available only in approved local/test/demo builds. The production admin artifact scan passes with all five affected translation properties empty and no simulation-control labels or demo endpoints bundled.
- The frozen hackathon APK is intentionally a demo artifact and may contain demo-gated tracking simulation strings/endpoints. It was not rebuilt, replaced, retagged, or treated as production-clean. Production-like APKs are the production gate; PR-head and merge-commit Flutter CI both built and scanned a demo-disabled production-like APK successfully.
- Post-merge validation passed 160 API tests, 27 admin tests, 141 Flutter tests, 8 tooling tests, Prisma validation/generation, workspace typecheck/build, standard/security policy, production artifact scans, and secret/log scans. Raw audit retains only the three documented moderate Prisma CLI transitives; no force fix was run.
- Live preflight passed 22/22. Deterministic smoke retained score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.
- All four workflows passed on PR #7 merge commit `4e9c711a3824a7caf0eb23be6d2742dc4d6d244a`: Admin CI, Backend and MySQL CI, Flutter Android CI (including production-like APK scan), and Security and Configuration CI.

Milestone boundary:
- M7B is closed. M7C has not started and remains responsible for explicitly enabled multi-route operational entry and migration of driver/passenger/merchant route selection and matching behavior.
- No map SDK/provider, map UI, GPS permission/ingestion, or realtime transport was introduced. Maps/GPS/realtime remain deferred to M7D/M7E.

[M7C1_BACKEND_MULTI_ROUTE_OPERATIONAL_FOUNDATION]
Scope and gates (2026-07-22):
- M7C1 is backend-only and review-gated. `MULTI_ROUTE_ENTRY_ENABLED` defaults false, is accepted only in local/test/demo, and remains startup-forbidden in staging/production. New `MULTI_ROUTE_MATCHING_ENABLED` defaults false and startup rejects enablement in every environment. Route management remains independent.
- No Flutter/admin operational UI, production matching/batching/scoring, canonical trip creation, maps, GPS, location ingestion, realtime transport, pricing, dispatching, recurrence, arbitrary customer coordinates, provider integration, or production enablement was added.

Canonical operational references and compatibility:
- Forward-only migrations `20260722130000_multi_route_operational_foundation` and `20260722143000_isolate_canonical_availability` extend the nine-migration baseline without editing prior migrations. PassengerRequest, MerchantOrder/Parcel, Match, and Trip gain nullable immutable route references/version markers; Trip also gains nullable snapshot JSON/checksum fields for future M7C3 integration.
- Passenger pickup/drop-off and merchant pickup/parcel destinations have database composite foreign keys to the submitted route version's `RouteVersionStop`. Parcel `(order_id, route_version_id)` references its owning order's same route. Canonical all-or-required shapes, departure windows, positive passenger count, reservation amounts/types/states, restrictive history, and operational indexes are database-enforced on MySQL 8.0.46.
- `canonical_availability_version=canonical_route_v1` distinguishes M7C1 one-off supply from M7B-linked legacy/demo DriverRoute rows. Legacy matching and batching explicitly require this marker to be null. Canonical request/order markers are rejected by legacy match/batch entry. Existing legacy coordinates/labels remain only compatibility data; canonical clients submit IDs and server-derived values.

Operational APIs and authorization:
- Driver owner APIs are `GET/POST /api/v1/driver/availabilities`, `GET/PATCH /api/v1/driver/availabilities/:id`, and activate/pause/resume/cancel POST transitions. Only active authenticated drivers with verified profiles may use them; unrelated records are concealed. Creation is idempotent; updates/transitions use optimistic revision. Beta limits are 1–8 seats, 0–20 parcels, 10-minute–30-day lead, and at most a two-hour availability window.
- `POST /api/v1/passenger/route-requests` requires active passenger auth and idempotency. It validates current published active route/version, active membership, passenger permissions, downstream order, 1–8 passengers, and a bounded window. It returns `canonical_route_v1` plus an explicit matching-disabled state.
- `POST /api/v1/merchant/route-orders` requires active merchant auth and idempotency. One route version owns the pickup and 1–50 parcel destinations; every destination is permission-checked and downstream. It returns explicit batching/matching-disabled states. Strict contracts reject coordinates, labels, actor IDs, sequence values, mixed legacy/canonical fields, and unknown properties.

Route eligibility, capacity, match/trip foundation:
- One shared operational validator requires an active ServiceRoute, its current published non-paused/non-retired version, active dates, contiguous active ordered memberships, and unchanged origin/destination boundaries. Geometry is intentionally not required.
- Internal `CapacityReservation` supports passenger/parcel/combined held capacity and confirmed/released/expired terminal states. Holds lock DriverRoute, conditionally decrement both counters, create history, and audit in one real MySQL transaction. Confirm never decrements again. Release/expiry lock reservation then availability and restore exactly once without exceeding totals. Expiry is an explicit bounded service only; no scheduled production worker or public capacity endpoint exists.
- Actor/operation/scope/payload-bound idempotency uses digests only. Exact replay returns the original resource; payload conflict fails. Safe audit allowlists contain IDs, categorical transition/reason, route version, counts, schema marker, and request ID only.
- A pure future compatibility helper enforces offer/availability/demand/reservation route equality and downstream order. A separately tested route snapshot builder emits only route/version/direction/bilingual stop identity plus checksum. Existing match acceptance and trip creation do not call either helper.

Migration, recovery, and evidence:
- A checksum-backed ignored backup preceded the populated upgrade; pre-upgrade aggregates were DriverRoute 2, PassengerRequest 1, MerchantOrder 1, Parcel 5, Match 0, Trip 0. The first local attempt found MySQL error 3823 for checked FK columns with cascading updates; no application row changed. The uncommitted new migration was corrected to restrictive updates, the failed attempt was safely marked rolled back after removing only its two partial indexes, and the corrected migration first passed from empty before populated deployment.
- Main MySQL now reports eleven migrations current. The disposable integration path applies all eleven from empty, repeats deploy as a no-op, and runs the legacy deterministic, trusted-session, onboarding, public-onboarding, route-lifecycle, and new M7C1 suites.
- The M7C1 real-MySQL suite passes 36 persistent-state scenarios covering route/stop eligibility, passenger/merchant references, duplicate availability, owner isolation, seat/parcel/combined holds, insufficient rollback, replay/conflict, confirm/release/expiry races, capacity bounds/restoration, legacy records, Arabic round-trip, and idempotent reset cleanup.
- Final local validation passed clean dependency installation, Prisma validation/generation, repeatable eleven-migration deploy/current status, workspace typecheck/build, 171 API tests, 27 admin tests, 8 tooling tests, standard/security/workflow/audit-policy gates, zero-change Flutter formatting, Flutter analysis, and 141 Flutter tests. A production-configured admin build and production-like release APK both built and passed artifact scanning. Raw `npm audit --omit=dev` retains only the three documented moderate Prisma CLI transitive findings; no force fix was run.
- The checksum-backed pre-upgrade backup restored into an isolated database and upgraded through all eleven migrations; the post-upgrade backup restored at current status. Both restore databases were removed. The final disposable real-MySQL integration reapplied all eleven migrations from empty, proved repeat deploy was a no-op, and passed every legacy and M7C1 harness before cleanup.
- Live preflight passed 22/22 against the MySQL-backed API, production admin, and Android emulator. Deterministic smoke retained score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`. Value-aware scanning found no configured secret in generated artifacts or captured logs, and captured logs contained no credential/header/body/coordinate markers. Dependency and Flutter source boundary scans confirmed no map/GPS/realtime package or M7C1 mobile client wiring.
- The draft PR must remain unmerged. Exact-head GitHub checks for Backend and MySQL CI, Admin CI, Flutter Android CI, and Security and Configuration CI remain the final delivery gate after this evidence commit is pushed.

Remaining boundaries:
- M7C1 must remain a draft, unmerged PR pending independent schema, migration, route/stop ownership, capacity concurrency, idempotency, authorization, privacy/logging, feature-gate, and legacy/demo compatibility review.
- M7C2 remains responsible for mobile route/stop selection. M7C3 remains responsible for canonical batching/matching/offers/acceptance/trips. M7D/M7E remain responsible for maps, providers, GPS, location ingestion, and realtime behavior.

[M7C1_INDEPENDENT_REVIEW_REMEDIATION]
Review findings and corrections (2026-07-22):
- Independent review of draft PR #8 found no Critical issue and identified High defects in availability/capacity serialization, cancellation and legacy-deactivation bypass, stale route eligibility and route-pause holds, cross-route Match reservations, incomplete legacy comparison/role/trip isolation, and holds against revoked driver supply. All findings were stated before code changed.
- Availability update/cancel now locks the owner DriverRoute before deriving usage or inspecting reservations. Timing edits reject held/confirmed usage. Hold, release, update, and cancellation races preserve exact counters and cannot leave a held reservation on cancelled supply. Legacy `/driver/routes` queries and deactivation exclude canonical availability.
- Canonical creation and holds lock the ServiceRoute and version and revalidate at a documented `READ COMMITTED` transactional eligibility point. A committed pause/publication wins against waiting demand or holds; an entry owning the locks first commits against the eligible immutable version.
- Holds lock and validate the driver profile and active account. Revoked verification, suspension, or disablement prevents new reservations. Optional Match references require the exact canonical route and availability in both the service and database.
- Legacy passenger/merchant/driver queries exclude canonical records. Comparison selects legacy demand only, matching authorizes before revealing the canonical isolation response, and legacy match acceptance/rejection rejects canonical offers. Production matching remains disabled.
- Forward-only migration `20260722180000_harden_multi_route_operations` adds canonical availability/count/marker/checksum/reason checks plus composite Match-to-availability/demand and reservation-to-Match route integrity. The original eleven migrations remain byte-stable. The migration replaces the older DriverRoute route-version FK update action with `RESTRICT` so MySQL 8.0.46 can enforce the new checked column safely.
- The expanded disposable real-MySQL suite applies all twelve migrations from empty, repeats deployment, and exercises direct-SQL ownership failures, exact concurrent idempotent holds, approval revocation, pause-versus-demand/hold, cancel-versus-hold, update-versus-release, cross-route Match/reservation attempts, poison-resistant expiry, capacity bounds, and persisted audit allowlists. It passes 53 persistent-state assertions.
- Final local review validation passes 176 API tests (including the 50/51-parcel boundary), 27 admin tests, 141 Flutter tests, 8 tooling tests, production-configured admin/APK artifact scans, 34 focused production-isolation tests, real-MySQL trusted-session/onboarding/route/multi-route suites, 22/22 runtime preflight, and exact deterministic smoke (`0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, winner `darb`). The required raw production dependency audit reports only the three approved moderate Prisma CLI transitives and no High/Critical advisory. Exact correction-head CI is recorded in the PR independent-review comment after all four workflows finish.

Remaining review obligations:
- A legacy-shaped Parcel can still be inserted under a canonical MerchantOrder only by a privileged direct database writer because nullable composite foreign keys do not enforce the inverse parent-to-child mode rule. Every application creation path is atomic, strict, and mode-consistent; M7C3 must preserve that invariant or add a normalized non-null order-mode key if standalone parcel creation is introduced.
- Legacy full-record endpoints may include newly nullable fields on legacy rows; current Flutter decoders tolerate unknown keys and canonical rows are now excluded. Explicit legacy serializer allowlists remain a recommended contract-hardening follow-up.
- Availability duplicate identity remains millisecond-sensitive, and deadlocks return a safe retryable transaction failure rather than using an internal retry loop. Both are documented non-blocking obligations while entry remains local/test/demo-only.
- M7C2, M7C3, maps, GPS, location ingestion, realtime, dispatching, pricing, and production enablement remain unimplemented and out of scope.

[M7C1_FOLLOW_UP_INDEPENDENT_REVIEW]
Follow-up findings and correction (2026-07-22):
- Review of corrected head `a8bda284d8c2a13c353230c713d551190fa22e7e` found no Critical issue and three High gaps: database mode crossing between canonical and legacy Match/availability/reservation rows, route eligibility that did not serialize membership/stop retirement, and a hold that did not recheck the availability owner's current `driver` role. All findings were stated before their corresponding edits.
- Forward-only migration `20260722200000_enforce_operational_mode_and_expiry_quarantine` extends the byte-stable twelve-migration history. Non-null `operational_mode` values and composite mode foreign keys now reject canonical Match/reservation references to legacy supply and legacy Match references to canonical supply even when nullable route columns would otherwise skip a composite foreign key. No existing migration, frozen tag, or release branch was changed.
- Eligibility now locks ServiceRoute, ServiceRouteVersion, ordered RouteVersionStop memberships, and referenced Stops in deterministic order before rereading the complete eligible route. A committed stop retirement therefore wins against waiting demand or holds; an entry that owns all eligibility locks first completes against the immutable eligible graph.
- Holds now require the locked availability owner to remain a verified DriverProfile attached to an active `driver` User. Revoked approval, suspended/disabled account, changed role, non-active supply, route mismatch, mode mismatch, or unrelated availability rejects without a surviving decrement or reservation.
- Expiry processing remains bounded and per-row isolated, returns safe failed IDs/counts, and persistently quarantines a categorical corrupt row after three failed attempts. Valid rows around the poison candidate still expire and restore capacity exactly once.
- Legacy passenger, merchant, and driver responses now use surgical serializer allowlists; canonical markers, canonical stop/demand fields, and the new operational mode are absent. Legacy driver supply selection, matching, and batching require both the null legacy marker and explicit `operational_mode=legacy`. Match accept/reject requires legacy mode. Prisma transaction conflicts return safe retryable HTTP 409 without raw SQL or Prisma detail.

Corrective verification:
- Two independently empty MySQL 8.0.46 databases using `utf8mb4_0900_ai_ci` applied all thirteen migrations. Status was current and repeat deploy was a no-op. The expanded M7C1 suite passes 78 persistent-state assertions, including direct SQL mode/route/demand ownership failures, exact update-versus-hold/release/expiry totals and audit counts, cancellation safety, status/role revocation, stop retirement serialization, ten-way same-identity replay and post-commit response-loss recovery, atomic 50/51-parcel boundaries, and poison-row quarantine.
- The broader disposable sequence passes deterministic demo smoke, trusted-session concurrency, onboarding foundation, 76-check public onboarding, M7B route lifecycle/concurrency, and the M7C1 harness. Deterministic values remain score `0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, winner `darb`.
- The privileged direct-database inverse Parcel mode limitation remains accepted only because all runtime merchant creation is one strict nested transaction and no ETL/import/admin/standalone Parcel writer exists. M7C3 owns normalized parent-child mode enforcement before any standalone writer is introduced.
- Millisecond-different availability departures remain independent capacity rows by design; exact retries remain idempotent. Lock ordering is documented in `docs/operations/m7c1-migration-and-recovery.md`; bounded internal deadlock retry remains optional because rollback is atomic and callers receive a safe retry category.
- M7C2, M7C3, maps, GPS, realtime, pricing, dispatching, production enablement, and mobile/admin feature work remain unimplemented. PR #8 remains draft and unmerged pending exact-head CI and team-leader action.

[M7C1_POST_MERGE_CLOSURE]
Merge and migration record (2026-07-23):
- M7C1 is merged and closed through PR #8 using merge commit `77e7035abbb9ff6ae649a482b17918bdcfe0a1b4`. The approved final feature head is `a3f8080f566eb100c877651c84a77a199db36487`; its implementation and corrective commits remain visible in merge history.
- All thirteen forward-only MySQL migrations are current. The M7C1 sequence is `20260722130000_multi_route_operational_foundation`, `20260722143000_isolate_canonical_availability`, `20260722180000_harden_multi_route_operations`, and `20260722200000_enforce_operational_mode_and_expiry_quarantine`. Historical migrations remained byte-stable; no `db push`, reset, resolution, or manual checksum change was used.
- Canonical operational references bind supply, passenger demand, merchant order/parcel demand, optional Match ownership, and reservations to one immutable route version and ordered route-stop memberships. Composite route/stop/mode foreign keys and shape checks reject mixed ownership and legacy/canonical crossings.
- Driver availability owner APIs provide one-off create/read/list/update and activate/pause/resume/cancel transitions. Passenger canonical request and merchant one-route order APIs accept normalized route/stop identities only, enforce downstream permissions, and remain explicitly matching/batching disabled.
- Transactional holds serialize route eligibility, driver approval/account/role, supply status, and remaining capacity. Exact replay yields one reservation identity, one decrement, one audit event, and one completed logical result. Confirm does not decrement again; release/expiry restores exactly once; counters cannot become negative or exceed totals.
- Expiry work is explicitly invoked, bounded, per-row isolated, and persistently quarantines categorical poison rows after three failures. Availability updates, cancellation, holds, release, confirm, and expiry share the reviewed lock order and preserve exact capacity under races.
- Legacy passenger, merchant, driver, matcher, batcher, comparison, Match accept/reject, and Trip creation paths use explicit isolation predicates and serializer allowlists. Canonical rows produced zero legacy Match or Trip mutations during merged-head verification.
- `MULTI_ROUTE_ENTRY_ENABLED` defaults false and remains forbidden in staging/production. `MULTI_ROUTE_MATCHING_ENABLED` defaults false and fails startup in every environment. Disabled canonical endpoints return 404 before identity or resource disclosure; no external capacity mutation endpoint exists.

Post-merge validation evidence:
- Local validation passed Prisma validate/generate, current and repeat no-op migration deploy, workspace typecheck/build, 178 API tests, 27 admin tests, 141 Flutter tests, 8 tooling tests, workflow/security gates, and the raw production audit. Only the three approved moderate Prisma CLI transitive findings remain; no force fix was run.
- A fresh disposable MySQL 8.0.46 database using `utf8mb4_0900_ai_ci` applied all thirteen migrations from empty, repeated deploy as a no-op, reported current status, and passed deterministic demo, trusted-session, onboarding, 76-check public-onboarding, route-lifecycle, and M7C1 integration suites. M7C1 passed 78 persistent-state assertions and cleaned up its database.
- The runtime/API coverage includes trusted active-role enforcement; owner-only availability; valid driver, passenger, and merchant flows; cross-route/reverse/arbitrary-field rejection; the atomic 50/51-parcel boundary; availability and reservation races; exact response-loss replay; same-key/different-payload conflict; poison expiry; and safe retryable deadlock/transaction conflict behavior.
- A checksum-backed migration-12 backup restored into an isolated database and upgraded through migration 13. A post-M7C1 backup restored at current status. Both isolated restore databases were removed. Read-only merged-state checks confirmed ownership/mode foreign keys, capacity checks, expiry quarantine fields/index, valid legacy null-route/mode shapes, and zero canonical leakage.
- Live preflight passed 22/22 against the MySQL-backed API, production admin, and Android emulator. Deterministic smoke remained score `0.9317`, tracking sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.
- Production-configured admin and production-like release APK builds passed artifact-isolation scans. M7C2 strings/UI, map/GPS/realtime code, production canonical seeds, and demo-only mutation controls remain absent from production artifacts. The frozen hackathon APK remains a separately classified demo artifact.
- All four workflows passed on PR #8 merge commit `77e7035abbb9ff6ae649a482b17918bdcfe0a1b4`: Admin CI, Backend and MySQL CI, Flutter Android CI, and Security and Configuration CI.

Accepted obligations and next boundary:
- Privileged direct-database insertion of an inverse-mode Parcel remains outside the normal application threat boundary. Before M7C3 introduces any standalone Parcel writer, import, admin creation, ETL, or direct application writer, it must add normalized non-null parent/child operational-mode enforcement.
- Millisecond-different driver departures intentionally remain separate availability identities with separate capacity. Bounded internal deadlock retry is optional future hardening; M7C1 guarantees atomic rollback and a safe retryable response category.
- M7C2 is implemented on its review branch. M7C3 canonical matching/batching/offers/acceptance/trips, maps, GPS, location ingestion, realtime, pricing, and dispatching remain future milestones.

[M7C2_FLUTTER_MULTI_ROUTE_ROLE_FLOWS]
Approved implementation boundary (2026-07-25):
- M7C2 is a Flutter-first data-entry and lifecycle milestone. It adds separate canonical role flows without replacing or reinterpreting the deterministic fixed-corridor passenger, driver, merchant, matching, or trip paths.
- The server remains authoritative through an authenticated safe capability result. Catalog publication and canonical entry are independent; production/staging entry remains forbidden, matching remains disabled everywhere, and stale cached capability or route data cannot authorize submission.
- Mobile route selection uses only stable route/version/stop IDs, bilingual names, direction, active dates, ordered sequence, and pickup/drop-off permissions. It accepts no address, coordinate, route label, geometry, recurrence, price, assignment, or capacity-reservation authority.
- Exact uncertain create operations persist the minimum versioned, actor-bound replay bundle only in secure storage before any send. A changed payload, different operation, or different actor cannot replace or consume an unresolved bundle. Authentication termination preserves the encrypted bundle while clearing credentials; only the same reauthenticated actor can recover it. Confirmed results clear only after UI acknowledgement or owner-detail reconciliation. Expired, clock-anomalous, and unreadable bundles are quarantined for support-assisted resolution rather than silently deleted.
- No Prisma schema or migration change is planned. Existing driver owner list/detail contracts and idempotent create replay are sufficient; passenger/merchant history reads remain optional and out of scope.
- M7C3 must enforce normalized MerchantOrder/Parcel operational mode before any standalone Parcel writer, import, admin creation, ETL, or direct application writer. M7C3 also owns matching, batching, offers, capacity holds, acceptance, assignment, and canonical trips.
- No map SDK/provider, route-line placeholder, GPS/location permission, location ingestion, realtime transport, dispatching, or pricing is part of M7C2. Maps remain an M7D boundary.

Implemented branch state (2026-07-25):
- The API now exposes authenticated safe capability booleans and the public route catalog omits coordinates. No schema, migration, write contract, capacity service, matching, batching, or trip behavior changed.
- Flutter has strict typed capability/catalog/route/version/stop/availability/request/order models. Canonical navigation is role scoped and server gated; the original deterministic role flows remain present and unchanged.
- Drivers can list, create, inspect, activate, pause, resume, and cancel one-off availability using server state and revisions. Passengers select permitted pickup and downstream drop-off stops. Merchants submit one atomic 1–50 parcel route order with same-route downstream destinations.
- Atomic creates persist an actor-bound exact-replay bundle only in secure storage after fresh capability/current-route validation and before network send. Temporary and idempotency ambiguity retains the same key; changed payloads and other actors are blocked; logout/session termination preserves the encrypted unresolved bundle. Confirmed results clear only after result acknowledgement or driver owner-detail reconciliation. The 24-hour boundary, clock anomalies, and unreadable state quarantine the bundle and require support-assisted resolution. Restored selection remains tentative, and new operations require capability/catalog revalidation.
- Arabic/English strings, RTL/LTR direction, textual ordered-stop timeline, minimum Material targets, semantics, scrollable responsive layouts, and truthful matching-disabled confirmations are included.
- Focused API capability/privacy tests and Flutter contract, ordered-permission, replay, temporary/terminal error, changed-payload, tamper, and rapid-tap tests are present. Complete MySQL/emulator/artifact/deterministic validation remains the delivery gate before the draft PR can be considered review-ready.
- During M7C2 validation, the registry disclosed a high PostCSS advisory and a moderate advisory in Prisma CLI's exact-pinned `valibot`. A non-breaking lockfile-only PostCSS/nanoid refresh removed the High finding. `valibot` remains documented only inside the non-runtime Prisma CLI moderate exception because the proposed npm repair changes Prisma outside its approved range; no force fix or Prisma change was made.

Final validation evidence (2026-07-25):
- Clean npm install, Prisma validation/generation, repeat no-op deployment and current status for 13 migrations, workspace typecheck/build, 179 API tests, 27 admin tests, eight tooling tests, and standard/security policy passed. The raw production audit retains only four approved moderate Prisma CLI transitives and no High/Critical finding.
- Flutter dependency/localization generation, zero-change formatting, analysis, and 155 tests passed at the implementation head. The independent review correction adds actor/operation isolation, write-before-send, delete-after-result, logout preservation, ambiguity classification, expiry quarantine, strict catalog parsing, and focused regressions; its final test count and runtime evidence are recorded at review handoff. Debug and production-like APKs built; the production admin and APK artifact scans passed.
- The dedicated real-MySQL empty/current suites passed migration repeatability, trusted sessions, onboarding, public onboarding, M7B routes, and the M7C1 78-assertion operational/concurrency harness, then cleaned up. Checksum-backed backup/isolated restore verification passed and removed the restore database.
- Emulator API 36 validation passed Arabic-first RTL, English LTR, driver availability lifecycle, passenger canonical request, merchant atomic route order, truthful matching-disabled outcomes, system back, landscape, and 200% text. A raw service-region key discovered in the route card was removed and the rebuilt APK was rechecked.
- Live demo preflight passed 22/22. Deterministic smoke retained score `0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`. Production artifact and captured-log scans found no forbidden configuration, credential, authorization, idempotency-header, coordinate, demo-control, matching, map, GPS, or realtime leakage.

Independent M7C2 correction review (2026-07-25):
- No Critical issue was proven. High-risk recovery defects were corrected before review readiness: actor-bound bundles survive logout/session termination; unresolved payloads/operations/accounts cannot replace or consume one another; secure persistence precedes send; temporary and ambiguous idempotency outcomes preserve the exact key; confirmed results clear only after UI acknowledgement or owner-detail reconciliation; and expired/clock-anomalous/unreadable state is quarantined.
- Capability and current-route eligibility are fetched immediately before every new create. Exact replay intentionally bypasses new-route eligibility so a previously committed operation can return its stored result without creating a replacement.
- Public route/stop serialization now omits route/region/stop keys, geometry, descriptions, schedule offsets, dwell values, and other internal catalog fields. Flutter parsing allowlists safe fields, validates route/version lifecycle enums, and rejects duplicate/invalid stop ordering.
- Real emulator correction testing reproduced passenger and merchant process death after commit and before acknowledgement. Exact replay retained one request/order and parcel set, with zero canonical Match/Trip records. Cross-account access was blocked. A driver result-reconciliation defect caused by Flutter microseconds versus MySQL milliseconds was found, corrected, and covered; the exact owner detail then cleared the bundle and the merchant flow proceeded.
- Final local correction gates passed 179 API tests, 27 admin tests, 163 Flutter tests, eight tooling tests, production artifact scans, empty/repeatable 13-migration deployment, trusted sessions, onboarding, 76-check public onboarding, route lifecycle, the M7C1 78-assertion harness, backup/isolated restore, 22/22 preflight, and deterministic smoke. The final protected reset left zero canonical availability/request/order/match/trip records.
- Accepted non-blocking follow-ups are dirty-form back warnings, a spoken 50-parcel limit reason plus dedicated TalkBack 50/51 automation, optional driver edit UI, and a future owner-history/support reconciliation contract for operations beyond the server idempotency window. M7C3 matching/trips and M7D maps/GPS/realtime remain unstarted.

[M7C2_POST_MERGE_CLOSURE]
Merge and release-integrity record (2026-07-26):
- M7C2 is merged and formally closed through PR #9. The approved feature head is `d981504fa207a17722354649b2278a411b4a5dcd`; merge commit `26406815aa6bf9712021c803c0a8f548b381ccad` preserves the reviewed implementation and correction history.
- Frozen annotated tags were verified locally and remotely by both raw tag object and peeled commit target. `v0.1.0-hackathon` has tag object `8c25fe06ec2ab0003089eb67fd5bda1679319088` and still peels to approved PostgreSQL commit `074fc4e7cc79c6b08a2baa18ca251b4802aa48c7`. `v0.2.0-hackathon-mysql` has tag object `58727273420cd657b44da8b18ed54b3749aa7057` and still peels to approved MySQL commit `7f5c5bace1b081c32f6a24a7352c6b163ac97438`. The prior apparent discrepancy was tag-object SHA versus commit-target SHA; no tag was changed.
- The merged feature branch was removed locally and remotely only after ancestry verification. Local `production-readiness` was synchronized exactly to the merge commit before validation.

Merged-head MySQL and regression result:
- The local port-3306 failure was isolated to an unrelated MySQL 8.4 service and its active application connections; the prior `ER_CANNOT_RETRIEVE_RSA_KEY` came from the Node MariaDB client used by preflight, not Prisma. The unrelated service was not stopped or modified. Closure validation instead used an isolated disposable MySQL `8.0.46` server on a non-conflicting local port with `caching_sha2_password`, available TLS/RSA support, and `utf8mb4_0900_ai_ci`; no obsolete authentication plugin or application-source workaround was introduced.
- All thirteen forward-only migrations applied from empty, repeated deployment was a no-op, migration status was current, and the schema and migration checksums remained unchanged. No `db push`, reset, migrate resolution, or migration edit was used.
- The disposable real-MySQL sequence passed deterministic reset/reseed, trusted sessions, onboarding, the 76-check public-onboarding harness, route lifecycle/concurrency, and the M7C1 78-persistent-assertion operational harness. Checksum-backed backup/isolated restore verification passed, and canonical runtime data and disposable databases were cleaned.
- Normal-shell validation passed dependency installation, Prisma validate/generate, workspace typecheck/build, 179 API tests, 27 admin tests, 163 Flutter tests, eight tooling tests, standard/security/workflow gates, production-configured admin build, debug and production-like release APK builds, and the raw production audit. Only the four documented moderate Prisma CLI transitives remain; no force fix was run.

Merged-head Flutter and secure-recovery evidence:
- The API 36 emulator used the real MySQL-backed local/demo API with canonical entry explicitly enabled and canonical matching disabled. Arabic opened by default with RTL and the correct `مساري` brand; English switched to LTR.
- Driver verification covered the canonical catalog, ordered stops, one-off availability creation, activate, pause, resume, eligible cancellation, truthful conflict/no-match behavior, and zero canonical MatchOffer or Trip. The automated exact-head response-loss, lifecycle replay, refresh-key preservation, logout ambiguity, same-account recovery, other-account isolation, and role rejection evidence applies unchanged to the merge commit.
- Passenger verification created exactly one canonical request from a permission-filtered pickup to a downstream drop-off, with zero canonical MatchOffer and zero canonical Trip, and rendered the truthful matching-disabled result. Process-loss replay, logout recovery, actor isolation, and stale route/capability revalidation remain covered by the merged 163-test suite and the approved exact-head emulator evidence.
- Merchant verification atomically created one canonical order with three parcels and zero canonical MatchOffer/Trip, then rendered truthful batching/matching-disabled copy. The real-MySQL harness retains exact 50-accepted/51-rejected-before-write evidence; merged tests and approved exact-head emulator evidence retain response-loss/process-death recovery, payload-change blocking, logout recovery, and cross-account isolation.
- Versioned actor-bound secure bundles are persisted before send, survive credential/session termination, retain the original idempotency key through refresh and ambiguous replay, cannot be overwritten by another payload/operation/actor, and are deleted only after durable acknowledgement or owner reconciliation. Corrupt, expired, and clock-anomalous bundles enter quarantine/support state. Only secure-storage key names were inspected.
- Selected merged-head portrait, landscape, 200% text, small-screen, system-back, AppBar-back, and rotation checks remained usable without duplicate submission, second navigation, or clipped primary actions. Semantic widget coverage protects route cards, ordered stops, selections, capacity/parcel controls, lifecycle actions, safe errors, and matching-disabled notices.

Production-like, legacy, and CI closure:
- The production-like release APK launched fail-closed against its unreachable production-style endpoint, contained no demo account controls, and kept canonical entry hidden/guarded. The manifest requests only Internet access; there is no map SDK/surface, Android location permission, capacity-reservation mutation client, MatchOffer/canonical Trip UI, GPS ingestion, route pricing, or direct realtime dependency.
- Production admin and release-APK isolation scans passed. Actual local secret/runtime values were absent from the API/admin/release-APK and captured API/admin/Flutter logs; no token, authorization header, password, database URL, raw idempotency key, secure-bundle payload, merchant payload, parcel description, coordinate, internal region key, or M7C3 control was observed. The API build intentionally retains only the approved synthetic demo phone fixtures required by the protected deterministic reset and compiled test harnesses; no real/user phone data was captured.
- Legacy/demo regression ran after canonical role-flow execution and left zero canonical MatchOffer, Trip, or availability mutation. Preflight passed `22/22`; deterministic smoke remained score `0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.
- All four workflows passed on exact merge commit `26406815aa6bf9712021c803c0a8f548b381ccad`: Admin CI, Backend and MySQL CI, Flutter Android CI, and Security and Configuration CI.

Accepted obligations and next boundary:
- Dedicated dirty-form back warnings, a spoken disabled reason at the 50-parcel limit, dedicated TalkBack 50/51 automation, optional driver edit UI, support-assisted recovery beyond server idempotency retention, and investigation of intermittent Windows aggregate-runner `spawn EINVAL` remain accepted Medium/Low obligations. Individual Windows harnesses and Linux CI passed in this closure.
- M7C3 has not started. It retains the normalized non-null MerchantOrder/Parcel parent-child operational-mode obligation before any standalone Parcel writer, import, admin creation, ETL, matching, batching, offer, acceptance, capacity assignment, or canonical Trip work.
- M7D maps, map-provider integration, GPS/location permission or ingestion, realtime transport, dispatching, and pricing have not started.

[M7C3C2_FLUTTER_SHARED_TRIP_PRESENTATION]
Implementation record (2026-08-05):
- M7C3C2 adds a separate local/test/demo-only shared mobile gate and safe capability booleans. It depends on canonical entry, matching, Trip creation, and shared backend gates, defaults false, and remains startup-forbidden in staging/production. Shared backend matching can remain independently enabled without advertising mobile access.
- Driver shared-offer list/detail and accept/reject use separate `/driver/canonical-shared-offers` endpoints, strict `canonical_shared_trip_match_v1`/`canonical_shared_trip_v1` models, independent keyset pagination, server-time expiry, manual refresh, and foreground-resume refresh. Individual M7C3B pagination and routes remain separate.
- Passenger-only, merchant-only, and mixed manifests show aggregate request/seat/order/parcel totals plus server-produced, canonical-order, privacy-safe stop events. No member/demand/recipient/parcel identity, fingerprint, reservation, snapshot, coordinate, score, or remaining-capacity data is retained by Flutter.
- Accept/reject applies to the complete manifest. Version-2 actor-bound secure bundles are written before send, retain one stable idempotency key through token refresh and ambiguous replay, share the global canonical operation slot, and clear only after exact terminal reconciliation. Capability loss sends no mutation and preserves unresolved recovery state.
- Passenger and merchant assignment screens use strict Trip-version/shared discriminators, show only a neutral shared-assignment indicator and the owner's existing data, and remain co-member blind. Unknown Trip status/vehicle values use localized safe wording rather than raw enums.
- Arabic/English localization, RTL/LTR, concise card and stop-event semantics, explicit disabled reasons, dirty-rejection back warning, scrollable responsive layouts, truthful conservative-capacity wording, and explicit no-live/no-tracking messaging are implemented. Automated Flutter coverage now includes shared contract, privacy, capability, pagination endpoint, recovery ordering, replay, mutual exclusion, stale-response, assignment, RTL/200% text, and back-warning cases.
- No Prisma schema or migration changed; all 18 migrations and M7C3C1 matching/capacity/Trip behavior remain outside this presentation milestone. No segment capacity reuse, matching invocation, manifest editing, Trip lifecycle mutation, map/GPS/location permission, realtime, ETA, pricing, payment, or dispatch control was added.
- Final corrected validation passed 205 API tests, 27 Admin tests, 203 Flutter tests, nine tooling tests, Prisma/typecheck/build/standard/security gates, production-configured Admin and production-like APK scans, and the raw audit policy with only four approved moderate Prisma CLI transitives. MySQL 8.0.46 applied all 18 migrations from empty, repeated as a no-op, retained both approved normalized checksums and all five integrity triggers, and passed the M7C3C1 141-, M7C3A 98-, M7C1 79-, and public-onboarding 76-check harnesses plus trusted sessions, onboarding, route lifecycle, backup/restore, and cleanup.
- API 36 device evidence covered Arabic-default RTL and English LTR; separate shared navigation; passenger-only acceptance; merchant-only categorical rejection; mixed acceptance; aggregate stop events and conservative-capacity wording; one-Trip persistent state; passenger/merchant co-member-blind assignments; portrait; landscape at 200% text; manual refresh/no-live wording; and absence of lifecycle/map/ETA/tracking controls. Rejected state restored capacity exactly once and created zero Trip. Mixed acceptance assigned both dispatches to one Trip and one snapshot.
- Preflight passed 22/22 and deterministic smoke remained score `0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, winner `darb`. Production-like artifacts remain fail-closed with Internet-only Android permission and no map/GPS/realtime dependency.
- Automated coverage proves response-loss replay, write-before-send, no-send on secure-save failure, one-slot actor/operation isolation, logout preservation, capability-loss retention, stale-response fencing, exact reconciliation, and quarantine behavior. The exhaustive hands-on process-death timing matrix, every rotation-in-flight/back variant, full gesture-back matrix, maximum-timeline/count automation, smaller-physical-device coverage, and a full manual TalkBack pass remain accepted evidence obligations and are not claimed as executed. PR-head and merge-commit CI passed; the formal closure record above is authoritative. M7C3C3, M7D, and M7E have not started.
