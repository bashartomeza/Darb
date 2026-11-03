# Route fares (display only)

Darb does not process payments. A route fare is an **estimate** that a
passenger or merchant pays **directly to the driver**. Nothing in the app
charges, holds, splits or refunds money, and every surface that shows a fare
says so (English and Arabic).

## Model

| Table / column | Purpose |
|---|---|
| `route_fares` | Append-only tariff history per canonical route (`service_routes.id`) and item: the default (`amount_minor`) and the driver range (`min_minor`, `max_minor`) |
| `driver_routes.*_price_minor` | The prices a driver chose when going online (`seat_price_minor`, `parcel_s/m/l_price_minor`); `NULL` = the route default |
| `passenger_requests.fare_*` | Seat fare frozen when a passenger request is created on a route |
| `parcels.fare_*` | Parcel fare frozen when a merchant order or passenger parcel is created on a route |

- Fares belong to the **route**, not to a route version, so publishing a new
  version keeps the tariff. Versioning follows the route catalog idea
  (`service_route_versions`): history rows are never edited, a new row
  supersedes the previous one from its `effective_from`.
- Items: `passenger_seat` (price of one seat), `parcel_s`, `parcel_m`,
  `parcel_l`.
- Amounts are **integer minor units** (agorot), currency `ILS`. Valid range is
  `1` to `10 000 000` (100 000.00 ILS). `amount_minor = null` withdraws the
  fare for that item. The database also carries a CHECK constraint.
- `min_minor` / `max_minor` are the range a driver may charge within. Both
  `NULL` (the default is fixed) or both set with
  `min_minor <= amount_minor <= max_minor` (CHECK constraint). A range change
  is a new history row with its own reason and author, like a price change.
- The fare in force at time `T` for an item is the row with the greatest
  `effective_from <= T` (ties: newest `created_at`, then `id`). A withdrawal
  row hides every older fare for that item.
- Every order is created on one of the operating routes
  (`docs/routes/route-based-orders.md`), so it is priced from that route's
  tariff. Rows created before fares were snapshotted keep `NULL`.

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

The route-based creation paths snapshot the same way, inside their creation
transaction, using the route the order is created on (older builds that send
coordinates ride Hebron → Bethlehem and are priced from it):

- `POST /passenger/requests`: seat fare × `passenger_count`.
- `POST /merchant/orders` and the bulk upload: each parcel's size fare.
- `POST /passenger/parcels` (route body): the parcel's size fare.

These paths do not take the route row lock: a booking racing a tariff edit
freezes whichever fare was committed when it read the tariff. A route with no
fare still accepts orders; the columns stay `NULL` and `fare` is `null`.

A passenger request booked with one driver's offer (`selected_driver_route_id`)
is saved at that driver's seat price.

### Driver prices and the authoritative snapshot

A driver may set their own seat and parcel prices when going online
(`PUT /driver/online-state` or `POST /driver/routes`, optional body field
`prices: { passenger_seat?, parcel_s?, parcel_m?, parcel_l? }`, integer
agorot). Each is checked against the range in force at that moment:
outside the range is `422 driver_price_out_of_range`; a price for an item
whose default is fixed (no range) or not published is `422 driver_price_fixed`
(sending exactly the fixed default is accepted). Nothing is created when a
price is refused. An item left out charges the route default. The prices are
stored on the driver route and returned as `route.prices`
(`{ currency, passenger_seat_minor, parcel_minor: { S, M, L } }`, `null` items
= default). While a route is running its prices do not change; a different set
is `409 route_already_active`.

The order's saved fare follows the driver:

1. **Offer** (`POST /matches/run`, inside the transaction that creates the
   match): the request's and the parcels' `fare_*` columns are set to the
   offered driver's price.
2. **Acceptance** (`POST /matches/:id/accept`, inside the transaction that
   creates the trip): set again, and this is the **authoritative** snapshot:
   the saved fare is the price of the driver who takes the order.

"The driver's price" is their own price for the item, else the route default
in force at that moment. `fare_id` keeps pointing at the `route_fares` row in
force (whose default or range applied). A request or parcel on another route,
or one with no price available, keeps what it has. Every change writes an
`audit_events` row (action `match_decision`, entity `PassengerRequest` or
`MerchantOrder`, metadata `{ event: "fare_set_to_driver_price", stage:
"offered" | "accepted", match_id, driver_route_id, changes: [{ source:
"driver" | "route_default", before, after }] }`), so the price history of an
order is reconstructable. If an offer is rejected or expires, the request keeps
the last offered driver's price until the next offer or acceptance sets it.

## Admin API

Admin role only (`requireRole("admin")`). Not gated by
`ROUTE_MANAGEMENT_ENABLED`: the Operating routes page sets prices in
production. `GET /admin/operating-routes` also returns each route's current
`fares` (same shape as the public catalog below).

`GET /api/v1/admin/service-routes/:id/fares`

```json
{
  "route_id": "...", "currency": "ILS", "display_only": true,
  "current": { "passenger_seat": { "fare_id": "...", "amount_minor": 1500,
                "min_minor": 1200, "max_minor": 2000,
                "currency": "ILS", "effective_from": "..." },
               "parcel_s": null, "parcel_m": null, "parcel_l": null },
  "history": [ { "id": "...", "item": "passenger_seat", "amount_minor": 1500,
                 "min_minor": 1200, "max_minor": 2000, "currency": "ILS", "effective_from": "...", "reason": "...",
                 "created_at": "...", "created_by": { "id": "...", "name": "..." } } ],
  "server_now": "..."
}
```

`PUT /api/v1/admin/service-routes/:id/fares`

```json
{ "changes": [ { "item": "passenger_seat", "amount_minor": 1500,
                 "min_minor": 1200, "max_minor": 2000 },
               { "item": "parcel_l", "amount_minor": null } ],
  "effective_from": "2026-11-01T00:00:00Z",
  "reason": "Fuel price adjustment" }
```

- `changes` (1 to 4 distinct items) and `reason` (3 to 500 characters) are
  required. Unknown fields, non-integer or out-of-range amounts are `400`.
- `min_minor` / `max_minor` are optional and go together (omitted or `null`:
  the default is fixed). A range that does not hold the default, or a range on
  a withdrawn fare, is `400 invalid_fare_range`.
- `effective_from` is optional (default: now). It may not be more than five
  minutes in the past (`fare_effective_from_in_past`) nor more than 366 days
  ahead (`fare_effective_from_too_far`). Scheduled fares show up in history
  but are not "current" until their time.
- Items whose amount and range already equal the fare in force at that date
  are skipped; if nothing changes the call is `409 fare_unchanged`.
- Each save writes `route_fares` rows (with the acting admin) and one
  `audit_events` row, action `admin_action`, metadata
  `{ event: "route_fares_changed", effective_from, reason, changes[], request_id }`.

## Where fares are exposed

All objects below are display-only estimates.

- **Operating routes** `GET /operating-routes` (public) and the **route
  catalog** `GET /routes`, `GET /routes/:id`: `fares` on each route:
  `{ currency, estimated: true, paid_directly_to_driver: true,
  passenger_seat_minor, parcel_minor: { S, M, L }, driver_price_range:
  { passenger_seat, parcel: { S, M, L } } }` (each range
  `{ min_minor, max_minor }` or `null`) or `null`.
- **Match search** `POST /matches/search`: each result's `fare`
  (`{ currency, unit_minor, total_minor, ... }`) is that driver's seat price
  for the party.
- **Matches** `GET /matches[/:id]`: `passenger_request.fare`,
  `merchant_order.fare` and `parcels[].fare_minor` are the saved fare (the
  offered or accepting driver's price); `driver_route.prices` are the
  driver's own prices.
- **Available departures** `GET /passenger/available-departures`:
  `route.fares` (same shape), so a passenger sees the price before booking.
- **Create/read passenger request** (`/passenger/route-requests`): `fare`:
  `{ currency, unit_minor, total_minor, estimated, paid_directly_to_driver }`
  or `null`.
- **Create/read merchant order** (`/merchant/route-orders`): `fare` (order
  total, only when every parcel was priced) and `parcels[].fare`
  (`unit_minor = total_minor` = that parcel's price) with `size`.
- **Route-based orders**: `/passenger/requests` (create, list, read) carry
  the same passenger `fare`; `/merchant/orders` (create, list, read, cancel;
  bulk-created orders are priced the same way) carry the order `fare` and `parcels[].fare`; `/passenger/parcels` (create,
  list, read, cancel) carry the parcel's `fare`.
- **Driver offers** (`/driver/canonical-match-offers[/:id]`): `demand.fare`
  (passenger total, or merchant order total) and, for merchant orders,
  `demand.parcels[]` with `size` and `fare`, visible before accepting.

Trips do not carry a second copy: a trip's fare is its passenger request's or
parcels' snapshot.

## Apps

- **Admin**: the Operating routes page has a Prices column (seat price,
  driver range, parcel prices) and a Prices dialog per route: default and
  driver minimum/maximum per item, optional effective date, mandatory reason,
  and the change history. The same panel is the "Estimated fares" tab of the
  flag-gated route workspace. Arabic and English, RTL aware.
- **Mobile, drivers**: the route picker behind the Home online switch and the
  route screen offer a price field per item that has a range (empty = the
  default, the range shown under the field, out-of-range refused before
  sending); fixed items show their price. The running route shows the prices
  it was opened with.
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
