# Live driver location

The assigned driver's phone shares its position while a legacy trip runs; the
passenger, the merchant or parcel sender, the driver and Admin read the latest
point. Code: `apps/api/src/modules/liveLocation.ts`,
`apps/api/src/services/liveLocation.ts`; rows go to `location_events` with
`source = "driver_gps"`.

## Switch

`LIVE_TRACKING_ENABLED` (`true` / `false`, anything else fails start-up).
Default: on everywhere (owner decision: production tracks by default; set `false` to
switch it off). Drivers are still asked for permission in the app. Points are
purged after `LOCATION_RETENTION_DAYS` (default 30, see `docs/operations/data-retention.md`). `GET /capabilities` reports it as
`live_tracking_available`; the app only shares and shows live positions when it
is true.

## `POST /trips/:id/location` (driver)

```json
{ "lat": 31.62, "lng": 35.145, "accuracy_m": 12, "recorded_at": "2026-11-05T10:00:00Z" }
```

- Only the trip's own driver (`403` for anyone else, `401` signed out). `404`
  for a missing or canonical trip, and `404 live_tracking_disabled` when the
  switch is off.
- Only while the trip is `accepted`, `pickup_started`, `picked_up` or
  `in_transit`; otherwise `409 trip_not_tracking` (re-checked under a row lock).
- `400 validation_error` for a malformed body (unknown keys included).
- `422 location_outside_service_area`: outside the West Bank box (latitude
  31.33-32.56, longitude 34.88-35.60). `SERVICE_AREA` in `operatingRoutes.ts` is
  much wider (it accepts Gaza, most of Israel and parts of Jordan) because it
  only bounds admin-made cities; every operating route lies in the West Bank.
  The box is coarse by design: it refuses spoofed or broken fixes, Gaza and the
  coast, but cannot follow the Green Line.
- `422 location_accuracy_too_low`: `accuracy_m` above 150.
- `422 location_timestamp_out_of_range`: `recorded_at` more than 60 s ahead of
  the server or more than 120 s old. A time ahead of the server is stored as
  the server's now.
- At most one stored point per trip every 10 s (by fix time). Extra posts get
  `200 { "stored": false, "reason": "rate_limited", "retry_after_seconds": n }`;
  stored ones `201 { "stored": true, "location": { id, sequence, recorded_at } }`.
- A stored point runs the "driver approaching" check
  (`docs/api/notifications.md`). Points are not audited one by one.

## `GET /trips/:id/location` (everyone on the trip)

Same visibility as `GET /trips/:id`.

```json
{
  "location": {
    "id": "…", "trip_id": "…", "lat": "31.620000", "lng": "35.145000",
    "source": "driver_gps", "sequence": 3, "recorded_at": "…",
    "age_seconds": 30, "stale": false
  },
  "stale_after_seconds": 120
}
```

- `location` is `null` when nothing was recorded, and for the passenger and
  merchant once the trip is `delivered`, `completed`, `cancelled` or `failed`.
- `stale` is true when the point is older than 120 s by the server clock; the
  app then shows "last seen" instead of a live position.
- Outside demo builds only `driver_gps` rows count; demo builds also return the
  simulator's points (`POST /trips/:id/simulate/step`, demo only).

## App behaviour

- Driver: while a trip is `accepted` to `in_transit` and its screen is open
  with the app in the foreground, the phone sends a fix about every 15 s. It
  asks for location permission with an explanation first, shows a note when
  permission or the location service is off, and stops on completion,
  cancellation, leaving the screen or the app going to the background. There
  is no background service.
- Passenger: the Maps tab shows the active trip (route or legacy) with the
  driver's marker, the road to the destination and its ETA when a fresh point
  exists.
- Merchant: tracking progress follows the trip status steps.
