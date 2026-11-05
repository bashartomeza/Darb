# In-app notifications

A per-user inbox. Clients poll `GET /api/v1/notifications` (the mobile app every 10 s while a bell or the inbox is on screen). Each entry can also be sent as a push notification once push is switched on (off by default; see [push setup](../notifications/push-setup.md)).

## Endpoints (any authenticated role; always scoped to the caller)

| Method / path | Purpose |
| --- | --- |
| `GET /notifications?limit=1..100&unread_only=true` | Newest first, plus `unread_count` for the badge. |
| `POST /notifications/:id/read` | Mark one read. Another user's id returns `404`. |
| `POST /notifications/read-all` | Mark every unread entry read. |

Entries carry `type` and `params`, never display text; each client words them in its own locale.

## Push endpoints (any authenticated role; always scoped to the caller)

| Method / path | Purpose |
| --- | --- |
| `PUT /push/devices` `{token, platform: android\|ios\|web, locale?, app_version?}` | Register or refresh this phone's token for the caller's session. Idempotent; a token held by another account moves to the caller. |
| `POST /push/devices/unregister` `{token}` | Stop pushes to the caller's own token. Same answer for unknown or foreign tokens. |
| `GET /push/preferences` | `{push_enabled, push_available}`; `push_enabled` defaults to `true`. |
| `PUT /push/preferences` `{push_enabled}` | Turn push on or off for the account. |

Tokens are write-only: no endpoint returns them. An account keeps at most 10 live tokens; registering another retires the least recently seen. Session revocation (logout, logout-all, password change, refresh-token reuse, admin action) revokes the session's tokens; Firebase-reported dead tokens are revoked by the sender.

## Events

| `type` | Recipient | Emitted when |
| --- | --- | --- |
| `match_offered` | Driver | A legacy match is created for their route. |
| `match_accepted` / `match_rejected` | Passenger or Merchant behind the match | The driver accepts or rejects. |
| `trip_status` (`params.status`) | Passenger and/or Merchant on the trip | The trip advances (driver or Admin). |
| `driver_verification_approved` / `_rejected` (`params.reason`) | The driver | An Admin decides their verification. |
| `driver_documents_expiring` (`params.kind`, `expires_on`, `days_left`, `threshold`) | The driver | A recorded document expires in 30 days, and again in 7 days (once per document, date and tier). |
| `driver_documents_expired` (`params.kinds`) | The driver | The expiry job restricted the account. |
| `driver_documents_renewal_submitted` | The driver | They sent renewed documents to Admin re-review. |
| `incident_updated` (`params.status`) | The reporter | An Admin moves their incident report forward. |
| `driver_approaching` (`params.reason`: `radius`, `eta` or `pickup_started`) | Passenger on the trip | The matched driver comes within the configured radius or ETA of the pickup, or starts the pickup of a route request (see below). |

## Guarantees

- Emission is best-effort and never fails or rolls back the business action.
- `UNIQUE(user_id, dedupe_key)` makes every event announce at most once per recipient.
- Canonical (multi-route) matching does not emit notifications yet.

## "Driver is approaching" alert

`services/driverApproaching.ts` is evaluated whenever a driver position is recorded (the driver's phone through `POST /trips/:id/location`, or the demo simulator `POST /trips/:id/simulate/step`) and after a legacy trip status update (using the latest recorded position, if any).

- Which pickup: only a request whose pickup coordinate the passenger chose is measured. A route request stores its origin city's centre as the coordinate and the real pickup as typed text (`pickup_details`); measuring against the centre would announce the driver while they cross the city, nowhere near the passenger. Such a request fires instead when the driver marks `pickup_started` (`params.reason = "pickup_started"`), the driver's own "on my way to you", and positions are ignored for it.
- Trigger (real pickup coordinate): great-circle distance driver to pickup is at most `APPROACH_ALERT_RADIUS_KM` (default `1`, boundary inclusive), or the estimated time (`distance / APPROACH_ALERT_ASSUMED_SPEED_KMH * 60`) is at most `APPROACH_ALERT_ETA_MINUTES` (default `0` = ETA trigger off; assumed speed default `30` km/h).
- One notification per trip: dedupe key `driver_approaching:<tripId>`; later positions never repeat it.
- State guard: only trips in `created`, `accepted` or `pickup_started` with a passenger request. Picked-up, in-transit, delivered, completed, cancelled and failed trips never fire. Parcel/merchant trips are not covered.
- Privacy: `params` holds only `reason`; no coordinates or distance reach the passenger.
- Positions: real driver GPS when `LIVE_TRACKING_ENABLED` is on (see `docs/api/live-location.md`), simulated points in demo builds.
- Localised text lives in the mobile ARB files (`notifDriverApproachingTitle/Body`, EN and AR).
