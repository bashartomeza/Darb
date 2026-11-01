# Route-based orders

Every order in Darb names one **predefined route** ("Hebron → Bethlehem") and
adds the exact pickup and drop-off as **free text** typed by the user. There is
no map picker in the order flows. Drivers choose the route they drive, and
matching pairs only a demand and a driver route on the **same route**.

This replaces the single locked corridor (`LOCKED_CORRIDOR_KEY`) that the
passenger, merchant and driver flows used before. The canonical multi-route
stack (`/passenger/route-requests`, `/merchant/route-orders`,
`/driver/availabilities`, `MULTI_ROUTE_*`, `CANONICAL_*`) is not used and stays
behind its flags.

## Routes in the database

A route is an existing `ServiceRoute` whose current version is **published**,
with exactly two stops: the origin city and the destination city (both
passenger and parcel pickup allowed at the origin, drop-off at the
destination). A city is an existing `Stop` row (`stop_key` `city-<slug>`,
region `west-bank`) whose coordinates are the city centre.

- **Active** = route `status` active and current version `published`.
- **Turned off** = current version `paused` (existing pause/resume rules).
- Orders and driver routes store the route's current `route_version_id`;
  matching compares the **service route id** (stable across republishing).

### Predefined routes

Created by the API when missing (idempotent, keyed by `route_key`; it never
re-activates or edits a route an admin has changed). Both directions of:

| Cities | | Cities | |
|---|---|---|---|
| Hebron ↔ Bethlehem | الخليل ↔ بيت لحم | Nablus ↔ Tulkarm | نابلس ↔ طولكرم |
| Hebron ↔ Ramallah | الخليل ↔ رام الله | Nablus ↔ Qalqilya | نابلس ↔ قلقيلية |
| Bethlehem ↔ Ramallah | بيت لحم ↔ رام الله | Ramallah ↔ Jericho | رام الله ↔ أريحا |
| Ramallah ↔ Nablus | رام الله ↔ نابلس | Nablus ↔ Salfit | نابلس ↔ سلفيت |
| Nablus ↔ Jenin | نابلس ↔ جنين | Nablus ↔ Tubas | نابلس ↔ طوباس |

City centres: Hebron 31.5326, 35.0998 · Bethlehem 31.7054, 35.2024 ·
Ramallah 31.9038, 35.2034 · Nablus 32.2211, 35.2544 · Jenin 32.4637, 35.2938 ·
Tulkarm 32.3104, 35.0286 · Qalqilya 32.1896, 34.9706 · Jericho 31.8611, 35.46 ·
Salfit 32.0849, 35.1806 · Tubas 32.3209, 35.3699.

`route_key` is `<origin-slug>-to-<destination-slug>` (e.g. `hebron-to-bethlehem`).
Names put the origin first: `name_ar` "الخليل ← بيت لحم" (the arrow points
left, the reading direction in Arabic) and `name_en` "Hebron → Bethlehem".

## API contract

All bodies are JSON. `*_details` fields are trimmed strings, 3–300 characters,
required where listed. Errors use the existing `{ error, details? }` shape.

### Public / any role

`GET /api/v1/operating-routes` — **no sign-in required.** Active routes only,
ordered by origin then destination name.

```json
{ "routes": [ {
  "id": "<service_route_id>", "route_key": "hebron-to-bethlehem",
  "name_ar": "الخليل ← بيت لحم", "name_en": "Hebron → Bethlehem",
  "origin":      { "id": "<stop id>", "name_ar": "الخليل",  "name_en": "Hebron",    "latitude": 31.5326, "longitude": 35.0998 },
  "destination": { "id": "<stop id>", "name_ar": "بيت لحم", "name_en": "Bethlehem", "latitude": 31.7054, "longitude": 35.2024 }
} ] }
```

An unknown, retired or turned-off route in any write below returns
`409 route_unavailable`.

### Passenger trips

`POST /api/v1/passenger/requests` (Idempotency-Key as today)

```json
{ "service_route_id": "...", "pickup_details": "near the PPU main gate",
  "dropoff_details": "Bethlehem bus station", "preferred_time": "ISO",
  "passenger_count": 1, "selected_driver_route_id": "optional" }
```

The server fills `pickup_label`/`destination_label` with the city names
(English, like other stored labels) and the lat/lng with the city centres, and
stores `route_version_id`, `pickup_details`, `dropoff_details`. Requests stay
legacy (`canonical_entry_version` null). The old coordinate body is still
accepted for older app builds and maps to the Hebron → Bethlehem route.

Every serialized passenger request (create, list, active, detail, matches,
trips) adds: `service_route_id`, `route_name_ar`, `route_name_en`,
`pickup_details`, `dropoff_details` (null for old rows).

`POST /api/v1/matches/search` body: `{ "service_route_id", "preferred_time",
"passenger_count" }` (old coordinate body still accepted as above). Results:
driver routes on the same route only. `POST /matches/run` is unchanged.

### Passenger parcels

`POST /api/v1/passenger/parcels` — available whenever the API is up (no
`MULTI_ROUTE_ENTRY_ENABLED` needed):

```json
{ "service_route_id": "...", "pickup_details": "...", "dropoff_details": "...",
  "preferred_time": "ISO", "size": "S" | "M",
  "receiver_name": "...", "receiver_phone": "+9705...",
  "forbidden_items_acknowledged": true, "note": "optional ≤200" }
```

`GET /passenger/parcels` and cancel work as today; each parcel adds
`service_route_id`, `route_name_ar`, `route_name_en`, `pickup_details`,
`dropoff_details`.

### Merchant orders

`POST /api/v1/merchant/orders`

```json
{ "service_route_id": "...", "pickup_details": "store, Ein Sarah street",
  "parcels": [ { "dropoff_details": "...", "size": "small|medium|large",
                 "priority": "...", "receiver_name": "optional", "receiver_phone": "optional" } ] }
```

(`size`/`priority` values as today.) Labels/coordinates are filled from the
route's cities as for passengers. Orders and parcels add `service_route_id`,
`route_name_ar`, `route_name_en`, `pickup_details` (order) and
`dropoff_details` (parcel). Bulk CSV: columns `route_key, pickup_details,
dropoff_details, size, priority[, receiver_name, receiver_phone]`; one order
per (route_key, pickup_details) group.

### Drivers

`POST /api/v1/driver/routes` body adds required `service_route_id` (seats and
parcel capacity as today). `PUT /api/v1/driver/online-state` going online
takes `service_route_id` (required when no active driver route exists).
Driver routes serialize `service_route_id`, `route_name_ar`, `route_name_en`.

### Matching

Passenger and merchant matching (and batching) consider only driver routes
whose route version belongs to the **same service route** as the demand. The
old hard-coded checks (Bethlehem-only destination, corridor labels) are
removed. Old rows on `LOCKED_CORRIDOR_KEY` still match each other.

### Admin

All behind admin auth, independent of `ROUTE_MANAGEMENT_ENABLED`:

- `GET /api/v1/admin/operating-routes` → `{ routes: [ <route as above> + "active": bool, "orders_count": n ] }` (active and turned off).
- `POST /api/v1/admin/operating-routes` `{ origin_city_id, destination_city_id, both_directions: bool }` → creates and publishes the route(s); `409 route_exists` if that direction exists.
- `PATCH /api/v1/admin/operating-routes/:id` `{ active: bool }` → pause/resume the current version.
- `GET /api/v1/admin/cities` → `{ cities: [ {id, name_ar, name_en, latitude, longitude} ] }`.
- `POST /api/v1/admin/cities` `{ name_ar, name_en, latitude, longitude }` (inside the service area: lat 29.4–33.4, lng 34.2–35.95) → the new city.

## As implemented (API)

Details the contract left open, as the API answers them:

- Validation errors use the existing `400 { error: "validation_error", details }`
  shape (details too short/long, missing `service_route_id`, unknown fields on
  strict bodies). `*_details` reject control characters (a newline is allowed).
- Storage: requests, orders, parcels and driver routes keep the route's
  current `route_version_id`; matches never carry one (legacy matches stay
  route-less, as the database requires).
- `POST /admin/operating-routes` → `201 { routes: [ <admin route> ] }` (the
  created direction(s)). `both_directions` defaults to `false`; with it, an
  existing way back is kept and only the missing direction is created. Unknown
  or non-city stops → `404 city_not_found`; the same city twice → `400
  identical_route_endpoints`.
- `PATCH /admin/operating-routes/:id` → `{ route: <admin route> }`; idempotent;
  a retired route or one without a published/paused version → `409
  route_unavailable`; unknown id → `404 route_not_found`.
- `POST /admin/cities` → `201 { city: {...} }`; outside the service area →
  `400 city_outside_service_area`; a city with that English name → `409
  city_exists`. The stop key is `city-<slug of name_en>`.
- `PUT /driver/online-state` going online with no active driver route and no
  `service_route_id` → `400 service_route_id_required`; already online on a
  different route → `409 route_already_active`.
- `POST /passenger/parcels` (route body) → `201 { parcel, replayed,
  handover_code, request_id }` (`handover_code` once, `null` on replays). The
  API then asks for a driver on the route; with none yet the parcel stays
  `searching` and `POST /matches/run { merchantOrderId }` (allowed for the
  sending passenger) asks again. Parcels also serialize `trip_id`. A route
  parcel can be cancelled until a driver accepts it (a pending offer is
  withdrawn).
- Merchant parcels accept `size` `S|M|L` or `small|medium|large`; they
  serialize `receiver_name` and `receiver_phone_masked`.
