# M7C3C2 runtime validation

This record separates automated evidence from manual device evidence. The results below were collected on the exact local feature head before the draft pull request was opened.

## Required configuration

Use an isolated MySQL 8.0.46 database. Enable canonical entry, matching, Trip creation, shared backend, and shared mobile presentation only in the approved local/test runtime. Production and staging must reject shared mobile enablement. Maps, GPS, location permissions, tracking, and realtime remain disabled.

## Automated gates

- MySQL 8.0.46 with `utf8mb4_0900_ai_ci` applied all 18 migrations from empty, repeated deployment as a no-op, and reported current migration status. Migration 17 and 18 normalized checksums remained `5ea77b6a40bfcbd2be1ba1076eb30951b85f5e6dd34f6037b3265a835f847c90` and `b27a28b17c6c090fad8520b97bde8c02463fb02f0195f2cb6736117f64af167c`; all five migration-18 triggers were present.
- Clean dependency installation, Prisma validation/generation, workspace typecheck/build, standard validation, security validation, and production artifact scans passed. API tests passed `204`; Admin tests passed `27`; tooling tests passed `9`. The raw production audit reports only the four approved moderate Prisma CLI transitives and no High/Critical finding.
- Flutter dependency/localization generation, zero-change formatting, analysis, and `199` tests passed. Debug and production-like release APKs built; the production-like APK and production admin bundle passed isolation scans. The Android manifest retains Internet access only and has no location permission.
- The real-MySQL M7C3C1 `141`-assertion, M7C3A `98`-assertion, M7C1 `79`-assertion, public-onboarding `76`-check, trusted-session, onboarding-foundation, route-lifecycle, deterministic integration, and backup/restore paths passed. The isolated restore database was removed.
- Demo preflight passed `22/22`. Deterministic smoke remained score `0.9317`, sequence `2`, trips `1` versus `6`, distance `21.53` versus `129.19`, cost `43.06` versus `258.38`, and winner `darb`.

## API 36 device matrix

- Arabic opened by default with RTL and the correct `درب` spelling. English switched to LTR. Shared navigation was capability-gated and remained separate from the individual-offer path.
- Passenger-only: the driver saw one request/one seat, zero merchant orders/parcels, and two ordered aggregate stop events; whole-manifest acceptance produced one shared Trip with no lifecycle, map, ETA, tracking, or movement control.
- Merchant-only: the driver saw zero passenger counts, one order/two parcels, and aggregate parcel stop events; categorical `schedule_conflict` rejection produced one rejected offer/manifest, one released reservation, one rejected attempt, zero Trip, and exactly restored parcel capacity.
- Mixed: the driver saw one passenger request/two seats plus one merchant order/three parcels, accepted the entire manifest, and received one shared Trip summary. Persistent MySQL state proved one accepted manifest, offer, confirmed reservation, Trip, and snapshot; two member dispatches referenced the same Trip; remaining capacity changed once from three seats/five parcels to one seat/two parcels.
- Passenger and merchant owner screens each showed their own accepted assignment, a neutral shared-Trip indicator, and the no-tracking notice. Neither screen exposed aggregate co-member counts, identities, phones, parcel descriptions, coordinates, ETA, or map data.
- Portrait and landscape at 200% font scale remained scrollable on the 1080x2400 API 36 emulator, with no Flutter overflow log. UIAutomator semantics exposed concise aggregate cards, status, counts, stop events, and labeled actions without internal IDs.

## Evidence boundary

Automated Flutter tests cover exact-key accept/reject replay, secure write-before-send, no-send on secure-save failure, actor and operation mutual exclusion, capability loss, stale-response fencing, exact terminal reconciliation, corrupt/expired/clock-anomalous quarantine, logout preservation, and response-loss recovery. The complete manual process-death timing matrix, every rotation-in-flight boundary, gesture-back matrix, and a full hands-on TalkBack pass were not reproduced on the emulator in this implementation run. They remain explicit independent-review obligations; no unexecuted boundary is reported as passed.

The shared mobile and backend gates remain forbidden in staging/production. Production-like builds keep canonical entry and shared navigation fail-closed and contain no map SDK, GPS/location permission, realtime transport, shared test fixture, demo credential, or secure-operation value.
