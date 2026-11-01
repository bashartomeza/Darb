# Masari — Full Product Requirements and Remaining Edits

**Product:** Masari / مساري  
**Document:** Product requirements, current feature inventory, and remaining-work register  
**Version:** 1.0 — review draft  
**Prepared:** 2026-10-25, Asia/Hebron  
**Repository:** `bashartomeza/Masari`  
**Inspected source:** `5b3cb6bde36738fc2c88e9a3addf6dc1237ab31f`  
**Inspected tree:** `febe1273784f857bcffe4273dd6489f23b915102`  
**Parent:** `f4e53850032a13d22f2bb6689c510fbf921e54a5`  
**Associated baseline:** Draft PR #63, as identified in the task history; current GitHub metadata was not refreshed for this document.  
**Distribution:** Local planning artifact. No private checkpoint dataset, provider records, credentials, or user data included.

### Contents

- [Purpose and evidence](#1-purpose-and-evidence-boundary)
- [Product definition](#2-product-definition)
- [Users and access](#3-users-and-access-boundaries)
- [Architecture](#4-platform-and-architecture-inventory)
- [All user-facing screens](#5-complete-user-facing-screen-inventory)
- [Admin website](#6-complete-admin-website-inventory)
- [Core functional requirements](#7-core-functional-requirements-and-acceptance-criteria)
- [Checkpoint boundaries](#8-checkpoint-products-three-distinct-boundaries)
- [Maps, search, tracking, assistant and limits](#9-maps-search-tracking-assistant-and-unsupported-claims)
- [Data and state](#10-data-and-state-requirements)
- [Remaining edits and owner actions](#11-remaining-edits-and-owner-action-register)
- [Nonfunctional requirements](#12-security-privacy-accessibility-and-reliability-requirements)
- [Validation and acceptance](#13-validation-plan-and-release-acceptance)
- [Approval decisions](#14-decisions-requiring-accountable-approval)
- [Delivery order](#15-recommended-delivery-order)
- [Release gates](#16-release-gate-snapshot)
- [Evidence index](#17-evidence-and-source-index)
- [Document checklist](#18-document-completion-criteria)
- [API surface inventory](#19-api-surface-inventory)

## 1. Purpose and evidence boundary

This document inventories Masari's existing web/mobile product and Admin console, records the requirements that must remain true, and lists the edits, decisions, and verification still needed. “The site” is interpreted as the Masari application in this repository: the Flutter user application, React Admin dashboard, and supporting API. No separate marketing website URL was supplied or inspected.

The inventory comes from current routing, screen components, API modules, Prisma models, tests, and operational documentation. A source file or test establishes that implementation or coverage exists; it does not establish that a deployed service works, a test currently passes, or a feature has production approval.

No live site walkthrough, test suite, build, dependency audit, provider request, database operation, credential injection, merge, or deployment was performed to prepare this PRD. Earlier successful QA reports are historical evidence only. This document does not reauthorize work from earlier tasks or certify production readiness.

### Status vocabulary

| Status | Meaning |
| --- | --- |
| `IMPLEMENTED` | A routed screen and/or supporting implementation exists in the inspected source. Runtime verification is separate. |
| `PARTIAL` | A surface exists, but specific functions or backing services are absent. |
| `GATED` | Implementation exists behind configuration/capability controls; this does not authorize enabling it. |
| `MISSING` | An inspected surface explicitly reports that its backing feature is unavailable. |
| `DESIGN_ONLY` | A design or proposal exists without an implemented product feature. |
| `REPORTED_COMPLETE` | Earlier tasks report completion; preserve the correction and verify it on a future release candidate. |
| `UNVERIFIED` | Evidence is insufficient to make a stronger claim. |
| `BLOCKED` | A named authorization, policy, provider, or verification prerequisite is unresolved. |

### Scope of “remaining edits”

- **Required release work:** security, authorization, conformance, documentation consistency, and release-candidate verification.
- **Confirmed product gaps:** unavailable notifications, incident workflows, report exports, and explicitly unsupported metrics.
- **Proposed future work:** needs separate scope, product approval, and, where applicable, schema approval. These are not automatically approved implementation tasks or defects.
- **Preserved fixes:** earlier resolved bugs remain regression requirements, not an instruction to implement them again.

## 2. Product definition

Masari is an Arabic-first, Palestine-focused route-sharing and logistics application. It supports Passenger transport requests, Merchant parcel orders, eligible Driver supply, matching and trip execution, and Admin oversight. The existing corridor and the separately gated canonical/multi-route system coexist; their identities, matching, capacity, and histories must remain distinct.

### Goals

1. Persist legitimate requests and orders reliably, including after a lost response or application restart.
2. Match eligible demand to eligible supply through the existing workflows without duplicate offers, trips, parcels, or capacity holds.
3. Keep role-specific screens consistent with authoritative server state.
4. Preserve Arabic and English labels, RTL/LTR behavior, coordinates, and route identities.
5. Make unavailable, stale, uncertain, gated, and failed states truthful and understandable.
6. Protect account boundaries, server credentials, private operational data, and immutable history.
7. Separate locally verified engineering work from provider permission and production approval.

### Non-goals and constraints

- No UI/Figma redesign, new visual system, or changes to approved typography/layout in the recovery scope.
- No new Voice Assistant/AI UI or implementation of the nine experimental “For Testing” modules.
- No new pricing, tariffs, payments, autonomous dispatch, trust policies, quota-key pooling, or unsupported cryptographic claims.
- No inferred checkpoint traffic status, fabricated coordinates, automatic provider matching, or claim that public listings equal the authenticated provider inventory.
- No production database access, production feature activation, merge, deployment, force-push, squash, or rebase authorized by this document.
- No new migration without a verified need and separate approval; never edit historical migration SQL or checksums.
- No CodeRabbit use. Any later review must state its actual reviewer and coverage.

## 3. Users and access boundaries

| Actor | Primary needs | Boundary |
| --- | --- | --- |
| Visitor / signed-out user | Sign in, supported registration or recovery, choose language | No access to operational Passenger, Driver, Merchant, or Admin records. |
| Passenger | Find supply, submit/recover a request, inspect a match/trip, cancel within existing rules | Own records and approved safe trip summaries only. |
| Driver | Manage eligible supply, receive offers, accept/reject, execute trips | Approved/verified and active account required; own offers/routes/trips only. |
| Merchant | Create/recover orders, explicitly batch and match parcels, follow delivery | Own orders, parcels, matches, and authorized summaries only. |
| Admin | Inspect users/drivers, approve driver verification, manage permitted operational and consent workflows | Authenticated Admin-only API actions; no implicit permission to expose credentials or override lifecycle rules. |
| Provider/security/legal owners | Approve access, permissions, retention, freshness, legal content, and release prerequisites | Written accountable decisions and redacted evidence; application code cannot substitute for those decisions. |
| Developer/operator | Run approved disposable QA and controlled development verification | Separate explicit authorization for a real provider request; no production approval implied. |

Roles must be enforced server-side as well as by navigation. Complete-profile and current-session requirements remain applicable. A guessed record ID, cached response, deep link, or role-tab switch must not grant access.

## 4. Platform and architecture inventory

| Layer | Existing implementation | Required preservation |
| --- | --- | --- |
| User application | Flutter/Dart; Riverpod providers; GoRouter; Arabic/English localization; web and Android targets | Stable routing lifecycle, actor-bound state, existing components, accessible RTL/LTR rendering. |
| Admin | React/TypeScript/Vite; hash navigation; shared UI primitives | Existing ten-module navigation, truthful unavailable states, server authorization, session-safe async results. |
| API | Express/TypeScript; versioned `/api/v1` modules | Existing contracts, role checks, validation, bounded errors, request correlation. |
| Database | Prisma with MySQL; forward migrations and integrity checks | Transactions, locking, constraints, audit linkage, historical checksum preservation. |
| Legacy operations | Passenger requests, DriverRoute supply, Merchant orders/parcels/batches, matches, trips | Existing manual actions and state/capacity behavior. |
| Canonical operations | Route versions/stops, availabilities, reservations, dispatches, offers, manifests, immutable trip snapshots | Separately gated; never blend with legacy matching or reports. |
| External boundaries | Server-side route preview adapters, checkpoint adapters, configured assistant services | Server-only secrets; explicit provider/legal approval; no direct client credential use. |
| QA/tooling | Unit/widget tests, tooling tests, guarded MySQL integrations, artifact/secret scans, four workflows | Synthetic fixtures, disposable resources, exact-head evidence, no weakened assertions. |

There is no independently verified production deployment inventory in this assessment. Existing demo screenshots and demo scores are not live production measurements.

## 5. Complete user-facing screen inventory

Route patterns below are GoRouter paths. Web builds may display them after `#`. Parameter names represent record identities; they are not permissions. Routed existence does not mean the associated capability is enabled.

### 5.1 Shared authentication, onboarding, account, and language

| ID | Screen / path | Existing function | Status / remaining boundary |
| --- | --- | --- | --- |
| AUTH-01 | `/` → `/splash`; `/splash` | Startup and auth restoration routing | `IMPLEMENTED`; retain restoration and session validation. |
| AUTH-02 | `/login` | Credential login, configured Google sign-in, errors and retry | `IMPLEMENTED`; preserve the corrected stable router and first retry character. Provider configuration remains environment-specific. |
| AUTH-03 | `/signup` | Existing sign-up entry and supported auth flows | `IMPLEMENTED`; do not treat it as unrestricted public registration. |
| AUTH-04 | `/auth/complete-registration` | Complete supported authentication registration | `IMPLEMENTED`; honor continuation/session rules. |
| AUTH-05 | `/profile/phone` | Phone/profile completion flow | `IMPLEMENTED`; verification/provider availability must be truthful. |
| AUTH-06 | `/onboarding` | Gated invitation/onboarding, OTP, consent, role/profile stages | `GATED`; real delivery, legal publication, and production enablement are separate prerequisites. |
| AUTH-07 | `/onboarding/recover` | Recover pending account/status flow | `GATED`; preserve secure continuation and expiry handling. |
| AUTH-08 | `/unsupported-role` | Explicit unsupported-mobile-role state | `IMPLEMENTED`; do not redirect an Admin into another actor's mobile role. |
| SEC-01 | `/passenger/account`, `/driver/account`, `/merchant/account` | Shared session management in role-specific tabs | `IMPLEMENTED`; safe session summaries, revoke session, logout, logout-all. |
| SEC-02 | `/security/sessions` | Compatibility link to the current role's account tab | `IMPLEMENTED`; keep supported deep links working. |
| LOC-01 | Shared language switch | Arabic/RTL and English/LTR | `IMPLEMENTED`; preserve locale, complete names, mixed-script identifiers, dates and error labels. |

Current account surfaces focus on sessions. Do not claim general profile editing, uploaded identity evidence, unrestricted merchant approval, or a complete account-preferences editor merely because an Account tab exists.

### 5.2 Passenger

| ID | Screen / path | Existing content and action | Status / remaining boundary |
| --- | --- | --- | --- |
| PAX-01 | `/passenger` | Dashboard, request/supply-related content, trip offers, entry points | `IMPLEMENTED`; values come from supported API data; absent prices/ratings must not be invented. |
| PAX-02 | `/passenger/request/new` | Select pickup/destination, preserve labels/coordinates, passenger/time input, create request | `IMPLEMENTED`; selected driver-route identity and durable operation recovery are mandatory. |
| PAX-03 | Location picker, opened within request flow | Select a location and return its name/coordinates | `IMPLEMENTED`; no new external geocoder approval implied. |
| PAX-04 | `/passenger/assistant` | Existing configured conversational request assistance and booking handoff | `IMPLEMENTED`; uses existing backend assistant boundary. It is not evidence of voice functionality or the nine experimental modules. No new AI scope authorized. |
| PAX-05 | `/passenger/request/:id` | Request details, status, related trip, existing matching/cancellation actions | `IMPLEMENTED`; refresh both request and related trip; reconcile response loss. |
| PAX-06 | `/passenger/match/:id` | Own match details and supported next action | `IMPLEMENTED`; server determines ownership and valid state. |
| PAX-07 | `/passenger/trips` | Own request/trip history | `IMPLEMENTED`; preserve exact request-to-trip association. |
| PAX-08 | `/passenger/trip/:id` | Trip details, map/markers when allowed, route and trip status | `IMPLEMENTED / GATED`; preserve complete structured endpoint labels and actual coordinates; simulated location is not live tracking. |
| PAX-09 | `/passenger/map` | Map/alerts surface, supported route context, checkpoint browsing entry | `IMPLEMENTED / GATED`; map data and checkpoint data have separate availability requirements. |
| PAX-10 | `/passenger/notifications` | Existing navigation/empty-state screen | `MISSING` notification backend; do not describe this as delivered notifications. |
| PAX-11 | `/passenger/routes/request/new` | Canonical route/stop request entry | `GATED`; immutable route-version and stop references. |
| PAX-12 | `/passenger/canonical-assignments` and `/:id` | Canonical assignment list and safe owner details | `GATED`; separate single/shared assignment capabilities. |
| PAX-13 | Checkpoint directory, opened from an action | Search and city-grouped names; limited or research source selected by capability | `GATED / BLOCKED`; neutral unavailable traffic, no unverified pins, source/session separation. |

Passenger tabs are Home, My Trips, Map/Alerts, Notifications, and Account. Full-screen creation and live-trip routes intentionally sit outside tab shells. Existing tab stacks and deep links must survive navigation and auth refresh.

### 5.3 Driver

| ID | Screen / path | Existing content and action | Status / remaining boundary |
| --- | --- | --- | --- |
| DRV-01 | `/driver` | Dashboard, online/route state, supported operational metrics | `IMPLEMENTED`; account/profile/verification eligibility remains authoritative. |
| DRV-02 | `/driver/route` | Existing legacy route/supply management | `IMPLEMENTED`; retain explicit idempotent online state and remaining capacity. |
| DRV-03 | `/driver/matches` | Own match inbox, foreground refresh | `IMPLEMENTED`; no manual refresh required for normal visible-screen synchronization. |
| DRV-04 | `/driver/match/:id` | Offer details and valid acceptance/rejection | `IMPLEMENTED`; recheck eligibility, ownership, time, and capacity after locks. |
| DRV-05 | `/driver/my-trip` | Resolve the current active trip for the Trip tab | `IMPLEMENTED`; do not display another or previously selected trip. |
| DRV-06 | `/driver/trip/:id` | Trip details, route, supported lifecycle controls | `IMPLEMENTED / GATED`; actual selected endpoints; existing state-machine rules only. |
| DRV-07 | `/driver/performance` | Stored trust score, completed trip counts, route state | `PARTIAL`; earnings and acceptance rate explicitly unavailable. No fare or acceptance percentage should be fabricated. |
| DRV-08 | `/driver/availability/new` | Create canonical one-off availability | `GATED`; published route/version, valid stops/time and two-dimensional capacity. |
| DRV-09 | `/driver/availabilities` | Own canonical availability list | `GATED`. |
| DRV-10 | `/driver/availability/:id` | Canonical availability details and supported actions | `GATED`; capacity edits cannot overwrite held or confirmed usage. |
| DRV-11 | `/driver/canonical-offers` and `/:id` | Single canonical offer list/detail, acceptance/rejection | `GATED`; existing reservation and immutable-trip rules. |
| DRV-12 | `/driver/shared-offers` and `/:id` | Shared manifest offers and execution views | `GATED`; global seats/parcels capacity, member privacy, stop-event rules. |
| DRV-13 | Shared checkpoint directory action on supporting screens | Names/cities and explicitly unavailable traffic | `GATED / BLOCKED`; directory is not route guidance or a safety guarantee. |

Driver tabs are Home, Matches/Inbox, My Trip, Performance, and Account. Driver operational permissions depend on approved verification and an active account; the UI alone cannot bypass this.

### 5.4 Merchant

| ID | Screen / path | Existing content and action | Status / remaining boundary |
| --- | --- | --- | --- |
| MER-01 | `/merchant` | Dashboard and order/trip summaries | `IMPLEMENTED`; summaries must use authoritative own records. |
| MER-02 | `/merchant/order/new` | Create order and parcel contents | `IMPLEMENTED`; transactional persistence and durable actor-bound operation recovery. |
| MER-03 | `/merchant/order/:id` | Order details, parcels, cancellation, explicit batching/matching actions | `IMPLEMENTED`; preserve existing manual workflow. |
| MER-04 | `/merchant/shipments` | Own order/shipment list and entry to related records | `IMPLEMENTED`; not a synonym for match inbox only. |
| MER-05 | `/merchant/matches` | Merchant match inbox | `IMPLEMENTED`; separate from shipment history. |
| MER-06 | `/merchant/match/:id` | Own match details and assignment state | `IMPLEMENTED`; reflect Driver response and authoritative order state. |
| MER-07 | `/merchant/trip/:id` | Assigned delivery-trip details | `IMPLEMENTED`; authorization and lifecycle rules preserved. |
| MER-08 | `/merchant/reports` | Real order/in-delivery counts plus unavailable-report explanation | `PARTIAL`; no PDF/Excel export, report service, or cost reporting. |
| MER-09 | `/merchant/notifications` | Shared unavailable notification surface | `MISSING` backing service. |
| MER-10 | `/merchant/routes/order/new` | Canonical route/stop-based order entry | `GATED`; preserve parcel counts and stop references. |
| MER-11 | `/merchant/canonical-assignments` and `/:id` | Canonical assignment status and safe details | `GATED`; no cross-merchant/member disclosure. |

Merchant tabs are Home, Shipments/Orders, Reports, Notifications, and Account. Creating an order must not automatically initiate matching. Explicit batching and matching remain separate user actions.

## 6. Complete Admin website inventory

Admin uses hash routes. There are ten operational destinations plus Profile. Their visibility is stable across environments; a visible menu item does not imply a connected feature.

| ID | Route / module | Existing content and controls | Status / edits still needed |
| --- | --- | --- | --- |
| ADM-01 | Admin login | Credential and configured Google Admin sign-in; auth/session handling | `IMPLEMENTED`; retain role/session checks and genuine auth errors. |
| ADM-02 | `#/overview` | Dashboard summaries, real operational cards and resource/error states | `PARTIAL`; active-driver, pending-approval and incident KPI cards explicitly lack connected metrics. Wire only after approved API definitions; never infer them from unrelated lists. |
| ADM-03 | `#/users` | Search/filter/paginate users; inspect detail; account-status action with expected state | `IMPLEMENTED`; conflicts reload authoritative state. Pending Merchant approval is explicitly unavailable as a dedicated workflow. |
| ADM-04 | `#/drivers` | Driver directory, verification queue/detail, approve/reject with revision and reason, vehicle/capacity input when required | `IMPLEMENTED`; identity/licence/vehicle evidence uploads are not collected. Re-review/resubmission workflow is absent and needs policy. |
| ADM-05 | `#/trips` | Trips management, detail, permitted status actions; existing tracking components | `IMPLEMENTED`; simulated location cannot be sold as real tracking. Preserve valid lifecycle transitions and audit history. |
| ADM-06 | `#/routes` | Route directory, create dialog, route workspace, versions, overview, draft editor, stop management, publish readiness | `GATED`; immutable published content and backend map-preview boundaries. No provider/renderer activation authorized. |
| ADM-07 | `#/deliveries-orders` | Passenger request and Merchant order board with existing data/search | `IMPLEMENTED`; no unsupported financial or package-tracking integration implied. |
| ADM-08 | `#/matching-batching` | Existing legacy monitoring overview, match results/detail, batches/detail and paginated current eligible parcels | `IMPLEMENTED`; canonical monitoring unavailable; failed-attempt history not recorded; completed-batch reporting not supported. Demo tools/comparison remain separately restricted. |
| ADM-09 | `#/incidents-safety` | Honest unavailable state | `MISSING` incident/safety backend and approved workflow. Old AI-review alias does not implement AI review. |
| ADM-10 | `#/reports` | Honest unavailable state | `MISSING` report/export backend. |
| ADM-11 | `#/settings` | Read-only environment/API/build flags/current-session information; consent release management | `IMPLEMENTED / PARTIAL`; build configuration is not an editable runtime secret/feature control panel. |
| ADM-12 | `#/profile` | Safe read-only authenticated Admin profile | `IMPLEMENTED`; no general profile editor implied. |

### Admin route compatibility

- `#/verification` resolves to Drivers.
- `#/requests` resolves to Deliveries/Orders.
- `#/matching`, `#/batching`, and `#/comparison` resolve to Matching/Batching.
- `#/incidents`, `#/safety`, and `#/ai-review` resolve to the unavailable Incidents/Safety module.
- Unknown hashes resolve to Overview.

### Route-management subfeatures

- Stable route identity, direction/group/region, route lifecycle, version list, and current-version pointer.
- Create/edit draft versions, clone version content, manage ordered stops and pickup/drop-off permissions.
- Stop identity and coordinate validation; used stop content and published version history remain immutable.
- Publish-readiness checks; supported publish/pause/retire behavior remains backend-controlled.
- Existing provider-neutral geocode/preview service is separately gated and does not approve production maps, geometry persistence, GPS, or navigation.

### Consent-management subfeatures

- Create and edit a complete draft of six documents: Terms, Privacy Notice, Adult 18+ Attestation, each in Arabic and English.
- Review content, record real external legal approval, freeze approved content, explicitly activate an effective release, retire a release with its onboarding consequence disclosed.
- Revision checks prevent stale edits; activation atomically replaces the effective release.
- Legal owners must supply actual wording and approval. The UI itself does not establish legal consent readiness.

## 7. Core functional requirements and acceptance criteria

### FR-01 — Authentication and routing

- Keep one stable router across error-only and authentication state transitions while reacting to current auth state.
- Preserve typed form data and controllers during the first edit after a genuine 401.
- Show definitive invalid-credential, Google, and network failures appropriately; fence stale attempts.
- Restore sessions safely, enforce role transitions, logout/revocation, and protected deep links.
- Acceptance: wrong password → visible error → first typed retry character remains → successful retry; protected routes remain inaccessible after logout/revocation. Arabic and English both pass.

### FR-02 — Passenger booking and selected Driver identity

- Persist exact selected DriverRoute identity through ordinary/assistant handoff, saved-request recovery, matching, and restart.
- If selected supply becomes unavailable, explicitly report it; never silently substitute another driver.
- Reject past, departed, expired, cancelled, or otherwise ineligible demand/supply in server and client paths.
- Acceptance: concurrent and repeated submissions retain the selected route; an unavailable route cannot produce a match to another driver.

### FR-03 — Durable operation recovery and Merchant order creation

- Commit order, parcels, audit event, and idempotency state atomically.
- Scope the operation to the authenticated actor and normalized payload; concurrent same-key requests create one result.
- Replay the original saved result for the same key/payload; reject changed payload under a reused key.
- Preserve compatibility for older clients lacking an idempotency key within the existing contract.
- Durably save the exact pending payload/key before mutation. Keep it through response loss, restart, logout/account switching, and legitimate reconciliation.
- An uncertain response is not a confirmed failure and must not generate a new key automatically.
- Clear pending state only after safe authoritative reconciliation. Cancellation/expiry must obey the established operation lifecycle.
- Acceptance: commit followed by response loss or audit-path failure cannot produce a duplicate or falsely reported rollback; other actors cannot inspect/replay pending operations.

### FR-04 — Explicit batching and matching

- Preserve Merchant create → batch → explicit match action. Do not auto-match on order submission.
- Batching failures cannot leave partial membership, invalid parcel counts, or silently lost order references.
- Only approved, active, eligible, available drivers and compatible route/time/capacity may match.
- Duplicate/concurrent matching creates no duplicate active offer or capacity decrement.
- Acceptance: real MySQL and separate Merchant/Driver sessions prove one saved batch/match, correct inbox visibility, acceptance/rejection, and Merchant status synchronization.

### FR-05 — Capacity and time correctness

- Lock relevant supply/reservation rows and read authoritative current time after acquiring the lock.
- A request waiting past departure/expiry must fail without an active offer, capacity hold, or associated partial change.
- Seat and parcel accounting is transactional; acceptance confirms the existing hold without decrementing again.
- Cancellation, rejection, failure, and expiry restore only the capacity permitted by existing rules, exactly once.
- Canonical shared manifests retain conservative global capacity; no unapproved segment reuse.
- Acceptance: competing requests cannot overbook; deliberate row-lock wait past the deadline rolls back; repeated cancellation/release does not over-restore.

### FR-06 — Cross-screen and cross-role synchronization

- Use existing authenticated read APIs and existing lifecycle-aware foreground refresh.
- Current `ForegroundRefresh` polls at five seconds while visible/foreground, avoids overlapping refreshes, and stops for inactive routes/background/disposal.
- Preserve last authoritative state on background read failure. Do not display mutation success because a refresh failed.
- Fence results by actor/session and operation revision; older responses cannot overwrite newer state.
- Cancellation refreshes request and related-trip data without duplicate mutation or a new timer.
- Acceptance: Driver acceptance/rejection and Passenger cancellation propagate while relevant screens are open; restart restores persisted status; logout/account switching rejects late results.

### FR-07 — Labels, maps, and location truth

- Prefer authoritative structured origin/destination labels; keep legacy route-label compatibility.
- Never split internal hyphens such as `Bab Al-Zawiya`; use only supported unambiguous route delimiters for legacy strings.
- Preserve Arabic names, punctuation, user-entered labels, and coordinates together.
- Switching trips updates actual endpoints and route geometry; stale route responses cannot repopulate the new trip.
- Missing/invalid coordinates have a graceful state; never substitute city centers or arbitrary pins.
- Acceptance: arrow, ASCII arrow, established spaced-hyphen delimiter, Arabic punctuation, ambiguous delimiter, missing-label, and structured-field cases retain complete names and unchanged coordinates.

### FR-08 — Trip lifecycle, privacy, and canonical separation

- Backend state machines determine allowed transitions; role screens do not invent status mappings.
- Request/order/parcel/match/trip statuses remain consistent with their own domain; similarly named states are not interchangeable.
- Canonical assignments and shared trip summaries expose only authorized member data.
- Immutable route snapshots and historical versions are not rewritten by catalog edits.
- Acceptance: terminal/cancelled records cannot match; unauthorized users cannot enumerate or mutate another actor's records; canonical records do not leak into legacy tracking/comparison.

## 8. Checkpoint products: three distinct boundaries

| Product | Existing source and purpose | Allowed representation | Current limitation |
| --- | --- | --- | --- |
| Coordinate-bearing feed | Existing `/api/v1/checkpoints` adapter with local coordinate/status contract | Validated coordinates and mapped states only where legitimately supported and approved | Partner endpoint equivalence is not proven. Keep integration disabled; do not retrofit undocumented aliases. |
| Complete research directory | Versioned backend-owned local inventory: exactly 173 public listings across 11 cities | Names/cities/provenance/research identity; null provider IDs/coordinates in current names-only contract | Complete data remains local/ignored. Public redistribution blocked pending permission. Public manifest and synthetic fixtures do not publish the directory. |
| Limited partner directory | Task #19C `/api/v1/limited-checkpoint-directory`; fixed documented server-to-provider endpoint | Documented provider identity/name/city and raw directional change timestamps; null coordinates; traffic unavailable | Documentation and limited permission are user-reported. Live response conformance is not yet independently verified. At most seven records/city in limited mode, not a complete-dataset claim. |

### CP-01 — Transport and credential protections to preserve

- Backend-only key boundary; no mobile or Admin bundle key.
- Fixed limited-partner target; no arbitrary-host proxy, redirects, provider key in a URL, or client override.
- Complete deadline covers coordination waits, headers, body consumption, and parsing; current limited timeout defaults to 6 seconds and validates its allowed configuration range.
- Decoded response bound is 1,000,000 bytes: a server resource limit, not a provider pagination/size guarantee. Overflow rejects the response rather than truncating it.
- Malformed nonempty feeds cannot become a fresh empty success; a legitimate documented empty collection remains valid.
- Supported logger redaction includes relevant key/header field variants and nested contexts; errors and artifacts must not include raw provider responses or secrets.

### CP-02 — Limited-directory behavior to preserve

- Current complete-profile Passenger/Driver sessions only; Merchant/Admin denied on reads, including cached data.
- Capability extensions are explicitly opted into, preserving older strict clients.
- Single-flight and 15-second instance-local success cache. Five-second negative/denial caching does not override durable authorization.
- Shared MySQL budget and owner-fenced settlement across instances/restarts. Unresolved attempts retain a fail-closed hold; never delete it to evade quota.
- Provider 429 cooldown is honored; no deliberate rate-limit exhaustion during live verification.
- Preserve timestamps verbatim; offset-free timestamps are timezone-unspecified. Retrieval time does not prove observation freshness.
- Traffic status is always unavailable, coordinates remain null/unverified, map readiness false. A timestamp never means open, closed, or congested.
- Keep research and provider identities/sources distinct. Do not merge by name alone.

### CP-03 — Session isolation and presentation

- Capability/catalog requests are bound to actor and session revision before dispatch and after completion.
- Logout, account switching, capability withdrawal, and late responses cannot expose an earlier actor's records or captured search state.
- Search and city grouping reuse existing components; unknown/stale/unavailable data cannot render as confirmed open.
- No precise pins, navigation conversion, or production checkpoint safety claims for these names-only directories.

### CP-04 — Research requirements still open

- Task #19B requested investigation of all 173 records, evidence/source object identifiers, precision, date, feature type, confidence, and independent cross-checks where possible.
- This PRD did not inspect the private research workbook or independently validate its completion/counts of defensible coordinates.
- Preserve every research identity and city association, including duplicate names and unresolved records.
- Use `NO_LOCATION_EVIDENCE`, `CANDIDATE_UNVERIFIED`, `MULTI_SOURCE_REVIEWED`, or `FIELD_VERIFIED` accurately; repeated map sites sharing a source are not independent corroboration.
- Leave coordinates null without adequate evidence. Field verification requires trustworthy field evidence.
- Provider IDs stay separate; map/name similarity is not authenticated provider matching.
- Licensing, OSM attribution/ODbL obligations, and provider reuse restrictions require separate approval before distribution or integration.

## 9. Maps, search, tracking, assistant, and unsupported claims

| Area | What exists | What must not be claimed | Remaining decision/work |
| --- | --- | --- | --- |
| Map display and route views | Flutter components, selected-trip data paths, gated map/preview foundations | Complete production navigation, verified external routing, or live GPS from a route polyline | Provider/renderer/attribution and release evidence; preserve corrected route/label behavior. |
| Provider-neutral route preview | Backend abstraction and bounded draft preview/geocoding paths | Approved provider, permanent provider-content storage, or worldwide accuracy | Provider selection, legal storage rights, privacy/hosting/operations approval. |
| Canonical public-place catalog/search | ADR-021 and detailed design | An implemented canonical place database/search product | Independently approve design/data/roles/licensing and any future migration plan before implementation. |
| Trip location endpoint | Existing location event/read model and demo simulation controls | Live tracking, live ETA, moving Driver telemetry, or background GPS | Separate product/privacy/security scope. Existing capabilities explicitly report live tracking unavailable. |
| Passenger assistant | Existing backend-configured assistant providers and request-handoff UI | Voice support, reliable external availability, autonomous booking decisions, or approved new AI modules | Preserve current constraints; provider availability and privacy require their own evidence. |
| Trust display | Stored DriverProfile trust score and existing UI | Validated predictive accuracy or a newly approved trust algorithm | No algorithm/policy changes authorized. |
| Comparison/demo | Existing deterministic demo-only comparison/simulation tooling | Measured real-world savings, accuracy, fares, or production performance | Label as simulation; keep out of production artifacts and claims. |
| Pricing/payments | No supported fare/payment product established by inspected screens | Real earnings, tariffs, charged fares, refunds, or payment processing | Product/security/legal decision and separately authorized work. |
| Nine experimental modules | Earlier requirements explicitly exclude implementation | Completion, active AI features, autonomous dispatch, measured savings/accuracy | Exact module-level specification/assessment not independently re-established here; no invented list or implementation commitment. |

## 10. Data and state requirements

### Existing entity groups

- **Accounts/auth:** User, ExternalIdentity, AuthActionToken, AuthSession, RefreshToken.
- **Onboarding/consent:** Invitation, InvitationRedemption, OnboardingAttempt, OtpChallenge, OnboardingSession, ConsentRelease, ConsentDocument, UserConsent.
- **Driver/routes:** DriverProfile, DriverVerification, DriverRoute, Stop, ServiceRoute, ServiceRouteVersion, RouteVersionStop.
- **Demand/logistics:** PassengerRequest, MerchantOrder, Parcel, ParcelBatch, ParcelBatchOrder, Match, Trip.
- **Canonical coordination:** CapacityReservation, CanonicalDemandDispatch, CanonicalTripManifest, CanonicalTripManifestMember, CanonicalDemandAttempt.
- **Audit/coordination/demo:** AuditEvent, IdempotencyRecord, AbuseCounter, LocationEvent, ComparisonRun, DemoScenario.
- Checkpoint research directory content is versioned backend file data, not an excuse for a new database table or client hardcoding.

### State vocabularies present in the schema

| Domain | Existing values; this is not a transition-permission table |
| --- | --- |
| Passenger request | `draft`, `pending`, `matched`, `accepted`, `picked_up`, `in_transit`, `delivered`, `completed`, `cancelled`, `expired` |
| Merchant order | `draft`, `submitted`, `batched`, `matched`, `assigned`, `in_transit`, `delivered`, `completed`, `cancelled`, `failed`, `expired` |
| Parcel | `pending`, `batched`, `assigned`, `picked_up`, `in_transit`, `delivered`, `cancelled`, `failed`, `expired` |
| Parcel batch | `created`, `proposed`, `assigned`, `picked_up`, `in_transit`, `delivered`, `cancelled`, `failed`, `expired` |
| Match | `proposed`, `sent_to_driver`, `accepted`, `rejected`, `expired`, `invalidated` |
| Trip | `created`, `accepted`, `pickup_started`, `picked_up`, `in_transit`, `delivered`, `completed`, `cancelled`, `failed` |
| Canonical dispatch | `pending`, `offered`, `assigned`, `cancelled`, `unavailable` |
| Reservation | `held`, `confirmed`, `released`, `expired` |

Do not create a new transition merely because its target exists in an enum. Existing service rules, actor permissions, database constraints, and transactional side effects control changes.

## 11. Remaining edits and owner-action register

Priorities below are planning recommendations, not authorization to implement new features. Owners are responsible roles, not claims that named people have accepted assignments. `P0` blocks the relevant release or provider test; `P1` is the next product-completion decision; `P2` is later scoped improvement/assurance. A directory-only development check does not require enabling unrelated features.

### 11.1 Required security, provider, and release work

| ID / priority | Remaining action | Basis / status | Responsible role | Acceptance evidence |
| --- | --- | --- | --- | --- |
| EDIT-01 / P0 | Verify Windows Credential Manager plus a local isolated PowerShell launcher before real-key use | Proposed injection/launcher readiness is `NOT YET VERIFIED`; no completed synthetic run established here | Developer/operator + security reviewer | Synthetic-only complete dry run; zero external provider requests; private injection; scoped checks of output/logs/argv/Git/artifacts; owned-process/database cleanup and all unrelated gates disabled. |
| EDIT-02 / P0 | Supply operator-only private entry instructions after the synthetic path passes | Replacement key must never be requested, printed, inspected, copied, or put in arguments/reports | Developer/operator | User privately configures key via the approved mechanism and confirms completion without revealing a value; document same-user/admin/memory-access limitations honestly. |
| EDIT-03 / P0 | Obtain fresh explicit authorization for exactly one read-only provider-backed development request | Latest authorization is `NOT YET GRANTED`; user-reported limited permission is not production approval | Repository owner/operator | Explicit request-specific consent after EDIT-01/02. No provider call before it. |
| EDIT-04 / P0 | Execute limited live conformance only after prerequisites | Current real response compatibility `UNVERIFIED_BLOCKED` | Operator + independent reviewer | Existing authenticated backend path; aggregate counts, envelope/type/timestamp validation, null coordinates/unavailable traffic, repeat reads within cache interval, sanitized UTC/source/cache report, disable/cleanup afterward. No raw records, IDs, tokens, key values/hashes, or headers in evidence. |
| EDIT-05 / P0 | Confirm historical credential revocation/rotation independently | `PENDING_OWNER_CONFIRMATION`; public repository exposure risk persists categorically | Provider credential owner + independent security reviewer | Provider-side audit reference, effective UTC time, named owner/approver, independent confirmation. Never retrieve or test the historical credential. Separate release gate, not an invented additional prerequisite for the revised authorized development test. |
| EDIT-06 / P0 | Approve permitted endpoint/auth/access/usage and relationship to prior PostgREST source | Contract/limited usage supplied by developer; equivalence and production rights not independently proven | Provider + security/legal owners | Redacted approved documentation, permissions/RLS scope/permitted users, documented schema/types/nullability/status/timestamp semantics, explicit source relationship. No weakened RLS or anonymous grants. |
| EDIT-07 / P0 | Approve observation age, stale-cache maximum, missing/future timestamp handling | `CHECKPOINT_STALE_POLICY = PENDING_OWNER_APPROVAL` | Product safety owner + provider | Written versioned policy with accountable approver/effective time and tests derived from it; no silently chosen traffic freshness rule. |
| EDIT-08 / P0 | Approve stale/unknown/unavailable/previously-open presentation and cache-on-failure policy | Safety and failure behavior remain external decisions | Product safety + security/provider | Distinct policy for timeout, auth denial, malformed response and outage; display cannot suggest safe/open from timestamps or prior state. |
| EDIT-09 / P0 | Obtain explicit public research-directory reuse/redistribution permission | Complete 173-record data remains local; publication blocked | Provider rights owner + legal | Redacted permission scope/attribution/redistribution terms, independent review; no dataset publication before approval. |
| EDIT-10 / P0 | Verify a concrete final release candidate and branch/PR dependencies | No new exact-head CI/PR-state verification in this PRD | Release engineer + independent QA | Current heads/bases/draft/unmerged state, full exact-head regression and four hosted workflow results; no automatic merge. |
| EDIT-11 / P1 | Reconcile stale operational documentation against authoritative current config | `environment-matrix.md` says matching is rejected everywhere; current config permits local/test/demo subject to dependencies and rejects staging/production | Backend maintainer + documentation reviewer | Focused documentation correction backed by config tests; do not loosen current gates. Older milestone-specific claims clearly dated. |
| EDIT-12 / P1 | Assemble a single current evidence index for recovered features | Test/source existence and historical reports are not a current release attestation | QA owner | Immutable source/tree references, dated RED/GREEN/browser/MySQL/CI evidence, failures retained, reviewer coverage stated. No unsupported PASS. |

### 11.2 Confirmed missing/partial product areas — separate approval required

| ID / priority | Remaining edit or decision | Current evidence | Scope boundary / acceptance |
| --- | --- | --- | --- |
| EDIT-13 / P1 | Decide notification scope, persistence, read state, channels, and delivery guarantees before building | Shared `NotificationsScreen` explicitly says there is no backing endpoint/table | Approved contract first; actor isolation, deduplication, restart/retry behavior, user preferences and retention; do not substitute WebSockets or push service without need/approval. Existing foreground sync is not a notification service. |
| EDIT-14 / P1 | Define incident/safety reporting and Admin handling | Admin module is `ModuleUnavailable`; no connected incident KPI | Product/safety/privacy decision on access, escalation, evidence, retention, abuse and response responsibility; separate schema approval if needed. Do not imply emergency-response coverage. |
| EDIT-15 / P1 | Define supported Merchant/Admin reports and exports | Merchant counts exist; report/export service does not | Agree actual fields/date ranges/authorization, PDF/Excel needs and retention. Export only real authorized data; no simulated costs or savings. |
| EDIT-16 / P1 | Decide active-driver and pending-approval metric definitions, then wire real summaries if approved | Overview cards explicitly marked unconnected | Define eligibility/time window/meaning; use bounded authorized queries and loading/error states; never fake a zero or derive approval count from an unrelated response. |
| EDIT-17 / P1 | Decide Driver evidence collection and re-review/resubmission workflow | Verification approval works, but evidence status is `not_collected` and decisions are terminal under current contract | Legal/security requirements for documents, retention, access, review identity and immutable decision history. No cosmetic “verified documents” label before real evidence. |
| EDIT-18 / P1 | Define dedicated Merchant approval/onboarding behavior if required | Admin user role context labels Merchant approval unavailable | Product/security decision distinct from generic account-status mutation; no silent policy invention. |
| EDIT-19 / P2 | Decide whether real earnings, fares, payments, and acceptance-rate history belong in scope | Driver screen explicitly reports earnings/acceptance rate unavailable | Separate pricing/financial/security policy. Do not add financial fields, formulas, history or percentages in a synchronization fix. |
| EDIT-20 / P2 | Decide whether canonical monitoring, failed-attempt history, or completed-batch reporting is needed | Existing monitoring contract marks these unavailable/not recorded/not supported | Establish event semantics, privacy and retention before expanding data/API; preserve legacy monitoring meaning and performance budget. |
| EDIT-21 / P2 | Approve canonical place-catalog implementation and initial data | ADR-021 remains proposed/design-only | Approved authoritative bilingual data, provenance/licensing, reviewer roles, deterministic fixtures and separately approved migration plan. |
| EDIT-22 / P2 | Complete map-provider, renderer, retention, attribution, hosting and operations decisions | Provider evaluations/design do not establish approved production integration | Evidence-based provider choice and legal/privacy/SRE ownership. No automatic GPS, navigation, or external discovery fallback. |
| EDIT-23 / P2 | Decide any future live tracking/ETA scope | Capability explicitly reports `live_tracking_available: false`; demo simulation exists | Separate consent/location minimization, backend ingestion, retention, access, battery/background-policy and provider approval; not a route-display fix. |
| EDIT-24 / P2 | Complete/review all-record location evidence and licensing ledger before any enrichment | Private Task #19B output not verified by this assessment | All 173 identities retained; exact investigated/candidate/unresolved counts and per-city report; independent evidence and legal review; nulls preserved. |

### 11.3 Preserve completed corrections — regression work, not repeat implementation

| ID | Earlier area | Required verification on any affected final candidate |
| --- | --- | --- |
| REG-01 | Login/router correction | Stable GoRouter, real 401 retry, first-character preservation, network/Google/stale attempt, session/role/logout/revocation, RTL/LTR and route protection. |
| REG-02 | Recovery Tasks #1–#6 | Maps/parser/status validity, actual selected trip route, label/coordinate pairing, persistence/duplicates, elapsed-time rejection, uncertain outcome recovery, truthful login errors. |
| REG-03 | Four P2 corrections | Selected-driver identity; no permanent assistant uncertainty after definitive failure; MySQL post-lock expiry; safe QA cancellation cleanup. |
| REG-04 | Merchant Task #9 | Atomic order/parcels/audit/idempotency, same-key replay/conflict, actor isolation, durable restart recovery, rollback and legacy client compatibility. |
| REG-05 | Tasks #10/#11 | Merchant/Driver and Passenger/Driver propagation through existing API; visible-only polling; out-of-order and account-change fencing. |
| REG-06 | Task #12 | Accepted request cancellation immediately reconciles related-trip label; lost response has no false failure/success or duplicate capacity restoration. |
| REG-07 | Task #13 | Seat/parcel overbooking and concurrent hold/release/expiry protections; no extra reservation/decrement. |
| REG-08 | Task #14A | Cargo batch integrity, partial-failure rollback, valid parcel/order membership and explicit matching. |
| REG-09 | Functional integration / Task #17A | Integrated history preserved; full English/Arabic structured endpoint names and unambiguous legacy delimiters; unchanged coordinates/matching. |
| REG-10 | Task #18A | No redirect credential forwarding, complete timeout/body bound/cancellation cleanup, invalid-feed rejection, redaction, safe least-privilege documentation. |
| REG-11 | Task #18B | Actor/session isolation and neutral display fallback; no old actor values/errors/search state after teardown. |
| REG-12 | Task #19A/#19C | Private dataset separation, synthetic public tests, default-disabled source selection, documented limited contract, cache/quota/cooldown/lease integrity. |
| REG-13 | CI baseline | Patched dependencies, formatter/analyzer/layout tests, migration inventory, monitoring setup and existing performance assertions remain intact. |

Reported historical issues are investigation starting points if new failures appear. This PRD does not assert every old finding is still present.

## 12. Security, privacy, accessibility, and reliability requirements

- **Credentials:** server-only external credentials; no key/token in client bundles, arguments, Git, captured logs, screenshots or evidence. Do not inspect, search values of, hash for reporting, or reuse the historical credential.
- **Operator secrecy:** private local injection must be tested; Windows Credential Manager is not isolation from malicious same-user/admin processes or memory inspection. Any claim of no leakage must name the tested path and limitations.
- **Authorization:** server enforces current session, role, account status, profile completeness and resource ownership on both cached and uncached reads and mutations.
- **Concurrency:** database row locks/constraints/transactions establish correctness; UI button disabling alone is insufficient. Read authoritative current time after relevant lock waits.
- **Recovery:** distinguish definite validation/auth failures from unknown commit outcomes. Persist exact actor/operation/key/payload; never turn an uncertain booking into a new submission silently.
- **HTTP:** preserve validated request/response bounds, safe headers/CORS/proxy configuration, sanitized errors, rate controls and request IDs. No arbitrary URL forwarding or redirect credential forwarding.
- **Privacy:** minimize shared-trip and Admin data; keep secrets, parcel descriptions, raw snapshots, personal data and raw operation identities out of operational logs as required by current contracts.
- **Accessibility/localization:** Arabic default/RTL and English/LTR, readable logical ordering for mixed text, existing focus/labels/tap targets, bounded layout under long names/text scaling, truthful loading/empty/offline/error states.
- **Performance:** measure endpoint/SQL/lock/connection/event-loop/resource causes; preserve the existing 10,000 ms monitoring scenario budget rather than relaxing it. Historical 11,701/11,514 ms failures are not freshly reproduced measurements here.
- **Cleanup:** only resources created by the QA invocation may be stopped/deleted; cancellation during MySQL/API/frontend startup and readiness polling must leave no owned survivors. Never kill unrelated services.
- **Integrity:** preserve migration checksums, dependency security floors, authorization tests, timeout budgets and all security policies. No “green CI” via waived failures.

## 13. Validation plan and release acceptance

This section defines the required future validation; it is not a claim those commands ran for this document. Use the repository's pinned runtime/toolchain and safe disposable-database procedures. Do not run environment-reading integration commands against a real database.

### 13.1 Required automated checks

| Group | Required evidence |
| --- | --- |
| API | Full API tests and typecheck; normal/invalid/unauthorized states; source-specific checkpoint tests; idempotency/transaction/recovery invariants. |
| Admin | Full component/unit tests and typecheck; authorization/session errors, stale revisions, route/consent lifecycle, truthful missing metrics/features. |
| Flutter | Full test suite, targeted provider/widget/app-router tests, formatter, analyzer, localization consistency and Android build. |
| Tooling | All existing tooling tests, workflow validation, process ownership/cancellation, migration inventory and integrity. |
| MySQL | Real disposable integration matrix: sessions/auth/onboarding, consent, routes, legacy/canonical/shared capacity/matching, Merchant recovery, Passenger association/sync, cargo integrity, monitoring, checkpoint directory/budget paths where applicable. |
| Builds | API, Admin, Android; relevant web QA build. Use production-like artifact isolation checks without enabling providers. |
| Security | Current source/artifact/secret scans, full and production dependency audits, independent source/security review of the immutable final candidate. |

Representative repository entry points: `npm run test`, `npm run test:admin`, `npm run test:tooling`, `npm run typecheck`, `npm run ci:workflows`, `npm run prisma:validate`, `npm run build:api`, `npm run build:admin`, `npm run security:scan`, `npm run security:artifacts`, `npm run security:audit`, and the guarded `test:integration:*` scripts. Use `dart format` checks, `flutter analyze`, `flutter test`, and the approved Android build invocation from `apps/mobile`. Consult current scripts for exact isolated integration arguments; this is not permission to use an existing production connection.

### 13.2 Human/browser/device QA

1. Separate synthetic Passenger, Driver, Merchant and Admin sessions; never reuse real user credentials/data.
2. Verify login retry, restoration, role routing, cross-account denial and session revocation.
3. Passenger selects exact Driver route → request → match → Driver response → trip; verify cancellation and elapsed departure.
4. Merchant creates order → explicit batch → explicit match → correct Driver inbox → accept/reject → Merchant status updates.
5. Lose the response after confirmed server commit; restart the client; recover the same operation with no duplicate order/parcel/booking.
6. Switch actors during delayed successful/error responses; check no prior actor state appears.
7. Switch trips during route reads; verify full English/Arabic labels, correct endpoints/markers and unchanged coordinates.
8. Verify polling stops while background/inactive; network errors preserve authoritative records without false success.
9. Verify disabled checkpoint/research/limited capabilities do not expose active features; unknown traffic is never open, unverified records have no precise pins.
10. Inspect visible placeholders and unavailable metrics for truthful wording and existing design preservation.
11. Capture sanitized screenshots only; no tokens, raw provider responses/records, private research names, or credential-entry UI.
12. Cancel QA at each startup/readiness phase and verify owned cleanup.

### 13.3 Hosted exact-head workflows

| Workflow | Definition | Requirement / current report |
| --- | --- | --- |
| Admin CI | `.github/workflows/ci-admin.yml` | PASS required on exact final candidate; not queried/executed for this PRD. |
| Backend and MySQL CI | `.github/workflows/ci-backend.yml` | PASS required, including real MySQL; not queried/executed for this PRD. |
| Flutter Android CI | `.github/workflows/ci-mobile.yml` | PASS required; not queried/executed for this PRD. |
| Security and Configuration CI | `.github/workflows/ci-security.yml` | PASS required; not queried/executed for this PRD. |

No historical green check substitutes for a changed head. Test counts, run URLs, commit/tree, UTC execution time, reviewer and known exclusions must be recorded with the actual future result.

## 14. Decisions requiring accountable approval

| Decision | Accountable owner | Required decision record |
| --- | --- | --- |
| One live limited development request | Developer/repository owner | Explicit authorization only after synthetic verification and private configuration. |
| Historical credential revocation | Provider credential owner + independent security reviewer | Provider-side audit evidence, effective UTC time, independent confirmation; no credential values/testing. |
| Provider contract/access/production usage | Provider + security/legal owners | Authorized endpoint/auth scheme, users/permissions/RLS scope, schema and permitted usage. |
| Observation freshness and failure/cache policy | Product safety + provider/security | Individual age, stale-cache maximum, missing/future timestamps, outage/auth/malformed handling, display meaning. |
| Directory redistribution and coordinate-source rights | Provider + legal/data owners | Scope of permission, attribution and derivative/distribution obligations. |
| Notification/incident/report behavior | Product owner + relevant privacy/security owner | Actual user workflow, access, retention and failure semantics before implementation. |
| Driver evidence/re-review and Merchant approval | Product/security/legal owners | Evidence requirements, decision lifecycle, authorized approvers and privacy obligations. |
| Canonical catalog/maps/tracking | Product, data/legal, security and operations | Approved dataset and design, provider/storage/renderer/hosting decisions; separate schema scope where needed. |
| Merge/release/production activation | Repository/release owner | Explicit approval of the exact verified candidate and applicable external gates; none provided here. |

Every external approval should identify the decision, named accountable owner and approver, effective UTC timestamp, redacted evidence reference, and anything still pending. User-reported permission remains labeled as such until independently verified.

## 15. Recommended delivery order

1. Complete the synthetic-only operator/injection readiness task; do not enter/read a real replacement key through the agent.
2. After the user privately configures it, request the separate one-read development authorization. Run and sanitize conformance only if granted; disable/cleanup afterward.
3. Obtain provider/security/legal/freshness/publication decisions independently. A successful directory read does not unblock traffic/map safety or production release.
4. Reconcile documentation drift and assemble immutable evidence for the integrated release candidate; preserve completed recovery behavior.
5. Product owner prioritizes missing notifications, incidents, reports and metrics. Scope each independently; obtain schema/policy approval before changes that require it.
6. Complete separately approved catalog/maps/tracking work only after its prerequisites; do not attach it to a narrow recovery change.
7. Require independent exact-head source review, disposable MySQL/browser/device evidence and all four hosted checks before a human merge gate.

No dates, staffing commitments, completion percentages, new financial targets or claimed accuracy/savings are invented here.

## 16. Release-gate snapshot

These are the carried-forward restrictions and evidence status, not new runtime observations:

```text
CHECKPOINT_PROVIDER = UNVERIFIED_BLOCKED
AWEENRAYEH_LIVE_CONFORMANCE = PENDING_SECURE_VERIFICATION
LIVE_DEVELOPMENT_REQUEST_AUTHORIZATION = NOT_GRANTED
WINDOWS_CREDENTIAL_MANAGER_LAUNCHER_READINESS = UNVERIFIED
SYNTHETIC_OPERATOR_DRY_RUN = NOT_VERIFIED_BY_THIS_ASSESSMENT
CREDENTIAL_ROTATION = PENDING_OWNER_CONFIRMATION
CHECKPOINT_STALE_POLICY = PENDING_OWNER_APPROVAL
CHECKPOINT_DIRECTORY_PUBLICATION = BLOCKED_PENDING_PROVIDER_PERMISSION
PROVIDER_PERMISSION_EVIDENCE = USER_REPORTED_NOT_PRODUCTION_APPROVAL
TRAFFIC_STATUS = UNAVAILABLE_FOR_NAMES_ONLY_DIRECTORIES
PRECISE_CHECKPOINT_MAP_COORDINATES = NOT_APPROVED_BY_THIS_ASSESSMENT
HUMAN_QA_READY = NOT_REASSESSED
EXACT_HEAD_HOSTED_CI = NOT_REASSESSED
DESIGN_CHANGES = NONE
MERGE_GATE = BLOCKED_PENDING_USER_APPROVAL
PRODUCTION_DEPLOYMENT = NOT_AUTHORIZED
```

## 17. Evidence and source index

Paths are relative to the inspected repository root. They identify the evidence used for this inventory, not a production audit attestation.

| Ref | Source | Coverage |
| --- | --- | --- |
| E01 | `README.md`; `package.json`; `PROJECT_MAP.md` | Product architecture, runtime/scripts, historical milestone evidence. Historical counts/benchmarks were not rerun. |
| E02 | `apps/mobile/lib/core/routing/app_router.dart` | Current routed screens, stable router, role shells and compatibility links. |
| E03 | `apps/admin/src/navigation.ts`; `apps/admin/src/App.tsx` | Ten Admin modules, Profile, hash aliases, feature availability and component wiring. |
| E04 | `apps/mobile/lib/features/notifications/presentation/notifications_screen.dart`; `apps/mobile/lib/core/widgets/unavailable_tab.dart` | Missing notification backing and truthful unavailable presentation. |
| E05 | `apps/mobile/lib/features/merchant/presentation/merchant_reports_screen.dart`; `apps/mobile/lib/features/driver/presentation/driver_performance_screen.dart` | Reports/earnings/acceptance-rate limits and real supported counters. |
| E06 | `apps/admin/src/features/overview/OverviewDashboard.tsx`; `apps/admin/src/features/monitoring/contracts.ts` | Unconnected KPI cards and explicit monitoring scope limitations. |
| E07 | `apps/admin/src/features/users/UsersDirectory.tsx`; `apps/admin/src/features/verification/DriverDirectory.tsx`; `docs/admin/driver-verification.md` | Account changes, approval controls, evidence/resubmission limits. |
| E08 | `apps/admin/src/features/settings/SettingsPanel.tsx`; `apps/admin/src/features/profile/ProfilePanel.tsx`; `docs/admin/consent-management.md` | Read-only configuration/profile and real consent lifecycle. |
| E09 | `apps/api/src/app.ts`; `apps/api/src/modules/`; `apps/api/src/config.ts` | Registered API families, feature prerequisites, auth boundary and current environment guards. |
| E10 | `apps/api/prisma/schema.prisma` | Existing models and domain-specific state vocabularies. |
| E11 | `apps/mobile/lib/core/widgets/foreground_refresh.dart`; `apps/mobile/lib/core/api/authoritative_refresh.dart` | Visible foreground polling and synchronization architecture. |
| E12 | `apps/mobile/lib/features/trips/data/trip_models.dart`; `apps/mobile/test/trip_location_labels_test.dart` | Structured location labels and legacy delimiter compatibility. Test existence only; not freshly executed. |
| E13 | `apps/mobile/test/auth_router_lifecycle_test.dart`; `merchant_order_recovery_test.dart`; `passenger_request_status_sync_test.dart`; `trip_synchronization_test.dart`; `driver_capacity_refresh_test.dart` | Existing regression coverage areas; no new PASS asserted. Unqualified test names in this row are under `apps/mobile/test/`. |
| E14 | `docs/checkpoints/task19c-ledger.md`; `docs/checkpoints/limited-partner-directory.md`; `docs/api/checkpoint-directory.md`; `docs/api/checkpoints.md` | Separate checkpoint contracts, restrictions, prior RED/GREEN narrative and operator procedure. |
| E15 | `apps/api/src/services/limitedCheckpointDirectory.ts`; `limitedCheckpointBudget.ts`; `apps/api/src/modules/capabilities.ts` | Limited adapter/cache/budget and capability design. Unqualified service file is under `apps/api/src/services/`. |
| E16 | `apps/mobile/lib/features/checkpoint_directory/`; `apps/mobile/lib/features/checkpoints/`; corresponding checkpoint tests | Source/session separation, neutral data and marker constraints; implementation/coverage inventory, not live conformance. |
| E17 | `docs/architecture/route-domain.md`; `capacity-reservations.md`; `canonical-global-capacity.md` | Version/history/capacity architecture. Unqualified documents are under `docs/architecture/`; milestone-specific text must be read with current config. |
| E18 | `docs/decisions/ADR-021-canonical-place-catalog-search-architecture.md`; `docs/maps/canonical-place-catalog-search-architecture.md` | Proposed canonical place design and approval gates. |
| E19 | `docs/architecture/environment-matrix.md`; `docs/mobile/session-management.md`; `docs/security/` | Environment/session/privacy/security policies and identified matrix drift. |
| E20 | `.github/workflows/ci-admin.yml`; `ci-backend.yml`; `ci-mobile.yml`; `ci-security.yml` | Four current workflow definitions; remote statuses not checked. Unqualified names are under `.github/workflows/`. |
| E21 | Task history and latest owner instruction | No live authorization, proposed Credential Manager injection, separate historical revocation gate, no merge/deployment, local-only research data and no CodeRabbit. |

## 18. Document completion criteria

- [x] Inventory current Passenger, Driver, Merchant, shared and Admin destinations from routing/source.
- [x] Separate implemented/gated/partial/missing features and design-only proposals.
- [x] Record preserved functional invariants without reopening completed implementation.
- [x] List remaining actions with priority, owner role, dependency and acceptance evidence.
- [x] Keep provider compatibility, key rotation, freshness, redistribution and merge/deployment gates explicit.
- [x] Distinguish source inspection and historical evidence from newly executed runtime verification.
- [x] Exclude credentials, historical key values, raw provider records, private directory names and real-user data.
- [ ] Product owner approves priorities and separately scopes any new functionality.
- [ ] Future operator verification, external decisions and exact-head release acceptance are completed with real evidence.

The PRD is a reviewable product inventory and plan. Its completion does not mark the application or any external integration production-ready.

## 19. API surface inventory

These are the existing service families supporting the screens. Paths are under `/api/v1`; examples identify representative operations rather than replacing the full validation schemas in `apps/api/src/modules/`. Authorization, completeness checks, environment gates, and body/header contracts still apply. A path listed here is not permission to call it.

| Family / implementation | Existing surface | Important limitation |
| --- | --- | --- |
| Health / `health.ts` | `/health`, `/health/live`, `/health/ready` | Readiness is not authorization or production acceptance. |
| Authentication / `auth.ts` | Login aliases, mobile registration start/complete, email verification, password reset/set, Google identity/sign-in/linking, phone completion, `/me` | Legacy `/auth/register` returns the required-flow response rather than accepting unrestricted registration. |
| Sessions / `auth.ts` | Refresh, session list/revoke, logout, logout-all | Revocation/security-version/account checks remain server-enforced. |
| Public onboarding / `publicOnboarding.ts` | Config/consents, attempts, resend/verify/complete, status and status sessions | Default-disabled and environment/provider/legal gated. Continuation/status tokens have distinct purposes. |
| Capabilities / `capabilities.ts` | `/capabilities`, optional directory extensions | Availability is configuration permission, not provider health or released functionality. |
| Passenger legacy / `passenger.ts` | Create/list/active/detail requests, cancel request | Own-record access and existing cancellation/time/idempotency behavior. |
| Passenger assistant / `passengerAssistant.ts` | `/passenger/assistant/messages` | Existing server-side provider selection; no voice/new AI authorization. |
| Driver legacy / `driver.ts` | Explicit `PUT /driver/online-state`, route create/list/active/deactivate | Online state requires an operation key; driver eligibility and actor binding remain intact. |
| Merchant / `merchant.ts` | `/merchant/order-operation`, create/list/detail orders, order cancellation | Recovery lookup belongs to the authenticated Merchant; all creation side effects remain transactional. |
| Batching / `batching.ts` | `POST /merchant/orders/:id/batch` | Separate explicit action; preserve batch/order/parcel consistency. |
| Legacy matching / `matching.ts` | Search, run, own match list/detail | Selected route, valid demand/supply, post-lock time and capacity checks. |
| Legacy trips / `trips.ts` | Match accept/reject; trip list/detail/status/location | Ownership/state-machine enforcement; location records do not establish live tracking. |
| Demo / `demoReset.ts`, simulation router, `comparison.ts` | Guarded reset, simulation step/reset, deterministic comparison | Demo-only/isolation checks; no real database or measured production savings. |
| Canonical route catalog / `routeManagement.ts` | Routes, route detail, version stops | Separately gated published catalog; not a free-form provider place search. |
| Canonical Driver supply / `driverAvailability.ts` | Availability list/create/detail/update and supported lifecycle actions | Immutable route references, future departure, used-capacity accounting. |
| Canonical demand / `canonicalDemand.ts` | Passenger available departures/route requests; Merchant route orders | Gated operational entry; distinct legacy contracts. |
| Canonical matching / `canonicalMatching.ts` | Driver canonical offers list/detail/accept/reject; owner request/order status | Reservation confirmation, immutable snapshot, privacy and one-off supply rules. |
| Shared matching / `canonicalSharedMatching.ts` | Shared-offer path aliases, detail, acceptance/rejection | Gated shared presentation/manifest semantics; no unapproved segment capacity reuse. |
| Coordinate checkpoints / `checkpoints.ts` | `/checkpoints` | Disabled external integration; coordinate-bearing local contract is not the limited partner contract. |
| Research directory / `checkpointDirectory.ts` | `/checkpoint-directory` | Disabled plus publication/hash/inventory guards; private 173-row data not distributed. |
| Limited directory / `limitedCheckpointDirectory.ts` | `/limited-checkpoint-directory` | Passenger/Driver only; default disabled; live conformance pending; no coordinates/traffic status. |
| Admin users/drivers / `admin.ts` | User list/detail/status, driver list, verification list/detail/approve/reject | Current Admin session, expected state/revision, real evidence boundaries. |
| Admin summaries / `admin.ts` | Dashboard, requests, orders, legacy routes | Supported summaries do not supply every visible KPI or a reporting/export product. |
| Admin trips / `adminTrips.ts` | List/detail and permitted status mutations | Valid lifecycle and audit rules; not an unrestricted database editor. |
| Admin monitoring / `adminMatchingMonitoring.ts` | Matching/batching overview; paginated matches, batches, detail and current eligible parcels | Explicit legacy scope; no historical failed-attempt/canonical/completed-batch coverage claim. |
| Admin routes / `routeManagement.ts` | Service routes, versions, draft edits, retirement, stops and supported publication actions | Route management gated; historical/published content immutable. |
| Admin previews / `routePreview.ts` | Route-version preview and stop geocode | Gated existing draft/server-owned inputs; no arbitrary URL/credential/coordinate proxy. |
| Admin invitations / `adminInvitations.ts` | Create/list/revoke invitations | Independently gated onboarding access; no anonymous grant. |
| Admin legal content / `adminConsents.ts` | Release list/current/detail/create/update/approve/activate/retire | Approval represents real external legal approval, never fabricated sample text. |

No operational notification feed, incident/safety workflow, general report/export service, fare/payment service, or live-location ingestion product is established by the inspected routes. Such features require approved contracts and separate implementation, rather than a cosmetic edit to an existing screen.

## 20. Implementation status update — 2026-10-25

Added after version 1.0 of this document. Sections 1–19 above are unchanged and describe the state inspected at `5b3cb6b`; this section records what was built since. Nothing here is a production-readiness claim, and nothing has been merged, pushed or deployed.

**Where the work is (landed):** everything below is merged into `production-readiness` as merge commit `753b489` (PR #64, on top of the recovery stack landed through PR #63, merge commit `b30846f`). PRs #50 and #52 closed as merged with #63; #51 and #53–#62 were closed as already contained. No open pull requests remain. Hosted Backend/MySQL, Admin, Flutter and Security workflows all passed on `753b489`. Nothing has been deployed; the checkpoint provider features merged disabled and fail-closed.

**Evidence run on 2026-10-25 (local only; hosted CI has not run):** typecheck, API unit tests (389), Admin tests (122), tooling tests (20), Flutter analyze and tests (270), API/Admin builds, Android debug APK build, production-artifact scan, secret scan, workflow validation, `npm run demo:smoke`, `npm run demo:features`, `npm run demo:approvals`, and the real-MySQL CI suites (orchestrator, reset-matrix, legacy-online, passenger-trip-association, canonical single, canonical shared) on disposable `*_ci` databases against the upgraded dependency set. The production dependency audit reports 0 findings; two moderate findings remain in dev-only test tooling (`@vitest/mocker`). **Admin console:** driven in headless Chrome (Overview, Incidents triage, Reports, Users merchant approval, Drivers re-review with history); two issues found and fixed (unstyled incident rows, Active-drivers KPI ignoring drivers on a job). The Android emulator was used (Driver in Arabic; Passenger in English and Arabic; Merchant in Arabic): bell badges, the inbox, the report-a-problem sheet and its arrival in the Admin queue, and the Merchant Reports tab were seen working. **Not inspected:** the Merchant inbox and English Merchant/Driver screens on a device; CSV files opened in Excel; the Admin console at phone width.

### 20.1 Register items

| Item | Status | What exists now | What is still open |
| --- | --- | --- | --- |
| EDIT-11 | Done | `environment-matrix.md` matches `config.ts` (canonical matching allowed in local/test/demo, rejected in staging/production). | — |
| EDIT-13 Notifications | Done, minimal | In-app inbox (table `notifications`, list/read/read-all API, mobile inbox, bell badge, Notifications tab). Events: match offered/accepted/rejected, trip status, driver verification outcome, incident update. Idempotent per recipient and event. Polling only. | No push/SMS/email channel, no preferences, no retention policy, canonical (multi-route) matches do not notify. Product owner still owns channel/retention decisions. |
| EDIT-14 Incidents | Done, minimal | User-filed reports (category + description, optional own trip), per-user cap of 10 unresolved, Admin queue with forward-only triage and notes, Overview KPI wired, audited. | Not an emergency channel and says so. No attachments, location, escalation, SLAs, reopening, or reporting on another user. Privacy/retention/response-ownership decisions remain with the product and safety owners. |
| EDIT-15 Reports | Done, minimal | Admin summary + date range + CSV export (requests, orders, trips; ≤5,000 rows; formula-safe; no contact data); Merchant summary in the app. Corridor (legacy) data only. | No PDF/Excel, no scheduled reports, no mobile file export, no cost/fare reporting (no such data exists). |
| EDIT-16 Metrics | Done | Overview "Active drivers" = verified drivers with a route in service (`active`, `assigned` or `on_trip`); "Pending approvals" = pending driver verifications; "Incidents" = unresolved reports. All from bounded server counts. | Definitions above are engineering choices; the product owner should confirm them. |
| EDIT-17 Driver re-review | Partly done | Admin can reopen a rejected application (reason required, revision-checked, audited); append-only decision history is stored and shown. | Evidence collection/upload is still absent (`not_collected`). A rejected applicant cannot sign in, so re-review is Admin-initiated, not applicant-initiated. Decisions made before this change exist only in the audit log. |
| EDIT-18 Merchant approval | Done | Dedicated approve/reject endpoints (reject needs a reason and disables the account, ending sessions); Users screen controls; audited. The generic status endpoint still refuses pending → active for non-passengers. | Approval criteria and who may approve are still a product/security decision. |
| ADM-02 / ADM-09 / ADM-10 / MER-08 / MER-09 / PAX-10 | Updated | Overview cards connected; Incidents and Reports modules implemented; Merchant Reports and the Notifications screens show real data. | See the rows above for limits. |
| Dependency advisories | Done on the security branch | Four transitive packages patched; vite 8.3.5, zod 4.6.7, Prisma stack 7.10.1, mariadb 3.5.4; dependency-floor test updated. | Needs the hosted workflows to confirm (the lockfile was generated on Windows with npm 10.9.2). |

### 20.2 Not started or unchanged

All of the following remain exactly as described above: EDIT-01 to EDIT-10 (credential handling, provider authorization and conformance, freshness and failure policy, redistribution permission, exact-head hosted verification), EDIT-12 (a single immutable evidence index), EDIT-19 (earnings/fares/payments), EDIT-20 (canonical monitoring and completed-batch reporting), EDIT-21 (canonical place catalog), EDIT-22 (map provider decisions), EDIT-23 (live tracking/ETA), and EDIT-24 (checkpoint location evidence). The release-gate snapshot in section 16 is unchanged, including `MERGE_GATE` and `PRODUCTION_DEPLOYMENT`.

### 20.3 Schema and operational changes to know about

Three additive migrations were added: `20261025120000_in_app_notifications`, `20261025140000_incident_reports`, `20261025160000_driver_verification_history`. Their checksums are pinned in `scripts/tests/migration-integrity.test.mjs`. They were applied to the local `masari` database and to disposable `masari_demo` / `*_ci` databases; none has been applied anywhere else.

New demo and verification entry points: `npm run demo:features`, `npm run demo:seed-approvals`, `npm run demo:approvals`, and `docs/demo/FEATURE_WALKTHROUGH.md`. The checklist items in section 18 that require product-owner approval and real external evidence remain unchecked.

### 20.4 Landing record and what is still open (2026-10-25)

- The stack's own release blockers are **not** resolved by merging and remain owner actions: confirmation that the historical checkpoint credential was revoked or rotated (EDIT-05), provider contract and permission evidence (EDIT-06/09), and the freshness and failure-presentation policy (EDIT-07/08). The checkpoint code is merged but disabled by default; enabling it needs an HTTPS URL, a real key and explicit flags.
- Human acceptance of the recovered flows and of the new features is still pending (see `docs/demo/FEATURE_WALKTHROUGH.md`).
- A clean install of `production-readiness` at `753b489` passes: typecheck, API 820, Admin 379, tooling 76, Flutter 623 tests, `flutter analyze` and `dart format`, dependency audit policy and secret scan.
- The "merge gate" in section 16 was an owner decision; the owner approved and the merge was performed. Production deployment remains not authorized.

## 21. Implementation status update — 2026-10-26

Added after section 20. Sections 1–20 are unchanged. Nothing here is a production-readiness claim, and nothing has been deployed. Everything below is merged into `production-readiness` through PR #69 (merge commit `29f01de`); hosted admin, backend-mysql, mobile and security workflows passed on the PR head.

| Item | Status | What exists now | What is still open |
| --- | --- | --- | --- |
| EDIT-12 Evidence index | Started | `docs/qa/EVIDENCE_INDEX.md` lists dated local and hosted runs with the commit and tree, and what was not covered. | Must be refreshed after every change that lands; it is not a release attestation. |
| EDIT-17 Driver evidence | Mostly done | Admins record which document kinds they sighted per verification revision (no files, no numbers; append-only, capped, audited). Pending drivers upload JPEG/PNG/PDF (5 MB, 6 per revision) from the pending-review screen using their pending-status session; files live on server disk under random names, the database holds metadata only; Admins download as audited, non-renderable attachments; decided applications are purged after `DRIVER_DOCUMENT_RETENTION_DAYS` (default 90) by `npm run documents:purge`. Off unless `DRIVER_DOCUMENTS_ENABLED` and `DRIVER_DOCUMENTS_DIR` are set. | The 90-day default is an engineering choice for the product owner to confirm. No malware scanning and no encryption beyond host disk encryption. A rejected applicant still cannot sign in, so re-review remains Admin-initiated. Not yet exercised on the real hosting environment (persistent storage, backups, scheduled purge). |

**Evidence (2026-10-26, local):** API 834 tests, Admin 380, tooling 76 passed (2 skipped), Flutter 628 tests and `flutter analyze` clean. The upload flow was run over HTTP against real MySQL (`masari_demo`) and on an Android emulator (API 36, English). **Not inspected:** Arabic screens of the document card, a PDF upload from a device, the Admin Download button in a browser.

**Unchanged and still requiring owners:** EDIT-01 to EDIT-10, EDIT-19 to EDIT-24, and the human acceptance walkthrough. The two new migrations (`20261026120000_driver_verification_evidence`, `20261026140000_driver_verification_documents`) have been applied only to the local `masari` and disposable `masari_demo` databases.
