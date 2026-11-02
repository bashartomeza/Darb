# M7C2 runtime validation

M7C2 is validated only with explicit local/demo `ROUTE_MANAGEMENT_ENABLED=true` and `MULTI_ROUTE_ENTRY_ENABLED=true`. `MULTI_ROUTE_MATCHING_ENABLED` remains false. Staging/production must reject entry enablement and advertise catalog/entry capability truthfully without exposing environment values.

Runtime evidence must cover three published routes, multiple directions, at least five ordered stops, passenger-only and parcel-only permissions, paused/retired/replaced/inactive versions, active role authorization, route replacement during a form, response loss and process restart for each atomic create, 50/51 parcel behavior, lifecycle conflicts, access-token refresh, logout/session revocation, Arabic/English, 200% text, rotation, and system/gesture back.

The gate also reruns all 13 migrations from empty/current status, M7C1 real-MySQL assertions, trusted sessions, public onboarding, backup/restore cleanup, 22/22 preflight, deterministic smoke, production-like capability isolation, and artifact/log scans. Expected deterministic demo values remain score `0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.

No database migration or data cleanup is introduced by M7C2. Canonical test records are disposable owner data; the protected deterministic reset remains the approved demo reset.

## Completed validation evidence

The final branch gate passed a clean npm install, Prisma validation and generation,
repeat no-op deployment and current status for all 13 migrations, workspace
typecheck/build, 179 API tests, 27 admin tests, eight tooling tests, and the
standard and security policy suites. The production-configured admin build and
production-like release APK built and passed artifact isolation scanning. The
raw production dependency audit contains four documented moderate findings in
the Prisma CLI chain and no high or critical finding; no force fix or Prisma
version change was used.

Flutter dependency and localization generation, zero-change formatting,
analysis, and all 155 tests passed. A fresh rebuilt debug APK was installed on
`Medium_Phone_API_36.0` / Android API 36 and reached the MySQL-backed API.
Arabic opened RTL by default, English switched to LTR, the driver availability,
passenger request, and merchant atomic-order paths completed successfully, and
the matching-disabled boundary remained truthful. System back returned to the
role dashboard. Portrait, landscape, and 200% text remained scrollable without
overflow. An internal service-region key found during emulator review was
removed from visible route cards and the rebuilt APK was rechecked.

The dedicated real-MySQL suites passed from an empty 13-migration database,
including migration repeatability, trusted sessions, onboarding, public
onboarding, M7B route behavior, and the M7C1 78-assertion operational/concurrency
suite, followed by cleanup. A checksum-backed backup restored into an isolated
database, reported current migrations, and removed the isolated database.
Live demo preflight passed 22/22 and deterministic smoke retained score
`0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`,
cost `43.06` versus `258.38`, and winner `darb`. Captured-log scanning found
no credential, authorization, idempotency-header, or coordinate markers.

## Independent review correction evidence

The independent review found no Critical issue and corrected the High-risk
operation-recovery defects before review readiness. The secure create bundle is
now versioned and actor-bound, persisted before send, preserved through
ambiguous idempotency/network outcomes and authentication termination, blocked
from payload/operation/account replacement, and deleted only after confirmed
result acknowledgement or exact owner-detail reconciliation. Expired,
clock-anomalous, and unreadable bundles are quarantined instead of silently
discarded. New operations revalidate both capability and current-route
eligibility immediately before persistence/send.

The emulator reproduced passenger and merchant process death after a committed
response and before result acknowledgement. Both exact replays retained one
logical record and produced zero canonical matches/trips. Cross-account access
was blocked without exposing the encrypted payload. A real driver-to-merchant
sequence found and corrected MySQL millisecond versus Flutter microsecond
result reconciliation; the rebuilt app then cleared only the exact driver
bundle and allowed the merchant operation. Driver draft/activate/pause/resume/
cancel lifecycle state remained server-authoritative.

Final correction-head local gates passed 179 API tests, 27 admin tests, 163
Flutter tests, eight tooling tests, production admin/release-APK scans, empty
and repeatable 13-migration deployment, trusted sessions, onboarding, 76-check
public onboarding, route lifecycle, the M7C1 78-assertion harness, backup/
isolated restore, 22/22 preflight, and deterministic smoke. The final reset
left zero canonical availability/request/order/match/trip records. Arabic RTL,
English LTR, API 36, landscape, and 200% text were inspected on the rebuilt
debug APK.

Accepted non-blocking follow-ups remain: add dirty-form-specific back warnings;
add a spoken reason when the merchant reaches 50 parcels and a dedicated
TalkBack 50/51 automation; expose driver edit controls if product scope later
requires them; and add an owner-history/support reconciliation contract before
automating recovery beyond the server idempotency window. These do not weaken
the exact replay, actor isolation, feature gate, or M7C3 boundary.
