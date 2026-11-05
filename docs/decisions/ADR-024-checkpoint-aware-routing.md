# ADR-024: Checkpoint-aware routing on a routing engine that cannot avoid points

- Status: Accepted (implementation PR for the owner's request of 2026-11-05)
- Date: 2026-11-05
- Related: ADR-020 (route map provider selection), `docs/api/route-plans.md`, `docs/checkpoints/map-sources.md`

## Context

How routes were drawn before this change:

- The apps called the **public OSRM demo server** (`router.project-osrm.org`) straight from the phone (`OsrmRouteService`), one request per route, cached per rounded waypoint pair. A failure drew a dashed straight line. Catalogue routes use the published geometry when it exists, otherwise OSRM through their stops.
- Tiles are OpenStreetMap tiles. Routing and tiles are unrelated to the checkpoint feed.
- Checkpoints come from `GET /checkpoints`: either a coordinate feed (`CHECKPOINTS_URL`) or the AweenRayeh partner feed placed on the map from `checkpoint_positions` (team research, with a confidence rating) and an OpenStreetMap name match. The partner feed has no coordinates; it has per-direction states ("سالك", "مغلق", "أزمة ...") and "last changed" times. The server caches it for 15 s (partner) or 1 minute (coordinate feed). 63 of 70 rows have a researched position; 18 of those are rated low or unverified, i.e. the pin may be at a neighbouring gate.
- Nothing combined the two: a driver's line or ETA could run straight through a checkpoint shown red on the same map.

## Decision

Plan routes on the server, against the same checkpoint data the map shows.

1. **`POST /route-plans`** (`apps/api`, `checkpointRouting.ts`, `routePlanner.ts`). The server asks the engine for the fastest route plus alternatives, measures the distance from every candidate polyline to every positioned checkpoint, and chooses:
   - a candidate with a **closed** checkpoint within 150 m is rejected whenever another candidate is free of closed ones, whatever the detour;
   - a **congested** checkpoint is avoided only if the alternative costs at most 600 s and 8 km more (both configurable), otherwise the route is kept with a warning;
   - **unknown** status never reroutes; status from a feed older than 300 s (or flagged stale) is treated as unknown, never as closed and never as open;
   - an **approximate** pin is matched with a wider radius (500 m) so that a gate position error does not hide a closure, and the plan says the position is approximate;
   - if the engine's alternatives all pass a closed checkpoint, try **via-point detours** beside the blocker (1.5 km and 4 km to each side, at most 8 extra calls) and select again;
   - if nothing is clear the plan is `blocked`, the least-bad route is returned and the apps show "All known routes pass a closed checkpoint". It is never presented as a clean route.
2. **Server-side, not in the app**, because the checkpoint statuses, thresholds and TTL are tuned centrally without a release; the engine call, candidate evaluation and rate limiting happen once; and the routing engine can be replaced without shipping an app. The service shares the checkpoint source objects with `GET /checkpoints`, so the line and the pins always agree.
3. **One client seam.** `roadRouteProvider` (already the single source of every line and ETA) uses the plan when `checkpoints_available` is true, falls back to the direct OSRM route (flagged "could not check") when the planner fails, and to the dashed line after that. It re-plans when the signature of all checkpoint statuses changes, and the feed is re-read every 60 s while a route is displayed in the foreground. The order flow gets the warning through the shared `DarbRouteMap`; no order screen was edited.
4. **No schema change, no new capability field** (installed Flutter builds reject unknown capability fields; the route answers 404/403 where it does not apply and the app remembers that for ten minutes).

## Limits (honest list)

- **OSRM cannot avoid points.** The public server has no exclude-by-coordinate, and its `exclude` only handles road classes (motorway, toll, ferry). We therefore *sample* the route space: the engine's own alternatives (OSRM returns few and they are often near-duplicates on short West Bank trips) plus via-point detours. A clean route that exists but is not among those candidates is missed, and the plan then says `blocked` although a way may exist. The reverse never happens: a route marked clear really does not pass a known closed checkpoint within the radius.
- **Via points are nudges, not instructions.** The engine snaps a via point to the nearest road; the result can include a small spur or U-turn at the point, and may pass another checkpoint that the next evaluation then rejects.
- **Closed means closed for the whole checkpoint.** The feed has an entering and a leaving direction; the status used is the worst of the two, as on the map. A checkpoint closed only in the opposite direction still triggers a detour. The route is not direction-aware.
- **Position quality.** A few feed rows have no pin at all (2 of 70 on 2026-11-03; they are listed as unplaced and cannot be avoided); pins rated low/unverified can be off by a gate. Unplaced checkpoints are invisible to routing.
- **Freshness.** Status age is the age of our last read of the feed (at most about a minute plus the 60 s app poll), not the age of the real-world event. The partner's "last changed" text has no timezone and is deliberately not used. If the upstream is slow to reflect a closure, so are we.
- **Not turn-by-turn navigation.** The app draws and times a route; it does not give instructions or reroute off the line. Re-evaluation happens when statuses change or a new route is requested.
- **Public demo server.** `router.project-osrm.org` is a best-effort demo with a usage policy, no SLA and a frozen, sometimes outdated road graph; West Bank road data and restrictions (roads that civilians cannot use) are only as good as OSM. Our extra calls (alternatives, detours) increase the load on it. Plans are cached (30 s) and engine answers are cached (5 min), and the route is rate limited per user.
- Plans of more than 6 waypoints are not checked (catalogue routes with many stops keep today's behaviour). OSRM returns alternatives only for two-point requests, so multi-stop trips are planned leg by leg.

## Production upgrade path

Pick in this order as volume and risk grow:

1. **Self-host OSRM** (or Valhalla/GraphHopper) with the Palestine extract, and point `CHECKPOINT_ROUTING_OSRM_URL` at it. No code change; removes the demo-server dependency and its policy limit, and lets the graph be curated.
2. **Bake closures into the graph.** OSRM: a Lua profile / `--segment-speed-file` update can set speed 0 (or exclude) on the edges around a closed checkpoint and a periodic `osrm-customize` (MLD) applies it in seconds without a full re-extract. Valhalla and GraphHopper accept per-request `exclude_locations` / `block_area` / custom models, which makes avoidance exact instead of sampled and would replace the via-point step in `RoutePlanner` (the `RoutingEngine` interface is the seam: add an engine whose `route()` accepts the blocked points).
3. **Per-direction status** once the feed exposes which direction a closure applies to, and a direction-aware match of the route.
4. **Push** (FCM) of "checkpoint X on your active trip closed" to replace the 60 s poll, once push delivery is in place.

## Alternatives considered

- *Client-side evaluation* (alternatives requested by the phone, checked there): duplicates the logic in every app build, makes thresholds a release matter, and multiplies calls to the demo server.
- *Treat stale status as its last value*: rejected; a possibly outdated closure rerouting a driver, or an outdated "open" reassuring one, is worse than saying "unknown".
- *Reject the route when blocked*: rejected; the user still needs a line. It is shown with a red warning instead.
- *Use the partner "last changed" time for freshness*: rejected; it records the last change, not the last confirmation, and has no timezone.
