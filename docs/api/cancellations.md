# Cancellations

One flow for every cancellation of a legacy (route-based) ride request, merchant order, passenger parcel or trip:
`apps/api/src/services/cancellations.ts`. Each cancellation is a row in `cancellations` (migration
`20261112120000_cancellations`), frees capacity exactly once and notifies everyone affected (type `cancelled`,
see `notifications.md`).

## Rules

| Who | When | What happens |
| --- | --- | --- |
| Passenger | Any time before pickup, also after a driver accepted | The request is cancelled; if a trip exists it is cancelled, the seats are freed, the driver's route reopens and the driver is told. |
| Merchant or parcel sender | Any time before pickup, also after a driver accepted | Alone on its trip: the trip is cancelled. In a batch with other orders: only this order leaves (its parcels are cancelled, their capacity freed, the batch and trip are led by the remaining order) and the trip carries on. A pending driver offer is withdrawn. A cancelled passenger parcel's receiver details are erased. |
| Driver | An accepted trip before pickup (`accepted`, `pickup_started`) | Only the trip is cancelled; it counts as a driver cancellation for the trust score (`docs/driver-trust-score.md`). Each request or order goes back to waiting while it is still inside its window, otherwise it is cancelled automatically (`no_driver_in_time`). At most `DRIVER_CANCELLATIONS_PER_DAY` (default 3) per 24 hours, then `429 driver_cancellation_limit_reached`. |
| Admin | Any unfinished request, order or trip (also under way) | The request, order or trip is cancelled. Cancelling a trip cancels everything on it. |
| System | A request, order or parcel with no accepted driver, `ORDER_AUTO_CANCEL_MINUTES` (default 45, 10-240) after its reference time | Cancelled with reason `no_driver_in_time` and `automatic = true`. The reference time is the booked time when it is later than the creation time (`preferred_time`, `requested_departure_from`), otherwise the creation time. This replaces the 72-hour order age and the older ride expiry. |

A ride request stays acceptable and matchable until the automatic cancellation: a driver can still accept it up to
`ORDER_AUTO_CANCEL_MINUTES` after its booked time.

## Reasons

Fixed lists, in `apps/api/src/services/cancellationReasons.ts`, with an optional note (300 characters):

- rider: `changed_plans`, `found_other_transport`, `driver_too_far`, `wrong_details`, `other`
- sender (merchant, parcel): `changed_plans`, `wrong_details`, `found_other_delivery`, `driver_too_far`, `other`
- driver: `vehicle_problem`, `emergency`, `cannot_reach_pickup`, `route_changed`, `other`
- admin: `customer_request`, `driver_unavailable`, `safety_concern`, `duplicate`, `policy_violation`, `other`
- system: `no_driver_in_time`

## Endpoints

| Endpoint | Body | Notes |
| --- | --- | --- |
| `PATCH /passenger/requests/:id/cancel` | `{ reason, note? }` (rider list) | Owner only. |
| `PATCH /merchant/orders/:id/cancel` | `{ reason, note? }` (sender list) | Owner only; returns `batch_orders_remaining`. |
| `PATCH /passenger/parcels/:id/cancel` | `{ reason, note? }` (sender list) | Owner only. |
| `POST /trips/:id/cancel` | `{ reason, note? }` (driver list) | The trip's driver. Returns `{ trip, returned_to_waiting }`. |
| `POST /admin/requests/:id/cancel`, `/admin/orders/:id/cancel`, `/admin/trips/:id/cancel` | `{ reason, note? }` (admin list) | Admin only. |
| `GET /admin/cancellations` | query `from`, `to`, `kind` (`automatic`, `manual`), `role`, `reason`, `cursor`, `limit` | Newest first; each row has who cancelled, the order and its owner, the reason, the note, and `outcome` (`cancelled`, or `requeued` when only the trip was cancelled). |

`POST /trips/:id/status` with `cancelled` still ends a trip that is already under way; before pickup a driver gets
`409 cancellation_reason_required` there.

Cancelled requests, orders, parcels and trips carry `cancellation: { reason, by, automatic, at }` (the note stays with
Admin), shown by the apps beside the cancelled item.
