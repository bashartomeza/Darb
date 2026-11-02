# Card 5 Admin Trips Management Design

## Goal

Give Admin users a complete, bilingual trip directory and detail workflow without inventing new trip lifecycle, cancellation, location, or canonical-trip behavior.

## Scope and ownership

Card 5 owns dedicated Admin trip read APIs, the Admin Trips UI, and the safe exposure of lifecycle transitions that the legacy trip domain already supports. It does not change Prisma, migrations, mobile behavior, matching, batching, maps, GPS, realtime, payments, or canonical/shared trip services.

The trip inventory has three honest projections:

- `legacy`: `operational_mode` is `legacy` and no shared manifest is attached.
- `canonical`: a non-legacy canonical trip without a shared manifest.
- `shared`: a trip attached to a canonical manifest.

All three are visible. Only legacy trips are mutable in Card 5.

## API contracts

### Directory

`GET /api/v1/admin/trips`

The endpoint is Admin-only and supports bounded server-side pagination, bounded search, status filtering, trip-kind filtering, and deterministic ordering by `created_at DESC, id ASC`. Its safe projection includes trip identity and status, route summary, driver identity, participant summary/counts, timestamps, and whether a stored location exists. It excludes raw route snapshots, password/auth fields, and integrity internals.

### Detail

`GET /api/v1/admin/trips/:id`

The endpoint returns the same safe identity plus route, participant, lifecycle, and source-specific details. Shared manifest members are bounded and deterministically ordered. The latest location is the newest persisted `LocationEvent`, labeled with its stored source and timestamp. The API and UI never describe it as live GPS.

### Legacy lifecycle mutation

`POST /api/v1/admin/trips/:id/status`

The body requires both `status` and `expected_status`. The Admin transition allowlist is:

- `accepted -> pickup_started`
- `pickup_started -> picked_up`
- `picked_up -> in_transit`
- `in_transit -> delivered`
- `delivered -> completed`

`created`, `completed`, and `cancelled` expose no Admin forward action. Cancellation is intentionally excluded even though a legacy role-owned route historically accepts it, because related operational state cannot currently be rolled back safely and transactionally.

The mutation runs through the extracted legacy lifecycle service used by the existing role-owned endpoint. It checks the authoritative current status inside the transaction and conditionally writes from the expected status. A stale snapshot returns HTTP 409 and performs zero writes. Canonical/shared trip mutation attempts are rejected and never routed through legacy lifecycle logic.

## Lifecycle architecture

One shared service owns legacy transition validation and related updates. The existing `/trips/:id/status` route keeps its current authorization and public request contract while delegating its transition work to that service. The new Admin endpoint delegates to the same service with stricter Admin policy: expected-status concurrency control and no cancellation.

The service performs the existing related state updates for route, request, order, batch, and parcels in the same database transaction. It does not add a second state machine or expand the existing transition graph.

## Admin experience

The Trips destination becomes a server-backed directory with search, status/type filters, pagination, loading/error/empty states, and a responsive table/card presentation. Selecting a trip opens a detail view that shows source classification, route and participant information, lifecycle timestamps, and the latest stored location when present.

For eligible legacy trips, exactly one safe next action is shown and requires confirmation. Created trips explain that no supported Admin forward action exists. Canonical/shared trips explain that their lifecycle is read-only in Card 5. All trip details state that Admin cancellation is unavailable until cross-domain rollback can be performed safely and transactionally.

Arabic remains RTL and English remains LTR. Controls use semantic buttons/labels and retain keyboard access at desktop and narrow widths.

## Data access and performance

All reads use explicit Prisma `select` projections. Directory pagination is capped, count and page reads are grouped consistently, and relation access is performed through bounded nested projections rather than per-row application queries. Ordering includes a stable ID tie-breaker. Detail-only data, including the newest stored location and bounded shared members, is not expanded into the directory response.

## Testing

API tests prove Admin authentication/authorization, all-kind visibility, safe projection, pagination bounds, deterministic filters, detail shape, latest stored-location labeling, legacy forward transitions, required expected status, stale 409 zero-write behavior, created/canonical/shared read-only policy, cancellation rejection, and preservation of role-owned lifecycle behavior.

Admin tests prove request serialization, directory/filter/pagination behavior, detail navigation, bilingual RTL/LTR content, responsive structure, honest source/location/cancellation copy, correct safe action rendering, confirmation, stale reload behavior, and no controls for unsupported mutations.

The final gate includes full API, Admin, Mobile, build/typecheck, MySQL integration, migration-count/history, deterministic-demo, secret, dependency-audit, and hosted CI checks. Human QA uses only a disposable database and separately hosted local API/Admin ports.

