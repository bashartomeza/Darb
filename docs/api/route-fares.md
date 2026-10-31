# Route fares (display only)

Masari does not process payments. A route fare is an **estimate** that a
passenger or merchant pays **directly to the driver**. Nothing in the app
charges, holds, splits or refunds money, and every surface that shows a fare
says so (English and Arabic).

## Model

| Table / column | Purpose |
|---|---|
| `route_fares` | Append-only tariff history per canonical route (`service_routes.id`) and item |
| `passenger_requests.fare_*` | Seat fare frozen when a canonical passenger request is created |
| `parcels.fare_*` | Parcel fare frozen when a canonical merchant order is created |

- Fares belong to the **route**, not to a route version, so publishing a new
  version keeps the tariff. Versioning follows the route catalog idea
  (`service_route_versions`): history rows are never edited, a new row
  supersedes the previous one from its `effective_from`.
- Items: `passenger_seat` (price of one seat), `parcel_s`, `parcel_m`,
  `parcel_l`.
- Amounts are **integer minor units** (agorot), currency `ILS`. Valid range is
  `1` to `10 000 000` (100 000.00 ILS). `amount_minor = null` withdraws the
  fare for that item. The database also carries a CHECK constraint.
- The fare in force at time `T` for an item is the row with the greatest
  `effective_from <= T` (ties: newest `created_at`, then `id`). A withdrawal
  row hides every older fare for that item.
- Legacy (non-canonical) requests and parcels have no route, so they carry no
  fare. Rows created before this feature keep `NULL`.

### Rounding

There is none to do. Money is an integer end to end: the seat total is
`unit * passenger_count` (integer multiplication), the admin UI rejects input
with more than two decimals instead of rounding it, and floats only appear
when a client formats the number for display.

## Snapshotting

When `POST /passenger/route-requests` or `POST /merchant/route-orders` creates
a record, the fare in force *at that moment* (computed inside the same
transaction, after the route row is locked `FOR UPDATE`) is copied onto the
row: `fare_id` (the `route_fares` row used), `fare_unit_minor`,
`fare_total_minor`, `fare_currency` for requests, and `fare_id`, `fare_minor`,
`fare_currency` per parcel. Later tariff edits never change these columns.
Idempotent replays return the stored row, they never re-read the tariff. If no
tariff exists the columns are `NULL` and the response `fare` is `null`.

`PUT .../fares` takes the same route lock, so a fare change and a booking are
strictly ordered.

## Admin API

Admin role only (`requireRole("admin")`), and only when
`ROUTE_MANAGEMENT_ENABLED` is on (otherwise 404, like the other route admin
endpoints).

`GET /api/v1/admin/service-routes/:id/fares`

```json
{
  "route_id": "...", "currency": "ILS", "display_only": true,
  "current": { "passenger_seat": { "fare_id": "...", "amount_minor": 1500,
                "currency": "ILS", "effective_from": "..." },
               "parcel_s": null, "parcel_m": null, "parcel_l": null },
  "history": [ { "id": "...", "item": "passenger_seat", "amount_minor": 1500,
                 "currency": "ILS", "effective_from": "...", "reason": "...",
                 "created_at": "...", "created_by": { "id": "...", "name": "..." } } ],
  "server_now": "..."
}
```

`PUT /api/v1/admin/service-routes/:id/fares`

```json
{ "changes": [ { "item": "passenger_seat", "amount_minor": 1500 },
               { "item": "parcel_l", "amount_minor": null } ],
  "effective_from": "2026-11-01T00:00:00Z",
  "reason": "Fuel price adjustment" }
```

- `changes` (1 to 4 distinct items) and `reason` (3 to 500 characters) are
  required. Unknown fields, non-integer or out-of-range amounts are `400`.
- `effective_from` is optional (default: now). It may not be more than five
  minutes in the past (`fare_effective_from_in_past`) nor more than 366 days
  ahead (`fare_effective_from_too_far`). Scheduled fares show up in history
  but are not "current" until their time.
- Items whose amount already equals the fare in force at that date are
  skipped; if nothing changes the call is `409 fare_unchanged`.
- Each save writes `route_fares` rows (with the acting admin) and one
  `audit_events` row, action `admin_action`, metadata
  `{ event: "route_fares_changed", effective_from, reason, changes[], request_id }`.

## Where fares are exposed

All objects below are display-only estimates.

- **Route catalog** `GET /routes`, `GET /routes/:id`: `fares` on each route:
  `{ currency, estimated: true, paid_directly_to_driver: true,
  passenger_seat_minor, parcel_minor: { S, M, L } }` or `null`.
- **Available departures** `GET /passenger/available-departures`:
  `route.fares` (same shape), so a passenger sees the price before booking.
- **Create/read passenger request** (`/passenger/route-requests`): `fare`:
  `{ currency, unit_minor, total_minor, estimated, paid_directly_to_driver }`
  or `null`.
- **Create/read merchant order** (`/merchant/route-orders`): `fare` (order
  total, only when every parcel was priced) and `parcels[].fare`
  (`unit_minor = total_minor` = that parcel's price) with `size`.
- **Driver offers** (`/driver/canonical-match-offers[/:id]`): `demand.fare`
  (passenger total, or merchant order total) and, for merchant orders,
  `demand.parcels[]` with `size` and `fare`, visible before accepting.

Trips do not carry a second copy: a trip's fare is its passenger request's or
parcels' snapshot.

## Apps

- **Admin**: route workspace has an "Estimated fares" tab (current fares,
  edit form with optional effective date and mandatory reason, change
  history). Arabic and English, RTL aware.
- **Mobile** (`lib/core/fares`, `lib/core/widgets/fare_estimate.dart`):
  the passenger request and merchant order screens show an estimate before
  submit and the frozen fare after; the passenger home trip card shows the seat
  fare; the driver offer detail and the passenger/merchant assignment detail
  show the snapshot. The Arabic locale uses the app's Latin digits with the
  shekel sign after the amount (`12.50 ₪`), English uses `₪12.50`. Every fare
  box carries the "estimated, paid directly to the driver, no payments are
  processed in the app" text.

## Out of scope

Payments, invoicing, discounts, surge/dynamic pricing, per-stop-pair fares and
non-ILS currencies. Per-stop-pair pricing can be added later as extra
`item` granularity without changing the snapshot columns.
