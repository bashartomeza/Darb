# City places API

Pickup and drop-off places for route-based orders. The full contract, data
model, seed, error codes and the backward-compatibility decision are in
[`docs/routes/city-places.md`](../routes/city-places.md); this is the endpoint
summary.

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/v1/operating-routes/:id/places?lang=ar\|en` | none | `pickup_places` (origin city) and `dropoff_places` (destination city) of one route; `Cache-Control: public, max-age=300`; `409 route_unavailable` for an unknown or turned-off route |
| `POST /api/v1/passenger/requests` | passenger | Adds `pickup_place_id`, `dropoff_place_id`; `pickup_details` / `dropoff_details` become optional |
| `POST /api/v1/passenger/parcels` | passenger | Same fields |
| `POST /api/v1/merchant/orders` | merchant | `pickup_place_id` on the order, `dropoff_place_id` on each parcel |
| `GET /api/v1/admin/city-places?city_key=&search=` | admin | Cities with place counts and all places, disabled included |
| `POST /api/v1/admin/city-places` | admin | Add a place (audited) |
| `PATCH /api/v1/admin/city-places/:id` | admin | Rename, move, reorder, disable or enable (audited); places are never deleted |

Order errors (all `400`): `pickup_place_wrong_city`, `dropoff_place_wrong_city`,
`pickup_place_unavailable`, `dropoff_place_unavailable`, `pickup_place_required`,
`dropoff_place_required` (only with `ROUTE_PLACES_REQUIRED=true`),
`pickup_details_required`, `dropoff_details_required` (free text under 3
characters from an older build). Admin errors: `404 city_not_found`,
`404 city_place_not_found`, `409 city_place_exists`.

Order responses add `pickup_place_id`, `pickup_place_name_ar`,
`pickup_place_name_en`, `dropoff_place_id`, `dropoff_place_name_ar`,
`dropoff_place_name_en` (merchant orders: pickup; each parcel: drop-off).
