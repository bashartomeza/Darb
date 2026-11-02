# ADR-009: Immutable canonical route versions

- Status: accepted
- Date: 2026-07-21

## Context

Darb's deterministic MVP combines a route corridor and a driver's availability in `DriverRoute`. Multi-route operations require stable route identities, reusable stops, auditable corrections, and historical trip safety without changing the approved matcher during M7B.

## Decision

Use `ServiceRoute` as stable identity and `ServiceRouteVersion` as immutable published content. A nullable current-version pointer selects one published/paused version and is database-constrained to a version owned by that same route. Ordered stops and permission flags belong to the version through `RouteVersionStop`. `Stop` identities are reusable and become content-immutable once referenced by any version, including a draft.

Published corrections clone to the next transactionally allocated version. Cloning retains content and permissions but discards geometry approval metadata and rejects retired or cross-region source stops. Publication locks the stable route, draft version, and member stops, validates all route invariants, fences the observed current pointer, publishes the draft, pauses a prior current published version when present, and switches the pointer in one MySQL transaction.

Retirement is terminal and non-destructive. History-bearing relationships use restrictive FKs. Driver availability remains in `DriverRoute` through nullable compatibility fields; current matching does not consume the new reference.

## Consequences

- Historical names, stop order, permissions, and geometry cannot be silently rewritten.
- Correcting a referenced stop requires a new stop identity and route version rather than an in-place edit.
- Concurrent draft edits receive explicit revision conflicts.
- Concurrent version creation/clone receives unique next numbers, and concurrent publication produces one current version.
- Admin workflows become deliberate but require cloning for corrections.
- M7C must migrate operational route selection and enforce paused/current route rules before multi-route entry can be enabled.
- M7D may add approved provider geometry only through a new immutable version.

## Rejected alternatives

- Editing one mutable route row would corrupt historical meaning.
- Reusing `DriverRoute` as canonical identity would couple driver departure/capacity to shared route content.
- Provider-specific geometry or map SDK selection in M7B would exceed the approved boundary.
- Destructive deletion would break audit, availability, match, and trip history.
