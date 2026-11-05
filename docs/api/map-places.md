# Map places API

Places of interest (cafes, restaurants, fuel stations, pharmacies, hospitals, clinics, supermarkets, ATMs and
banks, mosques, car repair, rest stops and toilets, EV charging) for the app map. The phones ask this API only; they
never call Overpass or OpenStreetMap for places. Data, import and refresh: `docs/maps/places.md`.

## `GET /api/v1/map/places`

Signed-in users of every role (rider, driver, merchant, admin), the same audience as `GET /checkpoints`.

| Query | Meaning |
| --- | --- |
| `bbox` (required) | `south,west,north,east` in degrees. Must lie inside the service area and be at most 1.0 degree on each side. |
| `categories` | Comma list of category keys. Omitted: every category. Unknown keys: `400`. |
| `limit` | 1 to 500, default 200. |

```json
{
  "places": [
    { "id": "cm...", "category": "pharmacy", "name_ar": "صيدلية الأمل", "name_en": null,
      "lat": 31.9, "lng": 35.2, "phone": "+970 2 123 4567", "opening_hours": "Mo-Su 08:00-22:00" }
  ],
  "truncated": false,
  "attribution": "© OpenStreetMap contributors"
}
```

- Only active places. Ordered nearest to the centre of the box first; `truncated: true` means more matched than were
  returned (the client asks for a smaller box or zooms in). At most 3,000 rows are ranked per request.
- `Cache-Control: private, max-age=300` and an ETag, so repeating a request for the same box is a `304`. The app
  snaps boxes to a 0.05-degree grid so small pans repeat the same request.
- `opening_hours` is OpenStreetMap syntax. The app reads the common forms to show "open now" and shows the text as
  written otherwise.
- Errors: `400` for a bad `bbox`, category or limit; `401` without a session.

## `GET /api/v1/map/places/categories`

`{ "categories": ["cafe", ...] }`, the keys of `apps/api/data/map-place-categories.json`.

## `POST /api/v1/map/places/:id/report`

Body `{ "reason": "closed" | "wrong_location" | "wrong_info" | "not_exists" | "other", "note"?: string (max 300) }`.
Answers `202 { "received": true }`. One report per user and place (a repeat changes nothing); `404 map_place_not_found`.
Reports are reviewed on the admin Map places page.

## Admin (`role = admin`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/map-places?search&category&city&active&page&limit` | Browse (50 per page by default, 100 at most). |
| GET | `/admin/map-places/summary` | Active and inactive counts per category, active counts per city. |
| GET | `/admin/map-places/categories` | Category keys. |
| POST | `/admin/map-places` | Add a place by hand: `category`, `name_ar` and/or `name_en`, `latitude`, `longitude` (inside the West Bank box), optional `phone`, `opening_hours`. `source = admin`. |
| PATCH | `/admin/map-places/:id` | Edit any field or set `active`. Marks the row `admin_edited`, so imports leave it alone. |
| GET | `/admin/map-place-reports?status=open` | Reports with their place. |
| PATCH | `/admin/map-place-reports/:id` | `{ "status": "resolved" \| "dismissed", "deactivate_place"?: true }`. |

Every create, edit, disable/enable and report review writes an `AuditEvent` (`admin_action`, entity `MapPlace` or
`MapPlaceReport`, with the before and after values). There is no delete: a wrong place is disabled, which keeps the
decision (and stops the next import from bringing it back, because the row stays `admin_edited`).

## Tables

Migration `20261114120000_map_places`: `map_places` (category, name_ar, name_en, latitude, longitude, phone,
opening_hours, city, source, osm_id unique, active, admin_edited) and `map_place_reports`. `category` is free text
validated against the shared category file, so a new category needs no migration.
