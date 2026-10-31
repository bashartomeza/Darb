# Delivery confirmation by the receiver

A parcel delivery is not complete until the receiver has confirmed it. The
confirmation lives in its own small service, `apps/api/src/services/deliveryHandover.ts`,
and works for any parcel order (`merchant_orders` row) whoever created it: the
order owner is `merchant_orders.merchant_id`, which also holds a passenger
sender's user id.

## How it works

1. **Code issued.** When a parcel order is created, the API generates a six-digit
   numeric handover code and returns it once, in `order.handover.code` of the
   create response (the order owner only). Only a keyed digest
   (`HMAC-SHA256`, context `masari:delivery-handover:<orderId>`, key
   `AUTH_ACTION_TOKEN_PEPPER`, falling back to the refresh-token pepper) is
   stored in `delivery_handovers.code_digest`.
2. **Sender passes the code on.** The sender shows or reads the code to the
   receiver. The app keeps it in memory for the session; after that the server
   cannot show it again, so the sender uses **Get a new code** (see below).
3. **Driver confirms.** At the drop-off the driver asks the receiver for the
   code and sends it with `POST /api/v1/trips/:id/delivery-confirmation`. The
   trip moves to `delivered` only once every parcel order on it is confirmed
   (a batch trip carries one code per order).
4. **Fallback.** If the receiver cannot give the code the driver sends
   `method: "receiver_unavailable"` with a reason of 10 to 300 characters. The
   delivery completes, the reason is stored on the handover, an audit event is
   written and the trip is flagged in the admin view.

## Rules

- Wrong guesses are capped at **5** per code. The counter is spent atomically
  before the comparison and survives a rolled-back transaction; the sixth try
  returns `429 handover_locked` even with the right code.
- A code expires **14 days** after it was issued (`409 handover_expired`).
  Re-issuing restarts the clock and clears the counter.
- A code is invalid once the order is cancelled, failed or expired (the sender
  cannot re-issue for a closed order: `409 order_not_active`).
- The plain `POST /trips/:id/status` route can no longer set `delivered` on a
  parcel trip without confirmation (`409 delivery_confirmation_required`).
  Admins moving a trip forward are the one exception: each unconfirmed order is
  closed as `admin_override` and audited.
- Orders created before this feature have no handover row. The sender can issue
  one from the app; otherwise the driver uses `receiver_unavailable`.
- The digest and the code are never returned by any read endpoint.

## Endpoints

| Method and path | Who | Purpose |
| --- | --- | --- |
| `GET /parcel-orders/:id/handover` | order owner, admin | State only: `issued`, `confirmed`, `locked`, `expired`, `attempts_remaining`, `expires_at`, `confirmation_method`, `unavailable_reason`. |
| `POST /parcel-orders/:id/handover/regenerate` | order owner | Issues a code, or replaces the current one (unlocks a locked order). Returns `handover.code` once. |
| `POST /merchant/orders` | merchant | Unchanged request; the response order gains `handover` (with `code` on first creation only). |
| `GET /trips/:id` | trip parties | Adds `delivery_confirmation: { required, all_confirmed, orders[] }`. |
| `POST /trips/:id/delivery-confirmation` | assigned driver, trip `in_transit` | See below. |
| `GET /admin/trips`, `GET /admin/trips/:id` | admin | Each trip gains `delivery_confirmation` (`methods`, `flagged`, `reasons`, counts). |

### `POST /trips/:id/delivery-confirmation`

```json
{ "method": "receiver_code", "code": "123456" }
{ "method": "receiver_code", "codes": [{ "order_id": "...", "code": "123456" }] }
{ "method": "receiver_unavailable", "reason": "Nobody answered the door or phone", "order_ids": ["..."] }
```

`code` is shorthand for a trip with a single order; `order_ids` is optional and
defaults to every unconfirmed order. The response is
`{ trip, delivered, delivery_confirmation }`; `delivered` is false while some
orders on a batch trip are still unconfirmed.

Errors: `422 invalid_handover_code`, `429 handover_locked`,
`409 handover_expired`, `409 handover_not_issued`,
`409 invalid_trip_status_transition` (trip not in transit),
`404 order_not_on_trip`, `400` for a short reason.

## Audit and admin visibility

Each confirmation writes a `trip_status_updated` audit event with
`metadata.event = "delivery_confirmed"`, the `method` and the `order_id`;
fallbacks add `reason` and `flagged: true`. The admin trips list shows a
delivery column (receiver code, receiver unavailable, admin override, or
pending) and the detail panel lists the driver's reasons.

## Data

Table `delivery_handovers` (migration `20261029120000_delivery_handover_confirmation`):
one row per order with `code_digest`, `key_version`, `failed_attempts`,
`expires_at`, `confirmed_at`, `confirmation_method`
(`receiver_code`, `receiver_unavailable`, `admin_override`), `confirmed_by_id`,
`confirmed_trip_id` and `unavailable_reason`. Confirming clears the digest.

## Mobile

The shared feature lives in `apps/mobile/lib/features/delivery_handover/`:
`HandoverCodeCard(orderId)` is the sender's card (merchant order detail and
merchant trip screens use it, and a passenger parcel screen can drop it in
unchanged), and the driver's trip screen opens the receiver dialog instead of
marking a parcel trip delivered directly. Copy is English and Arabic in
`delivery_handover_strings.dart`.
