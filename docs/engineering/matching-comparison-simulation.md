# Matching comparison simulation

A deterministic, seeded simulation that compares three dispatch methods over the
same scenarios. Every figure is **simulated**: no database is read, no trip is
created, and the admin UI labels the output as such.

- Engine: `apps/api/src/services/matchingComparison.ts`
- Real scoring reused: `apps/api/src/lib/routeScoring.ts` (`scoreDriverRoute`,
  `compareRankedRoutes`), extracted unchanged from `modules/matching.ts`, which
  re-exports it. The live matcher and the simulation therefore share one
  implementation.
- API: `GET /api/v1/compare/simulation?seed=<int>&manual_response_delay_min=<n>` (admin only)
- CLI: `npm run simulate:compare -w @masari/api -- [--seed=N] [--delay=MIN] [--out=file.json]`
  prints a table and writes JSON (default `comparison-simulation.json` in the cwd).
- Admin: Matching / Batching page, "Simulated comparison" tab (EN + AR).

## Methods

| Method | Behaviour modelled |
| --- | --- |
| Manual (WhatsApp-style) | One dispatcher handles requests in order. For each request they ask drivers who have not departed, in seeded random order; each reply takes `manualResponseDelayMin` x (0.5..1.5) minutes. A driver without free capacity declines; otherwise accepts with probability 0.6 (same direction) or 0.15 (wrong direction). Up to 8 asks, then the request is unmatched. The dispatcher is busy until the request is resolved, so a backlog builds. |
| Nearest driver | Fixed 0.5 min processing. Picks the not-yet-departed driver with capacity whose start point is nearest to the pickup (haversine). Ignores direction. Each request is its own dispatch (no batching). |
| Masari | Candidate filter, `scoreDriverRoute` scoring and tie-break order are the real legacy matcher's (`compareRankedRoutes`). Parcel orders are grouped using the limits in `createParcelBatch` (same merchant, pickups within 1 km, at most 20 orders / 50 parcels). A match takes `masariOfferDelayMin` (1.5 min) to be accepted. |

## Metrics (per method, per scenario and pooled)

- Waiting time: request time to estimated pickup (`max(driver departure, match time)` plus
  straight-line origin-to-pickup travel at 40 km/h). Average, median, P90 (nearest-rank).
- Matching time: request time to match confirmation. Average, median, P90.
- Route deviation: extra km. Per driver tour `origin -> pickups -> drop-offs -> destination`
  (stops ordered by distance from the origin) minus the direct origin-destination distance.
- Seat utilisation (seats used / seats of drivers that carried passengers), parcel capacity
  utilisation (same for parcels), vehicle utilisation (drivers used / drivers available).
- Unmatched %.

Waiting and matching time are averaged over matched requests only; unmatched requests are
reported separately.

## Scenarios

Four hand-written (`morning_commute_rush`, `merchant_parcel_wave`, `sparse_evening`,
`wrong_direction_trap`) and three generated from the seed (`generated_small|medium|busy`).
Positions are placed on the real demo corridor (`DEMO_ROUTE_POINTS`, Hebron to Bethlehem) with
a small northward offset; driver origins are the corridor ends, with up to 3 km of jitter.
Each method gets its own RNG stream derived from `hash(seed, scenario, method)`, so changing
one method's behaviour never perturbs another's.

## Assumptions and limits

1. Distances are straight-line haversine, not road distances. Speed is a flat 40 km/h.
2. The corridor is a single route in two directions; real multi-route and canonical matching
   are not simulated. Masari uses the legacy scoring (`scoreDriverRoute`), which only knows
   the forward corridor label, pickup distance from the route origin, seat/parcel fit and trust.
   Timing fit is the fixed constant the real code uses.
3. Masari assumes the first-ranked driver accepts after `masariOfferDelayMin`. The real
   system has a 5 min offer lifetime and retries; rejections are not modelled.
4. The simulation does not split a parcel batch across drivers because the real matcher does
   not: a batch larger than any driver's parcel capacity is unmatched.
5. Drivers are available until their departure minute and cannot take requests after it.
6. Results are not tuned to favour Masari. In some scenarios nearest-driver is as good or
   better (for example waiting time on a busy day), because the legacy score does not
   minimise deviation or waiting directly. Read the results as a model, not a measurement.
7. All parameters live in `DEFAULT_SIM_PARAMS`; the API exposes `seed` and the manual reply delay.

## Tests

`apps/api/src/tests/matchingComparisonSimulation.test.ts` fixes the seed, pins the pooled
metrics with an inline snapshot, checks determinism, capacity invariants, that Masari's choice
follows `scoreDriverRoute`, the batching limits, and the admin-only endpoint.
If the snapshot changes, the simulation or the real scoring changed: review before updating.
