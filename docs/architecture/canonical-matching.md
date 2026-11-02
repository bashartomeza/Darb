# Canonical matching

M7C3A adds a backend-only matcher for `canonical_route_v1`. It does not replace the deterministic `darb_route_score` legacy matcher.

The internal runner processes at most 25 pending dispatches by default and 100 by explicit limit. It is unavailable outside local, test, and demo, has no HTTP endpoint, and requires all three gates:

- `MULTI_ROUTE_ENTRY_ENABLED=true`
- `MULTI_ROUTE_MATCHING_ENABLED=true`
- `CANONICAL_TRIP_CREATION_ENABLED=true`

Staging and production fail startup if any canonical write/matching gate is enabled. There is no scheduler.

Candidates must share the exact current published `ServiceRouteVersion`, have active canonical availability, a future departure inside the demand window, sufficient capacity, and an active verified driver account whose current role remains `driver`. M7C3A excludes any availability that already owns an active or accepted canonical offer or canonical Trip. Remaining capacity does not authorize a second Trip before M7C3C adds an explicit aggregate trip/membership model.

`canonical_route_match_v1` is deterministic:

| Component | Weight |
|---|---:|
| Departure-window fit | 45% |
| Capacity-utilization fit | 25% |
| Normalized driver trust | 20% |
| 30-day accepted-assignment fairness | 10% |

Ties resolve by score descending, departure delta ascending, trust descending, recent assignment count ascending, then DriverRoute ID ascending. Coordinates, geometry, demographics, legacy corridor score, fake ETA, and provider routing are excluded.

The stored explanation is an allowlist of route-version ID, departure delta, requested and available capacity, trust category/normalization, fairness count, scorer version, and final score.

The canonical lock order is route/version/stops, dispatch, demand aggregate, driver user/profile, offer, DriverRoute, reservation, then Trip creation. Merchant demand locks the order parent before its parcel rows. Each dispatch is processed in its own `READ COMMITTED` transaction. One failed dispatch is quarantined independently.

Beta constants are a five-minute offer lifetime, maximum five sequential attempts, default batch 25, and maximum batch 100.
