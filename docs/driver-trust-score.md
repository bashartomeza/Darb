# Driver trust score

The trust score is a whole number from 0 to 100 stored on `DriverProfile.trust_score`, with the per-component breakdown in `trust_components` and the time of the last calculation in `trust_computed_at`. It is computed by the pure function `computeTrustScore` in `apps/api/src/services/trustScore.ts`; `apps/api/src/services/driverTrust.ts` gathers the inputs and stores the result.

## Formula

Five components, each a value between 0 and 1, combined by weight:

| Component | Weight | Measures |
| --- | --- | --- |
| Experience | 10 | Completed trips, from 0.70 at none up to 1.00 at 50 completed trips |
| Cancellations | 25 | Completed trips against trips the driver cancelled or that failed |
| Departure punctuality | 20 | Share of trips that started no later than 10 minutes after the route's scheduled departure |
| Arrival punctuality | 15 | Share of completed trips finished no later than 10 minutes after the end of the driver's availability window |
| Passenger ratings | 30 | Average of 1-5 star ratings, mapped to 0..1 |

`score = round(100 * sum(weight * value) / 100)`.

### New drivers start neutral (damping)

Every rate is damped toward a prior of 0.70 that counts as 5 observations:

```
value = (successes + 0.70 * 5) / (observations + 5)
```

A driver with no history therefore scores exactly 70 (the same as the default on the profile), and a handful of trips can only move the score a little. A record of 50 clean trips moves it much further. The experience component is already a ramp from the prior and is not damped again.

### What counts as what

- A trip is a driver cancellation only when `trips.cancelled_by_user_id` is the driver's own user. Passenger and admin cancellations are not held against the driver.
- Failed trips (a trip that could not be finished) count as non-completions alongside driver cancellations.
- Departure punctuality uses `trips.started_at` against `driver_routes.departure_at`. Trips without a scheduled departure are not measured.
- Arrival punctuality uses `trips.completed_at` against `driver_routes.availability_window_end`, the only arrival deadline the data model has today. Trips without it are not measured. If a real planned arrival time is added later, swap it in at one place.
- Only the 500 most recent finished trips are considered.

### Rating spam

- A passenger can rate a trip once (`trip_ratings` is unique on trip and passenger, and stars are limited to 1-5 in the database).
- Only passengers on the trip can rate it, and only after it is completed.
- Ratings are aggregated per passenger first, and any one passenger counts at most 3 times, using their average. A single account (or a friendly pair) rating repeatedly cannot lift or sink a driver.
- The rating prior (see damping) keeps a few early ratings from swinging the score.

## When it is recomputed

- Right after a trip is completed, cancelled or failed (driver status update, admin status update), and right after a rating is submitted. This is best-effort: an error is swallowed so a scoring problem never fails the trip or rating request.
- On a schedule, to repair any missed update and to keep the whole fleet consistent: `npm run trust:recompute -w @masari/api` (after `npm run build`). Like `documents:purge` it is a standalone job meant for a host scheduler; run it nightly. It is safe to run repeatedly.

## Privacy

Drivers never see individual ratings or who gave them. No driver-facing endpoint reads `trip_ratings`; the stored components contain only aggregate counts and values. The admin driver view shows the score and the components (including the number of ratings and their damped value), but not individual ratings or passenger identities.

## Passenger rating API

- `POST /api/v1/trips/:id/rating` with `{ "stars": 1-5 }` (passenger only). `201` on success, `409 trip_not_completed`, `409 trip_already_rated`, `400` for invalid stars, `404` for a trip the caller is not on.
- `GET /api/v1/trips/:id/rating` returns `{ rating: { stars } | null }` for the calling passenger, so the app knows whether to show the prompt.

The numbers (weights, prior, grace, caps) are engineering defaults in `trustScore.ts`; the product owner should confirm them.
