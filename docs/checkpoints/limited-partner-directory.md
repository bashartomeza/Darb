# Limited partner directory — Task 19C

This optional names-only directory is separate from the coordinate-bearing
`/api/v1/checkpoints` feed and the unpublished 173-record research directory.
All gates remain disabled by default. No provider credentials, real provider
responses, research names or coordinate candidates are included in this change.

## Contract reference and limits

Reference: developer-supplied **AweenRayeh API Integration Guide**, reviewed
2026-10-24. Permission is **USER_REPORTED**; this is not independent evidence
of full-dataset redistribution approval. Live conformance remains unverified.

The backend alone uses the fixed HTTPS `GET /v1/partner/checkpoints` target
at `db.aweenrayeh.com`, with `X-Api-Key`. There are no PostgREST headers,
query parameters, arbitrary URL overrides, redirect following or client keys.
The documented object has `generatedAt` and `checkpoints`; rows have `id`,
`city`, `checkpoint`, `entering_status_last_updated` and
`leaving_status_last_updated`. IDs are opaque strings, not invented UUIDs.
Required fields must be nonempty strings; nullability is not documented, so
missing/null fields fail closed. No undocumented aliases or pagination rules
are accepted. Empty collections are valid; any malformed row rejects the
whole response. More than seven rows in a city rejects the limited feed.

Generation and directional change timestamps remain verbatim. Offset-free
timestamps carry `timezone_specified: false`; the UI labels their timezone
unspecified. They never become UTC dates, freshness guarantees or traffic
conditions. The directory always reports null coordinates, unverified
coordinates, no map readiness and unavailable traffic. No pins or navigation
destinations are created. The fetched-at timestamp is local retrieval metadata,
not an observation timestamp or proof of present conditions.

## Backend configuration and coordination

- `AWEENRAYEH_LIMITED_DIRECTORY_ENABLED` defaults false.
- `AWEENRAYEH_PARTNER_API_KEY` is dedicated backend secret configuration, required
  only when enabling this gate. Never substitute the historical or legacy key.
- `AWEENRAYEH_PARTNER_TIMEOUT_MS` defaults 6000, bounded 500–15000 milliseconds.
- `GET /api/v1/limited-checkpoint-directory` requires a current, complete-profile
  Passenger/Driver session. Merchant/Admin roles are denied even on cached reads.
- `GET /api/v1/capabilities?include=limited-checkpoint-directory` explicitly opts
  into `limited_checkpoint_directory_available`; ordinary capability responses
  remain unchanged for older strict clients. Availability means configuration
  permits a read; it is not a claim that the provider is healthy.

Each app instance shares one single-flight request and a 15-second successful
response cache. Cache lifetime uses monotonic time. Expired data is never served
after failure; five-second negative caching reduces repeated failures. No
shared reservation denial is cached longer than five seconds: another instance
may settle its in-flight hold. Each retry still consults the durable budget
before HTTP, including during a provider cooldown. No
maximum stale-observation policy is invented. A fresh HTTP response can contain
old change timestamps: the UI continues to say traffic unavailable.

The existing `abuse_counters` table coordinates the key budget across instances
and process restarts in an isolated `checkpoint_partner_budget` namespace. Only
a SHA-256 digest of the dedicated high-entropy key is stored, never the key.
One row's `expires_at` is either its next eligible reservation or a fail-closed
hold. A short transaction locks it and reads database UTC time **after** acquiring
the lock. Before HTTP, it durably holds the key and returns a unique attempt lease.
Only successful settlement of that lease releases the hold to the request
deadline plus 2100 milliseconds, or extends it to a received Retry-After cooldown.
Since HTTP cannot start after its deadline, starts remain at least 2100 ms apart,
conservatively below 30/minute even at minute boundaries. Settlement rotates the
attempt identity; a stale settlement cannot clear a newer hold or cooldown.
No transaction stays open during HTTP.
The shared limiter may return unavailable rather than queue mobile requests;
payload caches are instance-local, not a distributed cache. The guide's edge
cache remains upstream-owned.

HTTP 429 extends the durable key cooldown using documented integer Retry-After
seconds, with a minimum/default of 60. Unsupported or excessive cooldown values
fail closed. A crash or failed settlement/cooldown write retains the shared hold
across processes/restarts; it requires operator investigation rather than an
automatic retry. This trades availability for respecting an unknown provider
cooldown. Do not delete a held row as a quota workaround; any recovery requires
the responsible operator's independently verified provider evidence and approval.
Database reservation errors send no request. SQL waits, transport,
body consumption and parsing share the request deadline. Responses are capped
at 1,000,000 decompressed bytes as a **server resource limit**, not a provider
feed-size or pagination claim. Overflow fails the entire response, never truncates.
Redirects and all non-200 responses return sanitized unavailability, never raw
provider bodies or exception causes. Authentication header variants and the new
secret environment field are redacted through existing supported log depths.

Enabling this feature alongside demo-reset functionality is rejected: reset
clears abuse counters. All instances sharing a provider key must use the same
coordinator database, without demo-reset access or external counter deletion.
There is no schema or migration change. Do not clear this namespace to bypass
a cooldown. Database outages and stale cache are availability failures, not
permission to fall back to direct provider requests.

## Mobile source separation

The existing directory action uses the explicitly enabled limited source first;
otherwise it retains the research capability and its original publication guard.
Sources are never merged. The screen reuses the existing search, city grouping,
cards and neutral status components. Limited records have their own strict DTO
parser; provider IDs are not research-row IDs. The research manifest and parser
are unchanged. The actor ID/session revision fences apply before dispatch and
after response; logout, account changes and capability withdrawal hide records.
There is no background polling, map conversion or traffic inference.

## Operator-controlled read-only conformance procedure (not executed)

This procedure is a separate authorization gate, not permission from this PR to
contact the provider, enable production, change permissions or deploy.

1. Obtain written owner confirmation of historical credential revocation and
   independent provider-side audit verification, without retrieving or testing
   that credential. Confirm the dedicated replacement's read-only partner scope,
   permitted users, limited/test mode and provider permission for this usage.
2. Use an approved isolated backend environment with a disposable database and
   synthetic Passenger/Driver sessions. Keep all other checkpoint/map/research
   gates disabled and demo resets disabled. Inject the dedicated replacement via
   the operator's secret manager into backend configuration only. Never place it
   in a shell argument, source file, prompt, browser, screenshot, CI or report.
   Disable HTTP tracing/proxy body/header capture for this check.
3. After explicit owner authorization, enable only the limited gate in that
   isolated backend. Make **one authenticated Masari directory read**, not a
   browser request to the provider. Exercise repeated Masari reads within 15
   seconds to confirm backend coalescing/cache behavior; do not intentionally
   exhaust quota or provoke authorization errors with real credentials.
4. A privileged operator checks response schema/types, stable IDs, city counts
   (at most seven per city), raw timestamp offsets/ambiguity and unavailable
   status/null coordinate invariants. Do not export the full response. Retain
   only a redacted schema summary, counts, UTC execution time, result, backend
   release SHA, provider request/audit reference if safely supplied, and named
   owner/reviewer confirmation. Never include actual key values or hashes,
   provider names/IDs without reuse approval, session tokens or HTTP headers.
5. Independently review the sanitized evidence, stop if fields differ, disable
   the isolated gate and remove its injected secret through normal operator
   procedures. Do not weaken parsing, permissions or research publication rules
   to force conformance. Live results do not approve traffic or map use.

## Release gates

`AWEENRAYEH_LIVE_CONFORMANCE = PASSED_ONE_READ_PENDING_INDEPENDENT_REVIEW` (2026-10-27; see `docs/qa/EVIDENCE_INDEX.md`)

`FULL_173_DIRECTORY_PUBLICATION = BLOCKED`

`VERIFIED_MAP_COORDINATES = 0`

`TRAFFIC_STATUS = UNAVAILABLE`

`CREDENTIAL_ROTATION = PENDING_OWNER_CONFIRMATION`

`CHECKPOINT_STALE_POLICY = APPROVED_FOR_DEMO_ONLY` (see `freshness-policy.md`; production needs a named safety approver)

`MERGE_GATE = BLOCKED_PENDING_USER_APPROVAL`

`PRODUCTION_DEPLOYMENT = NOT_AUTHORIZED`

`DESIGN_CHANGES = NONE`
