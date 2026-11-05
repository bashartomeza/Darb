# Checkpoint-aware route plans

`POST /api/v1/route-plans` returns a road route between two to six points that
takes the live checkpoint status into account. Every route the apps draw or time
(the line on the map, a driver's trip line, the ETA and distance) comes from it
when a checkpoint source is configured. Design background and limits:
[ADR-024](../decisions/ADR-024-checkpoint-aware-routing.md).

## When it exists

The route is mounted only when a checkpoint source is on, exactly like
`GET /checkpoints` (`CHECKPOINTS_ENABLED`, or `PARTNER_CHECKPOINT_MAP_ENABLED`):

| Source | Roles |
| --- | --- |
| Coordinate feed (`CHECKPOINTS_URL`) | any signed-in role |
| AweenRayeh partner map | passenger, driver (merchants get `403`) |
| none | `404` |

The apps ask only when `GET /capabilities` reports `checkpoints_available: true`,
and stop asking for ten minutes after a `403`/`404`. No capability field was
added: installed Flutter builds reject unknown capability fields.

## Request

```json
{ "waypoints": [ { "latitude": 31.5, "longitude": 35.1 }, { "latitude": 31.5, "longitude": 35.3 } ] }
```

2 to 6 waypoints, all inside the service area (lat 29.4-33.4, lng 34.2-35.95),
numbers only, no extra fields (`400 validation_error` otherwise). The server
plans each leg between consecutive waypoints. Rate limit: 60 requests per
minute per user (`CHECKPOINT_ROUTING_RATE_LIMIT_PER_MINUTE`, `429
route_plan_rate_limited`).

## Response

```json
{
  "plan": {
    "status": "rerouted_closed",
    "coordinates": [[35.1, 31.5], [35.2, 31.56], [35.3, 31.5]],
    "distance_meters": 24000,
    "duration_seconds": 1900,
    "baseline": { "distance_meters": 19000, "duration_seconds": 1500 },
    "extra_distance_meters": 5000,
    "extra_duration_seconds": 400,
    "checkpoints_on_route": [ { "id": "...", "name_ar": "...", "name_en": null, "city": null,
      "latitude": 31.5, "longitude": 35.2, "status": "open", "reported_status": "open",
      "position_approximate": false, "distance_meters": 12 } ],
    "avoided_checkpoints": [ { "id": "...", "status": "closed", "...": "..." } ],
    "warnings": [],
    "checkpoint_data": { "available": true, "fetched_at": "2026-11-05T11:59:50.000Z",
      "status_trusted": true, "threshold_meters": 150, "approximate_threshold_meters": 500,
      "status_ttl_seconds": 300 },
    "evaluated": { "candidates": 2, "detour_candidates": 0, "engine_calls": 1 },
    "provider": { "name": "osrm", "attribution": "© OpenStreetMap contributors" }
  },
  "request_id": "..."
}
```

`coordinates` are GeoJSON order, `[longitude, latitude]`. `baseline` is the
routing engine's own fastest road; `extra_*` is the cost of the chosen route over
it. `Cache-Control: no-store`.

### `status`

| Value | Meaning | App behaviour |
| --- | --- | --- |
| `clear` | No closed or congested checkpoint on the route. | Nothing extra. |
| `rerouted_closed` | The fastest road passes a closed checkpoint; this route does not. | Banner "Route changed: checkpoint X is closed (about N min longer)". |
| `rerouted_congestion` | The fastest road passes a congested checkpoint and a reasonable alternative exists. | Info banner. |
| `congestion_warning` | Congestion on the route and no alternative within the configured extra time and distance. | Warning banner; the route is kept. |
| `blocked` | Every known route passes a closed checkpoint. | Red banner "All known routes pass a closed checkpoint"; the least-bad route is drawn and never presented as clean. |
| `unchecked` | Checkpoint data could not be read, so nothing was checked. | Warning "Could not check this route". |

### `warnings`

`all_routes_closed`, `congestion_unavoidable`, `status_stale` (the feed is older
than the TTL: every status was treated as unknown, so the route was not changed),
`position_approximate` (a closed/congested/unknown checkpoint on the route has
only an approximate pin), `checkpoint_data_unavailable`, `no_checkpoints_known`.

### Errors

- `502 route_provider_unavailable`: the routing engine failed or timed out. The
  app falls back to its own direct road route (and shows "Could not check this
  route"), or the labelled dashed straight line if that fails too.
- `400`, `401`, `403`, `404`, `429` as above.

## How the route is chosen

1. Ask the engine (OSRM) for the fastest route and up to 3 alternatives per leg.
2. Test every candidate polyline against every checkpoint with a position: a
   checkpoint is **on the route** when the closest distance from its pin to the
   line is at most `CHECKPOINT_ROUTING_THRESHOLD_METERS` (default 150 m); for a
   checkpoint whose pin is approximate (research confidence low or unverified)
   the radius is `CHECKPOINT_ROUTING_APPROX_THRESHOLD_METERS` (default 500 m).
3. A candidate with no **closed** checkpoint beats any candidate with one,
   however long the detour. Among those, a candidate with no **congested**
   checkpoint wins only if it costs at most `..._CONGESTION_MAX_EXTRA_SECONDS`
   (600) more time **and** `..._CONGESTION_MAX_EXTRA_METERS` (8000) more distance
   than the best candidate; otherwise the faster route is kept with
   `congestion_unavoidable`.
4. If no engine candidate is clear of closed checkpoints (or congestion cannot be
   avoided), try detours: for up to two blocking checkpoints, route through a
   via point placed 1.5 km and 4 km to either side of the road at the
   checkpoint (at most 8 extra engine calls, never on top of another closed
   checkpoint), and run the same selection over all candidates.
5. If still nothing is clear: `blocked`.

Unknown statuses never change the choice. Statuses are trusted only while the
feed read is at most `CHECKPOINT_ROUTING_STATUS_TTL_SECONDS` (300) old and not
flagged `stale`; otherwise every status counts as `unknown` and the plan carries
`status_stale`. The partner "last changed" times are *not* used for freshness: a
closure that has not changed for two days is still a closure.

Plans are cached for 30 s per rounded origin/destination and checkpoint-status
signature; raw engine answers for 5 min, so a checkpoint flipping status
re-evaluates the cached candidates without another engine call.

## Settings (all optional)

| Variable | Default | Range |
| --- | --- | --- |
| `CHECKPOINT_ROUTING_THRESHOLD_METERS` | 150 | 30-1000 |
| `CHECKPOINT_ROUTING_APPROX_THRESHOLD_METERS` | 500 | 30-3000 (never below the threshold) |
| `CHECKPOINT_ROUTING_STATUS_TTL_SECONDS` | 300 | 15-86400 |
| `CHECKPOINT_ROUTING_CONGESTION_MAX_EXTRA_SECONDS` | 600 | 0-7200 |
| `CHECKPOINT_ROUTING_CONGESTION_MAX_EXTRA_METERS` | 8000 | 0-100000 |
| `CHECKPOINT_ROUTING_OSRM_URL` | `https://router.project-osrm.org` | URL of an OSRM-compatible `/route/v1` service |
| `CHECKPOINT_ROUTING_TIMEOUT_MS` | 6000 | 500-20000 |
| `CHECKPOINT_ROUTING_RATE_LIMIT_PER_MINUTE` | 60 | 1-600 |

## Mobile behaviour

- `roadRouteProvider` (the one source of every route line and ETA) calls this
  endpoint when capabilities say a checkpoint source exists; otherwise it behaves
  as before. Order and trip screens need no change; they get the new notices
  through the shared `roadRouteNotes`, `roadRouteMarkers` and `DarbRouteMap`.
- Checkpoints on the route get a halo in their status colour (green open, orange
  congested, red closed, grey unknown) behind their normal pin.
- The route is planned again when any checkpoint's status changes (a signature of
  all statuses), and the checkpoint feed is re-read every 60 seconds while a
  route is on screen and the app is in the foreground. The server's feed cache is
  15-60 s, so this is the useful floor; nothing runs in the background.
- Planner failure never removes the route: plain road route with "Could not
  check this route", or the dashed straight line.
- Strings: `routeChangedClosed`, `routeChangedClosedExtra`, `routeChangedCongested`,
  `routeAllClosed`, `routeCongestedWarning`, `routeCheckUnavailable`,
  `routeStatusStale`, `routePositionApproximate`, `routeCheckpointOnRoute` (AR + EN).
- The order flow's route preview uses `DarbRouteMap`, so it shows the same
  notices without any order-screen change.
