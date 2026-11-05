# City places: pick the village, not type it

Orders name a predefined route, then a **place** at each end. A place is a named
village or town inside one of the route's two cities. Riders, parcel senders and
merchants pick it from a list; the old free-text box is now an **optional "more
details"** field.

```
Route:        Hebron → Ramallah
Pickup:       one of Hebron's places      (origin city only)
Drop-off:     one of Ramallah's places    (destination city only)
More details: optional text, up to 300 characters
```

The reverse route (Ramallah → Hebron) lists them the other way round: every
route direction is its own route, so the lists follow it automatically.

## Data

Table `city_places` (migration `20261114120000_city_places`):

| Column | Meaning |
|---|---|
| `id` | `cp_<city>_<nn>` for seeded rows, generated for admin-added ones |
| `city_key` | The city's stop key, for example `city-hebron`. Places exist before the city row does. |
| `name_ar`, `name_en` | Display names. `(city_key, name_ar)` is unique. |
| `latitude`, `longitude` | Position used as the order's pickup / drop-off coordinate |
| `approximate` | `true` for a village-centre point from a map extract; `false` once an admin set or moved it |
| `source` | `OpenStreetMap place node/<id>`, `city centre of the route stop`, or `admin` |
| `active`, `sort_order` | Disabled places are not offered; the city centre is `sort_order` 0 |

Places are **never deleted**: orders keep the place id and the names as they
were at ordering time (`pickup_place_id`, `pickup_place_name_ar/en`,
`dropoff_place_*` on passenger requests; `pickup_place_*` on merchant orders;
`dropoff_place_*` on parcels). The existing `pickup_details` / `dropoff_details`
columns hold the optional text.

### Seed

`apps/api/data/city-places.json` is the committed source, built by
`node scripts/places/build-city-places.mjs fetch` (OpenStreetMap place nodes
inside the West Bank, via the Overpass API; © OpenStreetMap contributors, ODbL)
and turned into the migration's `INSERT` by `... sql`. A test fails if the
migration and the file differ.

Selection per city: the city centre ("وسط الخليل" / "Hebron city centre") plus
up to 24 towns and villages, ranked by kind (town first), population, a
Wikipedia article and distance. A place is assigned to the nearest of the ten
city centres within 22 km; Salfit uses its governorate's own localities because
the nearest-city rule would hand them to Ramallah and Nablus. The names come
from OpenStreetMap (`name:ar`, `name:en`), so some English spellings are
transliterations that an admin may want to tidy.

| City | Places (incl. centre) |
|---|---|
| Hebron | 25 |
| Bethlehem | 25 |
| Ramallah | 25 |
| Nablus | 25 |
| Jenin | 25 |
| Tulkarm | 25 |
| Qalqilya | 20 |
| Jericho | 5 |
| Salfit | 19 |
| Tubas | 19 |
| **Total** | **213** |

Every position is **approximate** (a village centre, not an address). Gaps and
wrong spellings are fixed in the admin app (Villages and places), no release
needed. Jericho and the Jordan Valley are thinly mapped in OpenStreetMap and
need the most admin additions.

## API

### List places for a route (public, cache-friendly)

`GET /api/v1/operating-routes/:id/places?lang=ar|en` (default `ar`)

```json
{
  "route_id": "<service_route_id>",
  "pickup_city_key": "city-hebron",
  "dropoff_city_key": "city-ramallah",
  "pickup_places":  [ { "id": "cp_hebron_00", "name": "وسط الخليل", "name_ar": "وسط الخليل", "name_en": "Hebron city centre", "latitude": 31.5326, "longitude": 35.0998, "approximate": true } ],
  "dropoff_places": [ ... ]
}
```

Active places only; the centre first, then by `sort_order` and name in the
requested language. No sign-in. `Cache-Control: public, max-age=300` and a
weak ETag, so apps can cache it and revalidate. An unknown, retired or
turned-off route is `409 route_unavailable`.

### Creating orders

Passenger requests (`POST /passenger/requests`), passenger parcels
(`POST /passenger/parcels`) and merchant orders (`POST /merchant/orders`) take:

| Field | Where | Notes |
|---|---|---|
| `pickup_place_id` | request / parcel / order | A place of the route's **origin** city |
| `dropoff_place_id` | request / parcel / each merchant parcel | A place of the route's **destination** city |
| `pickup_details`, `dropoff_details` | same | Optional text, trimmed, up to 300 characters; empty means none |

The server checks each id and answers `400` with:

| `error` | When |
|---|---|
| `pickup_place_wrong_city` / `dropoff_place_wrong_city` | The place belongs to another city than that end of the route (including a swapped pair on the reverse route) |
| `pickup_place_unavailable` / `dropoff_place_unavailable` | Unknown or disabled place |
| `pickup_place_required` / `dropoff_place_required` | No place sent while `ROUTE_PLACES_REQUIRED` is on |
| `pickup_details_required` / `dropoff_details_required` | Older-build free text shorter than 3 characters (see below) |

With a place, the order's pickup / drop-off coordinate is the place's position
(it used to be the city centre), the label stays the English city name, and
the response adds `pickup_place_id`, `pickup_place_name_ar`,
`pickup_place_name_en`, `dropoff_place_id`, `dropoff_place_name_ar`,
`dropoff_place_name_en` next to the existing `pickup_details` /
`dropoff_details` (null for old rows). The same fields appear wherever the
driver, rider or admin read an order (matches, trips, admin trips and requests,
passenger parcels).

### Backward compatibility (decision)

Older app builds send free text only (`pickup_details` and `dropoff_details`,
3 to 300 characters, no place ids). The API **keeps accepting them**, storing
the text with no place and the city-centre coordinate exactly as before, so
nobody has to update to keep ordering. Once the minimum app version includes
the picker, set `ROUTE_PLACES_REQUIRED=true`: a body without a place id then
gets `pickup_place_required` / `dropoff_place_required` and old builds see a
clear error code. Idempotency keys issued for old bodies keep replaying (new
fields only join the request fingerprint when sent).

The **bulk CSV upload stays free text** (`pickup_details`, `dropoff_details`
columns) and is exempt from `ROUTE_PLACES_REQUIRED`; place columns would need
the shop to know place ids. Bulk orders therefore have no place and use the
city-centre coordinate.

### Admin (audited)

All behind admin sign-in. Every write is an `admin_action` audit event
(`city_place_created`, `city_place_updated`, `city_place_disabled`,
`city_place_enabled`) with before / after values and the request id.

- `GET /api/v1/admin/city-places?city_key=&search=` returns
  `{ cities: [{ city_key, name_ar, name_en, places_total, places_active }], places: [<full row>] }`,
  disabled places included.
- `POST /api/v1/admin/city-places` `{ city_key, name_ar, name_en, latitude, longitude, sort_order? }`
  (inside lat 29.4 to 33.4, lng 34.2 to 35.95; the city must exist) creates an
  active, non-approximate place. `409 city_place_exists` for a duplicate Arabic
  name in the city; `404 city_not_found`.
- `PATCH /api/v1/admin/city-places/:id` with any of `name_ar`, `name_en`,
  `latitude`, `longitude`, `active`, `sort_order`. Moving a place marks it
  `approximate: false`, `source: "admin"`. Disabling hides it from new orders;
  existing orders keep their saved names. `404 city_place_not_found`.

## Apps

- **Mobile**: the order screens pick the route first, then show two searchable
  place pickers filtered by the route's direction, then the optional details
  field. Driver, rider and trip detail screens show the place name and the
  details. Place lists are fetched per route and cached for the session.
- **Admin**: "Villages and places" under Operations (add, rename, move,
  disable); order lists and details show the place and the details.

## Ambiguities and decisions

- **Intermediate stops**: operating routes have exactly two stops (origin and
  destination city), so there is nothing between them to choose. A multi-stop
  canonical route is not an operating route and is out of scope.
- **Places on the border of two cities** (for example towns between Ramallah
  and Nablus) belong to exactly one city, the nearest one. A rider who lives
  there picks the nearer city's list; admins can add the place to the other
  city too (names are unique per city, not globally).
- **City centre** is always offered as the first choice for each city.
- **Coordinates are approximate**; matching is by route, not by distance, so a
  village centre only affects the "driver approaching" notification, which now
  also fires for orders with a chosen place.
